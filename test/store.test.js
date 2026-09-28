import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoadoutStore } from '../src/store.js';

const LIMITS = { maxSongsPerLoadout: 2, maxNameLength: 12, maxProfilesPerUser: 3, maxProfileNameLength: 10 };
const SONG_A = 'song:0000000000000001';
const SONG_B = 'song:0000000000000002';
const SONG_C = 'song:0000000000000003';

async function withStore(backend, run, { initialJson = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), `store-${backend}-`));
  const jsonFile = join(directory, 'state.json');
  const sqliteFile = join(directory, 'state.sqlite');
  if (initialJson) await writeFile(jsonFile, JSON.stringify(initialJson));
  const store = new LoadoutStore({ backend, jsonFile, sqliteFile }, LIMITS);
  try {
    await store.load();
    await run(store, { directory, jsonFile, sqliteFile });
  } finally {
    store.backend?.db?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

for (const backend of ['json', 'sqlite']) {
  test(`${backend} store persists loadout CRUD, limits, targets, and normalized names`, async () => {
    await withStore(backend, async (store, paths) => {
      const created = await store.createLoadout('user', '  My   Goals ');
      assert.equal(created.name, 'My Goals');
      assert.equal(store.hasLoadout('user', 'my goals'), true);
      await assert.rejects(() => store.createLoadout('user', 'MY GOALS'), /already exists/);
      await assert.rejects(() => store.createLoadout('user', 'name is too long'), /too long/);

      await store.addSong('user', 'my goals', SONG_A);
      await store.addSong('user', 'my goals', SONG_B);
      await assert.rejects(() => store.addSong('user', 'my goals', SONG_A), /already/);
      await assert.rejects(() => store.addSong('user', 'my goals', SONG_C), /full/);
      await store.setSongTarget('user', 'my goals', SONG_A, {
        achievementRate: '100.50000', difficulty: 'MAS', chartType: 'SD', comboFlag: 'FCP'
      });
      assert.deepEqual(store.getLoadout('user', 'my goals').targets[SONG_A], {
        achievementRate: 100.5, difficulty: 'master', chartType: 'std', comboFlag: 'fc+'
      });
      await store.removeSong('user', 'my goals', SONG_A);
      assert.equal(store.getLoadout('user', 'my goals').targets[SONG_A], undefined);
      await assert.rejects(() => store.removeSong('user', 'my goals', SONG_A), /not in/);

      const replacement = await store.setSongs('user', 'Imported', [SONG_A, SONG_A, SONG_C], { createIfMissing: true });
      assert.deepEqual(replacement.songs, [SONG_A, SONG_C]);
      const reloaded = new LoadoutStore({ backend, jsonFile: paths.jsonFile, sqliteFile: paths.sqliteFile }, LIMITS);
      await reloaded.load();
      assert.deepEqual(reloaded.getLoadout('user', 'imported').songs, [SONG_A, SONG_C]);
      reloaded.backend?.db?.close();

      assert.equal((await store.deleteLoadout('user', 'Imported')).name, 'Imported');
      await assert.rejects(() => store.deleteLoadout('user', 'Imported'), /not found/);
    });
  });

  test(`${backend} store isolates account profiles, scores, recents, and exports`, async () => {
    await withStore(backend, async (store) => {
      await store.setAccount('user', {
        provider: 'manual', player: { name: 'Default' },
        allScores: [{ title: 'Default Song', difficulty: 'master', type: 'dx', playCount: 2 }],
        recentSessions: [[{ title: 'Default Recent', difficulty: 'expert', type: 'std' }]]
      });
      await store.switchActiveProfile('user', 'Second');
      await store.setAccount('user', {
        provider: 'manual', player: { name: 'Second' },
        allScores: [{ title: 'Second Song', difficulty: 'master', type: 'dx', playCount: 9 }],
        recentSessions: [[{ title: 'Second Recent', difficulty: 'master', type: 'dx' }]]
      });
      assert.equal(store.getAccount('user').player.name, 'Second');
      assert.equal(store.getAccountScores('user')[0].title, 'Second Song');
      assert.equal(store.getTopPlayCountScores('user')[0].playCount, 9);

      const exported = store.getExportState();
      assert.equal(exported.users.user.profiles.default.account.allScores[0].title, 'Default Song');
      assert.equal(exported.users.user.profiles.second.account.allScores[0].title, 'Second Song');
      assert.equal(exported.users.user.profiles.default.account.recentSessions[0][0].title, 'Default Recent');
      assert.equal(exported.users.user.profiles.second.account.recentSessions[0][0].title, 'Second Recent');

      await store.switchActiveProfile('user', 'default');
      const profiles = store.listUserProfiles('user');
      assert.equal(profiles.find((profile) => profile.name === 'default').isActive, true);
      assert.equal((await store.deleteProfile('user', 'second')).deletedSlot, true);
      assert.equal(store.listUserProfiles('user').some((profile) => profile.name === 'second'), false);
      assert.equal((await store.clearAccount('user')).player.name, 'Default');
      assert.equal(store.hasAccount('user'), false);
    });
  });

  test(`${backend} store keeps public profiles opt-in, revocable, and stable across sync`, async () => {
    await withStore(backend, async (store) => {
      await assert.rejects(() => store.enablePublicProfile('missing'), /Link an account/);
      await store.setAccount('user', {
        provider: 'manual', player: { name: 'Public Player' },
        allScores: [{ title: 'Melt', difficulty: 'master', type: 'dx', achievement: 990000 }]
      });
      assert.equal(store.getPublicProfileSettings('user'), null);

      const enabled = await store.enablePublicProfile('user');
      assert.match(enabled.id, /^[A-Za-z0-9_-]{24}$/);
      assert.equal(store.findPublicProfile(enabled.id).account.player.name, 'Public Player');

      await store.setAccount('user', {
        provider: 'manual', player: { name: 'Public Player' },
        allScores: [{ title: 'Melt', difficulty: 'master', type: 'dx', achievement: 1_000_000 }]
      });
      assert.equal(store.getPublicProfileSettings('user').id, enabled.id);

      assert.equal(await store.disablePublicProfile('user'), true);
      assert.equal(store.findPublicProfile(enabled.id), null);
      const reenabled = await store.enablePublicProfile('user');
      assert.notEqual(reenabled.id, enabled.id);
    });
  });

  test(`${backend} store replaces pending link sessions and cleans expired/completed data`, async () => {
    await withStore(backend, async (store) => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const past = new Date(Date.now() - 60_000).toISOString();
      await store.createAccountLinkSession('user', { token: 'first', createdAt: past, expiresAt: future });
      await store.createAccountLinkSession('user', { token: 'second', createdAt: past, expiresAt: future });
      assert.equal(store.getAccountLinkSession('first'), null);
      assert.equal(store.getPendingAccountLinkSessionForUser('user').token, 'second');
      const completed = await store.completeAccountLinkSession('second');
      assert.equal(completed.userId, 'user');
      assert.equal(store.getAccountLinkSession('second'), null);

      await store.createAccountLinkSession('user', { token: 'expired', createdAt: past, expiresAt: past });
      await store.cleanupExpiredAccountLinkSessions();
      assert.equal(store.getAccountLinkSession('expired'), null);
    });
  });

  test(`${backend} store keeps deduplicated snapshot and timestamped play history`, async () => {
    await withStore(backend, async (store, paths) => {
      const firstPlays = [
        { title: 'Alpha', difficulty: 'master', type: 'dx', track: 1, achievement: 990000, playedAtIso: '2026-09-01T10:00:00+09:00' },
        { title: 'Beta', difficulty: 'expert', type: 'std', track: 2, achievement: 995000, playedAtIso: '2026-09-01T10:03:00+09:00' }
      ];
      const base = {
        provider: 'manual',
        player: { name: 'History Player' },
        metrics: { rating: 10000, playCount: 10 },
        sourceFetchedAt: '2026-09-01T10:05:00+09:00',
        linkedAuth: { encrypted: 'must-not-be-copied' },
        best50: { totalRating: 10000 },
        allScores: [{ title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 990000 }],
        recentSessions: firstPlays
      };
      await store.setAccount('user', base);
      await store.setAccount('user', base);
      assert.equal(store.getAccountHistory('user').length, 1);
      assert.equal(store.getAccountHistory('user')[0].snapshot.linkedAuth, undefined);
      assert.equal(store.getAccountRecentHistory('user', { date: '2026-09-01' }).length, 2);

      await store.setAccount('user', {
        ...base,
        metrics: { rating: 10020, playCount: 11 },
        sourceFetchedAt: '2026-09-01T12:05:00+09:00',
        recentSessions: [
          ...firstPlays,
          { title: 'Alpha', difficulty: 'master', type: 'dx', track: 1, achievement: 1_000_000, playedAtIso: '2026-09-01T12:00:00+09:00' }
        ]
      });
      assert.equal(store.getAccountHistory('user').length, 2);
      assert.equal(store.getAccountRecentHistory('user', { date: '2026-09-01' }).length, 3);
      assert.deepEqual(store.getAccountRecentHistoryDates('user'), [{ date: '2026-09-01', playCount: 3 }]);

      const reloaded = new LoadoutStore(
        { backend, jsonFile: paths.jsonFile, sqliteFile: paths.sqliteFile }, LIMITS
      );
      await reloaded.load();
      assert.equal(reloaded.getAccountHistory('user').length, 2);
      assert.equal(reloaded.getAccountRecentHistory('user', { date: '2026-09-01' }).length, 3);
      await reloaded.clearAccount('user');
      assert.equal(reloaded.getAccountHistory('user').length, 0);
      assert.equal(reloaded.getAccountRecentHistory('user').length, 0);
      reloaded.backend?.db?.close();
    });
  });

  test(`${backend} store keeps one deterministic best timed play per chart`, async () => {
    await withStore(backend, async (store, paths) => {
      await store.setAccount('user', {
        provider: 'manual',
        player: { name: 'Timing Player' },
        allScores: [{ favoriteId: '100', title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 1_000_000 }],
        recentSessions: [
          { favoriteId: '100', title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 990_000, dxScore: 1200, playedAtIso: '2026-09-01T10:00:00+09:00', details: { fastCount: 8, lateCount: 9 } },
          { favoriteId: '100', title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 1_000_000, dxScore: 900, playedAtIso: '2026-09-01T10:03:00+09:00', details: { fastCount: 4, lateCount: 5 } },
          { favoriteId: '100', title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 1_000_000, dxScore: 950, playedAtIso: '2026-09-01T10:06:00+09:00', details: { fastCount: 0, lateCount: 2 } },
          { favoriteId: '200', title: 'Beta', difficulty: 'expert', type: 'std', achievement: 970_000, playedAtIso: '2026-09-01T10:09:00+09:00', details: { fastCount: 1.5, lateCount: 2 } },
          { favoriteId: '300', title: 'Gamma', difficulty: 'Re:MASTER', type: 'DX', achievement: 995_000, playedAtIso: '2026-09-01T10:12:00+09:00', details: { fastCount: 3, lateCount: 0 } }
        ]
      });

      const summaries = store.getAccountBestTimedPlays('user');
      assert.equal(summaries.length, 2);
      const alpha = summaries.find((play) => play.title === 'Alpha');
      assert.equal(alpha.achievement, 1_000_000);
      assert.equal(alpha.dxScore, 950);
      assert.equal(alpha.fastCount, 0);
      assert.equal(alpha.lateCount, 2);
      assert.equal(alpha.playedAtIso, '2026-09-01T01:06:00.000Z');
      assert.equal(alpha.favoriteId, '100');
      assert.equal(summaries.find((play) => play.title === 'Gamma').difficulty, 'remaster');
      if (backend === 'sqlite') {
        assert.deepEqual(store.verifyBestTimedPlays(), {
          scanned: 5, eligible: 4, expected: 2, stored: 2,
          missing: 0, extra: 0, mismatched: 0, ok: true
        });
      }

      const reloaded = new LoadoutStore(
        { backend, jsonFile: paths.jsonFile, sqliteFile: paths.sqliteFile }, LIMITS
      );
      await reloaded.load();
      assert.equal(reloaded.getAccountBestTimedPlays('user').length, 2);
      await reloaded.clearAccount('user');
      assert.equal(reloaded.getAccountBestTimedPlays('user').length, 0);
      reloaded.backend?.db?.close();
    });
  });
}

test('legacy JSON state migrates account shape and stored song IDs', async () => {
  const initial = {
    users: { user: { account: { player: { name: 'Legacy' } }, loadouts: {
      goals: { name: 'Goals', songs: ['123', '123', SONG_B], targets: { 123: { achievementRate: 99, difficulty: 'exp', chartType: 'dx', comboFlag: 'ap' } } }
    } } },
    accountLinkSessions: {}, metadata: {}
  };
  await withStore('json', async (store, { jsonFile }) => {
    assert.equal(store.getAccount('user').player.name, 'Legacy');
    const result = await store.migrateLoadouts((id) => id === '123' ? { songId: SONG_A } : null);
    assert.equal(result.changed, true);
    assert.equal(result.legacySongs, 2);
    assert.equal(result.remainingLegacySongs, 0);
    assert.deepEqual(store.getLoadout('user', 'goals').songs, [SONG_A, SONG_B]);
    assert.ok(store.getLoadout('user', 'goals').targets[SONG_A]);
    assert.equal(JSON.parse(await readFile(jsonFile, 'utf8')).metadata.loadoutSchemaVersion, 2);
  }, { initialJson: initial });
});
