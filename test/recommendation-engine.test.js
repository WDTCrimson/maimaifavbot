import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSnapshotAge,
  inferSuggestionRange,
  recommendCharts,
  resolvePlayerScores,
  resolveSuggestionAccess
} from '../src/recommendation-engine.js';
import { canonicalChartKey } from '../src/recommendation-schema.js';

function makeSong(index, constant = 12 + index / 10) {
  const hex = index.toString(16).padStart(16, '0');
  return {
    songId: `song:${hex}`,
    favoriteId: String(index),
    title: `Song ${index}`,
    artist: 'Test',
    aliases: [],
    difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '12+', internalLevelValue: constant }]
  };
}

function makeSongCatalog(count = 20) {
  const songs = Array.from({ length: count }, (_, index) => makeSong(index + 1));
  return {
    songs,
    getByStoredId(value) { return songs.find((song) => song.songId === value || song.favoriteId === String(value)) || null; },
    getUniqueByNormalizedTitle(value) { const matches = songs.filter((song) => song.title.toLowerCase() === String(value).toLowerCase()); return matches.length === 1 ? matches[0] : null; },
    getByAlias() { return null; }
  };
}

function score(song, achievement = 969000, rating = null) {
  return { title: song.title, type: 'dx', difficulty: 'master', achievement, rating, fc: 'none' };
}

function evidenceEntry(song, weight, tags = ['tech']) {
  const key = canonicalChartKey(song.songId, 'dx', 'master');
  return {
    key, songId: song.songId, song, chart: { type: 'dx', difficulty: 'master' },
    resolvedChart: song.difficultyLevels[0], constant: song.difficultyLevels[0].internalLevelValue,
    summary: `Try ${song.title}.`, tags, evidenceWeight: weight,
    evidence: [{ source: 'manual', sourceId: `manual:${song.favoriteId}`, status: 'active' }]
  };
}

function fakeCatalog(entries) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return { available: true, entries, getByChartKey(key) { return byKey.get(key) || null; } };
}

test('fallback matrix enforces link, range, mode, and stale snapshot rules', () => {
  assert.deepEqual(resolveSuggestionAccess({ linked: false, mode: 'improvement', hasExplicitRange: true }).reason, 'link_required');
  assert.deepEqual(resolveSuggestionAccess({ linked: false, mode: 'balanced', hasExplicitRange: false }).reason, 'range_or_link_required');
  assert.deepEqual(resolveSuggestionAccess({ linked: false, mode: 'balanced', hasExplicitRange: true }).effectiveMode, 'discovery');
  assert.deepEqual(resolveSuggestionAccess({ linked: true, mode: 'balanced', hasExplicitRange: false, snapshotAge: { expired: true } }).reason, 'snapshot_expired');
  assert.equal(resolveSuggestionAccess({ linked: true, mode: 'improvement', hasExplicitRange: true }).allowed, true);
});

test('account snapshot age applies 30 and 90 day thresholds', () => {
  const now = Date.parse('2026-08-27T00:00:00.000Z');
  assert.equal(accountSnapshotAge({ updatedAt: '2026-08-01T00:00:00.000Z' }, now).stale, false);
  assert.equal(accountSnapshotAge({ updatedAt: '2026-07-01T00:00:00.000Z' }, now).stale, true);
  assert.equal(accountSnapshotAge({ updatedAt: '2026-05-01T00:00:00.000Z' }, now).expired, true);
});

test('score resolution deduplicates by canonical chart using achievement then rating', () => {
  const catalog = makeSongCatalog(1);
  const rows = resolvePlayerScores([
    score(catalog.songs[0], 970000, 100),
    score(catalog.songs[0], 971000, 90),
    score(catalog.songs[0], 971000, 110)
  ], catalog);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].achievement, 971000);
  assert.equal(rows[0].rating, 110);
});

test('inferred range uses median of top 10-15 distinct resolved charts', () => {
  const catalog = makeSongCatalog(20);
  const scores = catalog.songs.map((song, index) => score(song, 990000, 1000 - index));
  const range = inferSuggestionRange(scores, catalog);
  assert.equal(range.sampleSize, 15);
  assert.equal(range.median, 12.8);
  assert.deepEqual([range.minConstant, range.maxConstant], [12.5, 13.1]);
  assert.throws(() => inferSuggestionRange(scores.slice(0, 9), catalog), /At least 10/);
});

test('balanced mode reserves discovery slots then backfills deterministically', () => {
  const songs = makeSongCatalog(8);
  const entries = songs.songs.slice(2).map((song, index) => evidenceEntry(song, 0.9 - index / 10));
  const catalog = fakeCatalog(entries);
  const scores = [score(songs.songs[0]), score(songs.songs[1])];
  const results = recommendCharts({ catalog, songCatalog: songs, scores, range: { minConstant: 12, maxConstant: 13 }, mode: 'balanced', limit: 5 });
  assert.equal(results.length, 5);
  assert.equal(results.filter((item) => item.lane === 'discovery').length, 3);
  assert.equal(results.filter((item) => item.lane === 'improvement').length, 2);
  assert.equal(new Set(results.map((item) => item.key)).size, 5);
});

test('balanced mode backfills score-only improvements when catalog is unavailable', () => {
  const songs = makeSongCatalog(6);
  const scores = songs.songs.map((song) => score(song));
  const results = recommendCharts({ catalog: null, songCatalog: songs, scores, range: { minConstant: 12, maxConstant: 13 }, mode: 'balanced', limit: 4 });
  assert.equal(results.length, 4);
  assert.ok(results.every((item) => item.lane === 'improvement' && item.evidence === null));
});

test('focus is a hard evidence tag filter for both lanes', () => {
  const songs = makeSongCatalog(4);
  const entries = [evidenceEntry(songs.songs[0], 0.8, ['tech']), evidenceEntry(songs.songs[1], 0.8, ['stamina'])];
  const catalog = fakeCatalog(entries);
  const results = recommendCharts({ catalog, songCatalog: songs, scores: [score(songs.songs[0])], range: { minConstant: 12, maxConstant: 13 }, focus: 'stamina', mode: 'balanced', limit: 5 });
  assert.deepEqual(results.map((item) => item.key), [entries[1].key]);
});

test('stable canonical key breaks equal composite-score ties', () => {
  const songs = makeSongCatalog(3);
  const entries = [evidenceEntry(songs.songs[2], 0.5), evidenceEntry(songs.songs[1], 0.5)];
  const results = recommendCharts({ catalog: fakeCatalog(entries), songCatalog: songs, scores: [], range: { minConstant: 12, maxConstant: 12.5 }, mode: 'discovery', limit: 2 });
  assert.deepEqual(results.map((item) => item.songId), [songs.songs[1].songId, songs.songs[2].songId]);
});
