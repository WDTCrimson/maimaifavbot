import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlayCountGraphic } from '../src/playcount-graphic.js';
import { renderPlaylistTargetGraphic } from '../src/playlist-target-graphic.js';
import { renderSongScoreGraphic } from '../src/song-score-graphic.js';
import { renderSongInfoGraphic, resolveSongInfoVersion } from '../src/song-info-graphic.js';
import { renderAccountB50Graphic } from '../src/account-b50-graphic.js';
import { renderAccountRecentGraphic } from '../src/account-recent-graphic.js';

const account = {
  gameVersion: 14,
  player: { name: 'Test Player' },
  metrics: { rating: 15000 },
  rating: 15000
};

function assertPng(result, expectedName) {
  assert.equal(result.fileName, expectedName);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.deepEqual([...result.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(result.buffer.length > 1_000);
}

test('play-count renderer produces a PNG and rejects empty input', async () => {
  await assert.rejects(() => renderPlayCountGraphic({ account, entries: [] }), /No play-count data/);
  const result = await renderPlayCountGraphic({
    account,
    entries: [{
      song: { title: 'KING', artist: 'Kanaria', jacket: {} },
      score: {
        title: 'KING', artist: 'Kanaria', playCount: 42, difficulty: 'master', type: 'dx',
        level: '12+', achievement: 1000000, rating: 270, dxScore: 900, maxDxScore: 1000,
        fc: 'fc', fs: 'fs', internalLevelValue: 12.7
      }
    }]
  });
  assertPng(result, 'Test-Player-top-plays.png');
});

test('song-score renderer produces a PNG and rejects empty input', async () => {
  const song = { title: 'KING', artist: 'Kanaria', bpm: 166, category: 'POPS＆ANIME', jacket: {} };
  await assert.rejects(() => renderSongScoreGraphic({ account, song, scores: [] }), /No score data/);
  const result = await renderSongScoreGraphic({
    account,
    song,
    scores: [{
      title: 'KING', difficulty: 'master', type: 'dx', level: '12+', achievement: 1000000,
      rating: 270, dxScore: 900, maxDxScore: 1000, fc: 'fc', fs: 'fs', playCount: 10,
      internalLevelValue: 12.7
    }]
  });
  assertPng(result, 'KING-score.png');
});

test('song-info renderer produces a chart reference PNG', async () => {
  assert.deepEqual(resolveSongInfoVersion('PRiSM PLUS'), { themeNumber: 11, logoFile: '11.png' });
  assert.deepEqual(resolveSongInfoVersion('CiRCLE PLUS'), { themeNumber: 13, logoFile: '13.png' });
  assert.deepEqual(resolveSongInfoVersion('MAGiCAL'), { themeNumber: 14, logoFile: '14.png' });
  await assert.rejects(() => renderSongInfoGraphic({ song: { title: 'Empty' } }), /No chart metadata/);
  const result = await renderSongInfoGraphic({
    song: {
      title: 'Luminescence', artist: '米虾Fomiki & 初云CLoudie', bpm: 184,
      category: 'ゲーム＆バラエティ', regions: { jp: true, intl: true }, jacket: {},
      aliases: ['lumi'], displayAliases: ['Lumi'],
      difficultyLevels: [{
        type: 'dx', difficulty: 'master', level: '13+', internalLevelValue: 13.8,
        noteDesigner: 'Jack', version: 'PRiSM PLUS',
        noteCounts: { total: 882, tap: 599, hold: 40, slide: 72, touch: 129, break: 42 }
      }]
    }
  });
  assertPng(result, 'Luminescence-info.png');
  assert.equal(result.chartCount, 1);
});

test('playlist target renderer produces a themed PNG without requiring a jacket', async () => {
  const result = await renderPlaylistTargetGraphic({
    account,
    playlistName: 'My Goals!',
    themeDir: './data/theme/tomomai',
    entries: [{
      song: { title: 'KING' },
      chart: { type: 'dx', difficulty: 'master', internalLevelValue: 12.7 },
      target: { achievementRate: 100.5, comboFlag: 'ap+' },
      targetRating: 286,
      rankKey: null,
      jacketPath: null
    }]
  });
  assertPng(result, 'my-goals-targets.png');
});

test('version 14 account graphics use the staged MAGiCAL assets', async () => {
  const b50 = await renderAccountB50Graphic({
    account: { ...account, best50: { b15: [], b35: [] } },
    songCatalog: { getByFavoriteId: () => null }
  });
  assertPng(b50, 'Test-Player-b50.png');

  const recent = await renderAccountRecentGraphic({
    account: {
      ...account,
      recentSessions: [{
        title: 'Prototype', track: 1, difficulty: 'master', type: 'dx', level: '14',
        achievement: 1_005_000, dxScore: 1000, maxDxScore: 1000, fc: 'ap', fs: 'fdx',
        playedAtIso: '2026-09-28T07:00:00+09:00'
      }]
    }
  });
  assertPng(recent, 'Test-Player-recent-credit-1.png');
  assert.equal(recent.creditCount, 1);
});
