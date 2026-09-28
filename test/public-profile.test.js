import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicProfilePayload } from '../src/public-profile.js';

test('public profile groups played and unplayed difficulties by song and chart type', () => {
  const song = {
    songId: 'song:1234567890abcdef',
    favoriteId: '100',
    title: 'Melt',
    artist: 'ryo',
    aliases: ['Melty Song', ' メルト曲 '],
    normAliases: ['melty song', 'メルト曲'],
    category: 'niconico',
    jacket: { dxratingFile: 'melt.jpg' },
    difficultyLevels: [
      { type: 'dx', difficulty: 'basic', level: '3' },
      { type: 'dx', difficulty: 'advanced', level: '7' },
      { type: 'dx', difficulty: 'expert', level: '10' },
      { type: 'dx', difficulty: 'master', level: '13' },
      { type: 'dx', difficulty: 'remaster', level: '13+' }
    ]
  };
  const catalog = {
    available: true,
    getByFavoriteId: (id) => id === '100' ? song : null,
    getUniqueByNormalizedTitle: () => song
  };
  const profile = buildPublicProfilePayload({
    account: { player: { name: 'Alice', iconUrl: 'https://maimaidx-eng.com/maimai-mobile/img/Icon/alice.png' }, metrics: { rating: 15000, playCount: 500 }, gameVersion: 13, updatedAt: '2026-09-28T00:00:00.000Z' },
    scores: [
      { favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'basic', achievement: 1005000, fc: 'ap' },
      { favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'advanced', achievement: 990000 },
      { favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'expert', achievement: 970000 },
      { favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'master', achievement: 940000 }
    ],
    recentPlays: [{
      favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'master', level: '13',
      achievement: 1001234, playedAtIso: '2026-09-28T01:02:03.000Z',
      details: { fastCount: 4, lateCount: 7, ratingChange: 2, venue: 'Private arcade' }
    }],
    bestTimedPlays: [{
      favoriteId: '100', title: 'Melt', type: 'dx', difficulty: 'basic',
      achievement: 1005000, dxScore: 1234, fastCount: 0, lateCount: 3,
      playedAtIso: '2026-09-28T01:00:00.000Z', playKey: 'a'.repeat(64)
    }],
    songCatalog: catalog
  });

  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.player.name, 'Alice');
  assert.deepEqual(profile.metrics, { rating: 15000, playCount: 500, songCount: 1, playedChartCount: 4 });
  assert.equal(profile.songs[0].title, 'Melt');
  assert.equal(profile.songs[0].playedChartCount, 4);
  assert.equal(profile.songs[0].availableChartCount, 5);
  assert.deepEqual(profile.songs[0].charts.map((chart) => [chart.difficulty, chart.played]), [
    ['basic', true], ['advanced', true], ['expert', true], ['master', true], ['remaster', false]
  ]);
  assert.equal(profile.songs[0].charts[0].achievementRank, 'SSS+');
  assert.deepEqual(profile.songs[0].charts[0].bestTimedPlay, {
    achievement: 1005000, dxScore: 1234, fastCount: 0, lateCount: 3,
    playedAt: '2026-09-28T01:00:00.000Z', matchesBest: true
  });
  assert.equal(profile.songs[0].hasJacket, true);
  assert.deepEqual(profile.songs[0].searchAliases, ['melty song', 'メルト曲']);
  assert.equal(profile.player.avatarUrl, 'https://maimaidx-eng.com/maimai-mobile/img/Icon/alice.png');
  assert.equal(profile.gameVersion, 13);
  assert.deepEqual(profile.recentPlays[0], {
    songId: 'song:1234567890abcdef', hasJacket: true, title: 'Melt', artist: 'ryo',
    type: 'dx', difficulty: 'master', level: '13', achievement: 1001234, achievementRank: 'SSS',
    dxScore: null, maxDxScore: null, fc: null, fs: null, track: null,
    playedAt: '2026-09-28T01:02:03.000Z', fastCount: 4, lateCount: 7, ratingChange: 2
  });
  assert.equal(JSON.stringify(profile).includes('Private arcade'), false);
});

test('public profile keeps Standard and DX charts separate', () => {
  const profile = buildPublicProfilePayload({
    account: { player: { name: 'Alice' } },
    scores: [
      { title: 'Melt', type: 'std', difficulty: 'master', achievement: 970000 },
      { title: 'Melt', type: 'dx', difficulty: 'master', achievement: 990000 }
    ],
    songCatalog: null
  });
  assert.equal(profile.songs.length, 1);
  assert.deepEqual(profile.songs[0].charts.map((chart) => chart.type), ['dx', 'std']);
});

test('public profile canonicalizes renamed timed plays and keeps lower timing separate', () => {
  const song = { songId: 'song:1234567890abcdef', favoriteId: '100', title: 'New Name', difficultyLevels: [] };
  const catalog = {
    available: true,
    getByFavoriteId: (id) => id === '100' ? song : null,
    getUniqueByNormalizedTitle: (title) => title === 'New Name' ? song : null
  };
  const profile = buildPublicProfilePayload({
    account: { player: { name: 'Alice' } },
    scores: [{ favoriteId: '100', title: 'New Name', type: 'dx', difficulty: 'master', achievement: 1_000_000 }],
    bestTimedPlays: [
      { favoriteId: '100', title: 'Old Name', type: 'dx', difficulty: 'master', achievement: 990_000, dxScore: 1000, fastCount: 8, lateCount: 9, playedAtIso: '2026-09-28T01:00:00Z', playKey: 'a'.repeat(64) },
      { favoriteId: '100', title: 'New Name', type: 'dx', difficulty: 'master', achievement: 995_000, dxScore: 900, fastCount: 4, lateCount: 5, playedAtIso: '2026-09-28T02:00:00Z', playKey: 'b'.repeat(64) }
    ],
    songCatalog: catalog
  });
  assert.deepEqual(profile.songs[0].charts[0].bestTimedPlay, {
    achievement: 995000, dxScore: 900, fastCount: 4, lateCount: 5,
    playedAt: '2026-09-28T02:00:00.000Z', matchesBest: false
  });
});

test('public profile omits timed summaries that cannot resolve uniquely', () => {
  const catalog = {
    available: true,
    getByFavoriteId: () => null,
    getUniqueByNormalizedTitle: () => null
  };
  const profile = buildPublicProfilePayload({
    account: { player: { name: 'Alice' } },
    scores: [{ title: 'Duplicate', type: 'dx', difficulty: 'master', achievement: 990000 }],
    bestTimedPlays: [{ title: 'Duplicate', type: 'dx', difficulty: 'master', achievement: 990000, fastCount: 1, lateCount: 2, playedAtIso: '2026-09-28T00:00:00Z' }],
    songCatalog: catalog
  });
  assert.equal(profile.songs[0].charts[0].bestTimedPlay, undefined);
});
