import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRandomChart } from '../src/song-random-view.js';

const songCatalog = {
  songs: [
    { songId: 'song:0000000000000001', title: 'One', difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '13+', internalLevelValue: 13.7 }] },
    { songId: 'song:0000000000000002', title: 'Two', difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '13+', internalLevelValue: 13.8 }] }
  ],
  getByStoredId(id) { return this.songs.find((song) => song.songId === id) || null; },
  getUniqueByNormalizedTitle() { return null; },
  getByAlias() { return null; }
};

test('random chart selection is filterable and deterministic with injected rng', () => {
  const first = selectRandomChart({ songCatalog, level: '13+', difficulty: 'master', rng: () => 0 });
  const last = selectRandomChart({ songCatalog, level: '13+', difficulty: 'master', rng: () => 0.999 });
  assert.equal(first.song.title, 'One');
  assert.equal(last.song.title, 'Two');
});

test('unplayed random selection excludes resolved player scores', () => {
  const selected = selectRandomChart({
    songCatalog,
    unplayed: true,
    scores: [{ songId: 'song:0000000000000001', type: 'dx', difficulty: 'master', achievement: 1000000 }],
    rng: () => 0
  });
  assert.equal(selected.song.title, 'Two');
});

test('random selection excludes songs unavailable in the International region', () => {
  const regionalCatalog = {
    ...songCatalog,
    songs: songCatalog.songs.map((song, index) => ({
      ...song,
      regions: { jp: true, intl: index === 1 }
    }))
  };
  const result = selectRandomChart({ songCatalog: regionalCatalog, rng: () => 0 });
  assert.equal(result.song.songId, regionalCatalog.songs[1].songId);
});
