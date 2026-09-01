import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountHistorySummary,
  buildAccountProgress,
  buildAccountRoast,
  buildDailyPlaySummary,
  filterRatingRecommendations
} from '../src/account-insights.js';

function makeCatalog() {
  const songs = [
    {
      songId: 'song:0000000000000001', favoriteId: '1', title: 'Alpha',
      difficultyLevels: [
        { type: 'dx', difficulty: 'basic', level: '5', internalLevelValue: 5, version: 'PRiSM', releaseDate: '2024-01-01' },
        { type: 'dx', difficulty: 'master', level: '13', internalLevelValue: 13.2, version: 'PRiSM', releaseDate: '2024-01-01' }
      ]
    },
    {
      songId: 'song:0000000000000002', favoriteId: '2', title: 'Beta',
      difficultyLevels: [
        { type: 'std', difficulty: 'master', level: '12+', internalLevelValue: 12.8, version: 'BUDDiES', releaseDate: '2023-01-01' }
      ]
    }
  ];
  return {
    available: true,
    songs,
    getByStoredId(id) { return songs.find((song) => song.songId === id || song.favoriteId === String(id)) || null; },
    getUniqueByNormalizedTitle(title) { return songs.find((song) => song.title.toLowerCase() === String(title).toLowerCase()) || null; },
    getByAlias() { return null; }
  };
}

test('account progress calculates plate totals and missing charts from the current snapshot', () => {
  const scores = [
    { songId: 'song:0000000000000001', title: 'Alpha', difficulty: 'basic', type: 'dx', achievement: 1_000_000, fc: 'fc', fs: 'fdx' },
    { songId: 'song:0000000000000001', title: 'Alpha', difficulty: 'master', type: 'dx', achievement: 995_000, fc: 'none', fs: 'none' }
  ];
  const overview = buildAccountProgress(scores, makeCatalog());
  assert.deepEqual(overview.rows.map((row) => row.version), ['PRiSM', 'BUDDiES']);
  assert.deepEqual(overview.rows[0].plates, { kiwami: 1, shou: 1, shin: 0, maimai: 1 });

  const plate = buildAccountProgress(scores, makeCatalog(), { version: 'prism', plate: 'shou' });
  assert.equal(plate.selectedVersion, 'PRiSM');
  assert.equal(plate.rows[0].total, 2);
  assert.equal(plate.rows[0].plates.shou, 1);
  assert.deepEqual(plate.missing.map((entry) => entry.title), ['Alpha']);
  assert.equal(plate.missing[0].difficulty, 'master');
});

test('gap recommendation filters honor bucket, chart filters, count, and gain sorting', () => {
  const input = [
    { title: 'A', bucket: 'new', isInBest: true, difficulty: 'master', type: 'dx', level: '13+', internalLevelValue: 13.7, ratingGain: 2, efficiency: 10 },
    { title: 'B', bucket: 'new', isInBest: false, difficulty: 'master', type: 'dx', level: '13+', internalLevelValue: 13.7, ratingGain: 8, efficiency: 2 },
    { title: 'C', bucket: 'old', isInBest: true, difficulty: 'expert', type: 'std', level: '12', internalLevelValue: 12, ratingGain: 4, efficiency: 4 }
  ];
  const filtered = filterRatingRecommendations(input, {
    bucket: 'new', difficulty: 'master', type: 'dx', level: '13.7', sort: 'gain', count: 1
  });
  assert.equal(filtered.total, 2);
  assert.deepEqual(filtered.shown.map((entry) => entry.title), ['B']);
  assert.deepEqual(filterRatingRecommendations(input, { bucket: 'best' }).shown.map((entry) => entry.title), ['A', 'C']);
});

test('roasts are deterministic per account and day and do not require an AI service', () => {
  const account = { player: { name: 'Crimson' }, metrics: { rating: 15000, playCount: 123 } };
  const scores = [{ achievement: 1_005_000, fc: 'ap' }];
  assert.deepEqual(
    buildAccountRoast(account, scores, '2026-09-01'),
    buildAccountRoast(account, scores, '2026-09-01')
  );
  assert.match(buildAccountRoast(account, scores, '2026-09-01').text, /Crimson|15000|1|123/);
});

test('history summaries calculate deltas against the next older snapshot', () => {
  const summary = buildAccountHistorySummary([
    { capturedAt: '2026-08-30T00:00:00Z', rating: 100, playCount: 10 },
    { capturedAt: '2026-09-01T00:00:00Z', rating: 120, playCount: 15 },
    { capturedAt: '2026-08-31T00:00:00Z', rating: 110, playCount: 12 }
  ]);
  assert.deepEqual(summary.map((entry) => entry.ratingDelta), [10, 10, null]);
  assert.deepEqual(summary.map((entry) => entry.playCountDelta), [3, 2, null]);
});

test('daily summaries calculate sessions, average, best, and most-played song', () => {
  const summary = buildDailyPlaySummary([
    { title: 'Alpha', track: 1, achievement: 990_000, playedAtIso: '2026-09-01T10:00:00+09:00' },
    { title: 'Beta', track: 2, achievement: 1_000_000, playedAtIso: '2026-09-01T10:03:00+09:00' },
    { title: 'Alpha', track: 1, achievement: 995_000, playedAtIso: '2026-09-01T12:00:00+09:00' }
  ], '2026-09-01');
  assert.equal(summary.plays, 3);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.averageAchievement, 995_000);
  assert.equal(summary.best.title, 'Beta');
  assert.deepEqual(summary.favorite, { title: 'Alpha', count: 2 });
});
