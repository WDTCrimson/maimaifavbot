import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBest50,
  calculateChartRating,
  computeGapSuggestions,
  getCurrentIntlVersionId,
  resolveChartVersionId
} from '../src/maimai-intl.js';

function catalogFixture() {
  return {
    available: true,
    songs: [
      {
        songId: 'song:0000000000000001', favoriteId: '1', title: 'New Song', artist: 'Artist', aliases: [],
        difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '13', internalLevelValue: 13, version: 'CIRCLE' }]
      },
      {
        songId: 'song:0000000000000002', favoriteId: '2', title: 'Old Song', artist: 'Artist', aliases: ['Old Alias'],
        difficultyLevels: [{ type: 'std', difficulty: 'expert', level: '12', internalLevelValue: 12, version: 'PRiSM PLUS' }]
      }
    ]
  };
}

test('chart rating follows achievement breakpoints, caps accuracy, and adds modern AP bonus', () => {
  assert.equal(calculateChartRating({ achievement: 1005000, fc: 'none', internalLevelValue: 12.7, gameVersion: 13 }), 285);
  assert.equal(calculateChartRating({ achievement: 1010000, fc: 'none', internalLevelValue: 12.7, gameVersion: 13 }), 285);
  assert.equal(calculateChartRating({ achievement: 1005000, fc: 'ap', internalLevelValue: 12.7, gameVersion: 13 }), 286);
  assert.equal(calculateChartRating({ achievement: 1005000, fc: 'ap', internalLevelValue: 12.7, gameVersion: 11 }), 285);
  assert.ok(calculateChartRating({ achievement: 970000, fc: 'none', internalLevelValue: 12.7, gameVersion: 13 }) < 285);
});

test('version resolution handles aliases and release boundaries', () => {
  assert.equal(resolveChartVersionId(' PRiSM Plus '), 11);
  assert.equal(resolveChartVersionId('maimai DX'), 0);
  assert.equal(resolveChartVersionId('unknown'), null);
  assert.equal(getCurrentIntlVersionId(Date.parse('2026-07-22T00:00:00Z')), 12);
  assert.equal(getCurrentIntlVersionId(Date.parse('2026-07-24T00:00:00Z')), 13);
  assert.equal(getCurrentIntlVersionId(Date.parse('2010-01-01T00:00:00Z')), null);
});

test('best-50 construction resolves charts and separates current/new and old buckets', () => {
  const result = buildBest50([
    { title: 'New Song', type: 'dx', difficulty: 'master', level: '13', achievement: 1000000, dxScore: 100, fc: 'fc', fs: 'none' },
    { title: 'Old Alias', type: 'std', difficulty: 'expert', level: '12', achievement: 995000, dxScore: 90, fc: 'none', fs: 'none' },
    { title: 'Missing', type: 'dx', difficulty: 'master', level: '13', achievement: 1000000 }
  ], catalogFixture());

  assert.equal(result.songCount, 2);
  assert.equal(result.b15[0].title, 'New Song');
  assert.equal(result.b35[0].title, 'Old Song');
  assert.equal(result.totalRating, result.top50.reduce((sum, row) => sum + row.rating, 0));
  assert.equal(buildBest50([], { available: false }), null);
});

test('gap suggestions keep reachable next ranks, calculate deltas, and sort deterministically', () => {
  const suggestions = computeGapSuggestions([
    { title: 'New Song', type: 'dx', difficulty: 'master', level: '13', achievement: 999000, fc: 'none' },
    { title: 'Old Song', type: 'std', difficulty: 'expert', level: '12', achievement: 960000, fc: 'none' },
    { title: 'Missing', type: 'dx', difficulty: 'master', level: '13', achievement: 999000, fc: 'none' },
    { title: 'Done', type: 'dx', difficulty: 'master', internalLevelValue: 13, achievement: 1005000, fc: 'ap' }
  ], catalogFixture());

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].title, 'New Song');
  assert.equal(suggestions[0].nextThreshold, 'SSS');
  assert.equal(suggestions[0].gap, 1000);
  assert.ok(suggestions[0].delta > 0);
});
