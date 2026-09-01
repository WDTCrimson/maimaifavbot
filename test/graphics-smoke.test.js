import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlayCountGraphic } from '../src/playcount-graphic.js';
import { renderPlaylistTargetGraphic } from '../src/playlist-target-graphic.js';
import { renderSongScoreGraphic } from '../src/song-score-graphic.js';

const account = {
  gameVersion: 13,
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
