import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBest50,
  calculateChartRating,
  computeRatingRecommendations,
  getCurrentIntlVersionId,
  mapRecentDifficultyFromIcon,
  resolvePlayCountDetailLookups,
  resolveChartVersionId,
  reusePreviousPlayCounts
} from '../src/maimai-intl.js';

test('recent-play difficulty parser distinguishes Re:MASTER from MASTER', () => {
  assert.equal(mapRecentDifficultyFromIcon('/maimai-mobile/img/diff_remaster.png'), 'remaster');
  assert.equal(mapRecentDifficultyFromIcon('/maimai-mobile/img/diff_master.png'), 'master');
  assert.equal(mapRecentDifficultyFromIcon('/maimai-mobile/img/diff_expert.png'), 'expert');
  assert.equal(mapRecentDifficultyFromIcon('/maimai-mobile/img/unknown.png'), null);
});

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

function recommendationFixture(specs) {
  return {
    available: true,
    songs: specs.map((spec, index) => ({
      songId: `song:${String(index + 1).padStart(16, '0')}`,
      favoriteId: String(index + 1),
      title: spec.title,
      artist: 'Artist',
      aliases: [],
      difficultyLevels: [{
        type: spec.type || 'dx',
        difficulty: spec.difficulty || 'master',
        level: spec.level || String(spec.constant),
        internalLevelValue: spec.constant,
        version: spec.version || 'CIRCLE'
      }]
    }))
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

test('rating recommendations report the actual gain for a chart already in B15', () => {
  const recommendations = computeRatingRecommendations([
    { title: 'New Song', type: 'dx', difficulty: 'master', level: '13', achievement: 1000000, fc: 'none' }
  ], catalogFixture(), { gameVersion: 13 });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].title, 'New Song');
  assert.equal(recommendations[0].categoryTag, 'B15');
  assert.equal(recommendations[0].targetLabel, '100.50%');
  assert.equal(
    recommendations[0].ratingGain,
    recommendations[0].targetRating - recommendations[0].rating
  );
});

test('rating recommendations use the matching B15 floor and reject targets with no account gain', () => {
  const newBest = Array.from({ length: 15 }, (_, index) => ({
    title: `New Best ${index + 1}`,
    constant: 10,
    version: 'CIRCLE'
  }));
  const oldBest = Array.from({ length: 35 }, (_, index) => ({
    title: `Old Best ${index + 1}`,
    constant: 13,
    version: 'PRiSM PLUS'
  }));
  const specs = [
    ...newBest,
    ...oldBest,
    { title: 'New Outside', constant: 12, version: 'CIRCLE' },
    { title: 'Old Outside', constant: 14, version: 'PRiSM PLUS' },
    { title: 'Impossible Outside', constant: 8, version: 'CIRCLE' }
  ];
  const scores = specs.map((spec) => ({
    title: spec.title,
    type: 'dx',
    difficulty: 'master',
    level: String(spec.constant),
    achievement: spec.title.endsWith('Outside') ? 969000 : 1000000,
    fc: 'none'
  }));
  const recommendations = computeRatingRecommendations(scores, recommendationFixture(specs), { gameVersion: 13 });
  const newOutside = recommendations.find((entry) => entry.title === 'New Outside');
  const oldOutside = recommendations.find((entry) => entry.title === 'Old Outside');

  assert.ok(newOutside);
  assert.equal(newOutside.categoryTag, 'NEW');
  assert.equal(newOutside.targetLabel, '97.00%');
  assert.equal(newOutside.ratingGain, newOutside.targetRating - 216);
  assert.ok(oldOutside);
  assert.equal(oldOutside.categoryTag, 'OLD');
  assert.equal(oldOutside.targetLabel, '99.00%');
  assert.equal(oldOutside.ratingGain, oldOutside.targetRating - 280);
  assert.equal(recommendations.some((entry) => entry.title === 'Impossible Outside'), false);
});

test('rating recommendations deduplicate charts, offer modern AP, and exclude utage', () => {
  const specs = [
    { title: 'AP Candidate', constant: 12, version: 'CIRCLE' },
    { title: 'Party Chart', constant: 12, version: 'CIRCLE', difficulty: 'utage' }
  ];
  const recommendations = computeRatingRecommendations([
    { title: 'AP Candidate', type: 'dx', difficulty: 'master', level: '12', achievement: 1000000, fc: 'none' },
    { title: 'AP Candidate', type: 'dx', difficulty: 'master', level: '12', achievement: 1005000, fc: 'none' },
    { title: 'Party Chart', type: 'dx', difficulty: 'utage', level: '12', achievement: 1000000, fc: 'none' }
  ], recommendationFixture(specs), { gameVersion: 13 });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].title, 'AP Candidate');
  assert.equal(recommendations[0].targetLabel, 'AP');
  assert.equal(recommendations[0].ratingGain, 1);
});

test('rating recommendations do not offer AP before the modern AP rating bonus', () => {
  const specs = [{ title: 'Old AP Candidate', constant: 12, version: 'PRiSM PLUS' }];
  const recommendations = computeRatingRecommendations([
    { title: 'Old AP Candidate', type: 'dx', difficulty: 'master', level: '12', achievement: 1005000, fc: 'none' }
  ], recommendationFixture(specs), { gameVersion: 11 });

  assert.deepEqual(recommendations, []);
});

test('play-count detail repair reuses duplicate detail pages', async () => {
  let fetchCalls = 0;
  const stats = {};
  const lookups = [
    { mapKey: 'A::basic::std', detailParams: 'idx=A', difficultyNumber: 0 },
    { mapKey: 'B::advanced::std', detailParams: 'idx=B', difficultyNumber: 1 },
    { mapKey: 'C::expert::dx', detailParams: 'idx=C', difficultyNumber: 2 },
    { mapKey: 'D::master::std', detailParams: 'idx=D', difficultyNumber: 3 },
    { mapKey: 'A::master::std', detailParams: 'idx=A', difficultyNumber: 3 }
  ];

  const results = await resolvePlayCountDetailLookups(lookups, {
    stats,
    fetchMetadata: async (detailParams) => {
      fetchCalls += 1;
      const base = detailParams.charCodeAt(detailParams.length - 1) - 64;
      return new Map(Array.from({ length: 5 }, (_, difficultyNumber) => [
        difficultyNumber,
        { playCount: base * 10 + difficultyNumber }
      ]));
    }
  });

  assert.equal(fetchCalls, 4);
  assert.equal(results.get('A::basic::std'), 10);
  assert.equal(results.get('A::master::std'), 13);
  assert.equal(stats.scoreDetailPageFetches, 4);
  assert.equal(stats.scoreDetailCacheHits, 1);
  assert.equal(stats.scoreDetailSuccesses, 5);
  assert.equal(stats.scoreDetailFailures || 0, 0);
});

test('play-count sync reuses stable previous counts and leaves recently played charts for repair', () => {
  const currentScores = [
    { title: 'Song A', difficulty: 'basic', type: 'std', playCount: null },
    { title: 'Song B', difficulty: 'master', type: 'dx', playCount: null },
    { title: 'Song C', difficulty: 'expert', type: 'std', playCount: null }
  ];
  const previousScores = [
    { title: 'Song A', difficulty: 'basic', type: 'std', playCount: 2 },
    { title: 'Song B', difficulty: 'master', type: 'dx', playCount: 7 }
  ];
  const stats = {};

  const reused = reusePreviousPlayCounts(currentScores, {
    previousSnapshot: { metrics: { playCount: 20 } },
    previousScores,
    recentPlays: [{ title: 'Song B', difficulty: 'master', type: 'dx' }],
    currentSnapshot: { metrics: { playCount: 21 } }
  }, stats);

  assert.equal(reused[0].playCount, 2);
  assert.equal(reused[1].playCount, null);
  assert.equal(reused[2].playCount, null);
  assert.equal(stats.playCountReuseStrategy, 'recent-play-delta');
  assert.equal(stats.totalPlayCountDelta, 1);
  assert.equal(stats.reusedPlayCounts, 1);

  const unchanged = reusePreviousPlayCounts(currentScores, {
    previousSnapshot: { extra: { totalPlayCount: 20 } },
    previousScores,
    recentPlays: [],
    currentSnapshot: { metrics: { playCount: 20 } }
  });
  assert.equal(unchanged[0].playCount, 2);
  assert.equal(unchanged[1].playCount, 7);

  const overflowStats = {};
  const unsafeDelta = reusePreviousPlayCounts(currentScores, {
    previousSnapshot: { metrics: { playCount: 20 } },
    previousScores,
    recentPlays: [{ title: 'Song B', difficulty: 'master', type: 'dx' }],
    currentSnapshot: { metrics: { playCount: 22 } }
  }, overflowStats);
  assert.deepEqual(unsafeDelta, currentScores);
  assert.equal(overflowStats.playCountReuseStrategy, 'full-repair-recent-overflow');
  assert.equal(overflowStats.reusedPlayCounts, 0);
});
