import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGapRecommendationPage,
  GapRecommendationSessions,
  parseGapRecommendationCustomId
} from '../src/account-gap-view.js';

function recommendation(overrides = {}) {
  return {
    title: 'M@GICAL☆CURE! LOVE ♥ SHOT!',
    type: 'dx',
    difficulty: 'master',
    level: '13+',
    internalLevelValue: 13.6,
    achievement: 1_004_726,
    rating: 295,
    bucket: 'new',
    bucketTag: 'NEW',
    bucketLabel: 'B15',
    bucketCount: 15,
    bucketLimit: 15,
    cutoffRating: 290,
    isInBest: true,
    targetLabel: 'SSS+',
    targetAchievement: 1_005_000,
    targetRating: 306,
    ratingGain: 5,
    ...overrides
  };
}

test('buildGapRecommendationPage renders five jacket-backed cards and navigation', () => {
  const suggestions = Array.from({ length: 7 }, (_, index) =>
    recommendation({ title: `Song ${index + 1}` })
  );
  const page = buildGapRecommendationPage({
    sessionId: 'abcdefgh',
    playerName: 'NIKO☆',
    suggestions,
    imageUrls: new Map([[0, 'attachment://song-1.png']])
  });

  assert.equal(page.content, 'Rating recommendations for **NIKO☆**');
  assert.equal(page.embeds.length, 5);
  assert.equal(page.embeds[0].data.title, '1. Song 1');
  assert.equal(page.embeds[0].data.description, 'DX MASTER • Lv 13.6');
  assert.equal(page.embeds[0].data.fields[0].value, '100.4726% (295)');
  assert.equal(page.embeds[0].data.fields[1].value, '100.5000% (306)\n**+5 rating**');
  assert.equal(page.embeds[0].data.fields[2].value, 'NEW • Already in B15');
  assert.equal(page.embeds[0].data.thumbnail.url, 'attachment://song-1.png');
  assert.equal(page.components.length, 1);

  const controls = page.components[0].toJSON().components;
  assert.equal(controls.length, 5);
  assert.equal(controls[0].disabled, true);
  assert.equal(controls[2].label, '1/2');
  assert.equal(controls[3].disabled, false);
});

test('buildGapRecommendationPage explains entry and replacement cutoff', () => {
  const page = buildGapRecommendationPage({
    sessionId: 'abcdefgh',
    playerName: 'Player',
    suggestions: [recommendation({ isInBest: false, categoryTag: 'NEW', cutoffRating: 290 })]
  });

  assert.equal(page.embeds[0].data.fields[2].value, 'NEW • Enters B15\nReplaces cutoff: 290');
});

test('buildGapRecommendationPage preserves numbering and Re:MASTER styling across pages', () => {
  const suggestions = Array.from({ length: 7 }, (_, index) =>
    recommendation({
      title: `Song ${index + 1}`,
      difficulty: index === 5 ? 'remaster' : 'master'
    })
  );
  const page = buildGapRecommendationPage({
    sessionId: 'abcdefgh',
    playerName: 'NIKO☆',
    suggestions,
    page: 1
  });

  assert.equal(page.embeds.length, 2);
  assert.equal(page.embeds[0].data.title, '6. Song 6');
  assert.equal(page.embeds[0].data.description, 'DX Re:MASTER • Lv 13.6');
  assert.equal(page.embeds[0].data.color, 0xdfc8ff);

  const controls = page.components[0].toJSON().components;
  assert.equal(controls[0].disabled, false);
  assert.equal(controls[2].label, '2/2');
  assert.equal(controls[4].disabled, true);
});

test('buildGapRecommendationPage identifies an all-perfect target', () => {
  const page = buildGapRecommendationPage({
    sessionId: 'abcdefgh',
    playerName: 'Player',
    suggestions: [recommendation({ targetLabel: 'AP' })]
  });

  assert.equal(page.embeds[0].data.fields[1].value, 'AP · 100.5000% (306)\n**+5 rating**');
  assert.deepEqual(page.components, []);
});

test('parseGapRecommendationCustomId accepts only active navigation actions', () => {
  assert.deepEqual(parseGapRecommendationCustomId('gap:abcdefgh:next'), {
    sessionId: 'abcdefgh',
    action: 'next'
  });
  assert.equal(parseGapRecommendationCustomId('gap:short:next'), null);
  assert.equal(parseGapRecommendationCustomId('gap:abcdefgh:page'), null);
  assert.equal(parseGapRecommendationCustomId('other:abcdefgh:next'), null);
});

test('GapRecommendationSessions owns paging state and expires sessions', () => {
  let now = 1_000;
  const sessions = new GapRecommendationSessions({ ttlMs: 500, now: () => now });
  sessions.create('abcdefgh', {
    ownerId: 'user-1',
    suggestions: Array.from({ length: 7 }, () => recommendation())
  });

  assert.equal(sessions.move('abcdefgh', 'next').page, 1);
  assert.equal(sessions.move('abcdefgh', 'next').page, 1);
  assert.equal(sessions.move('abcdefgh', 'first').page, 0);
  assert.equal(sessions.get('abcdefgh').ownerId, 'user-1');

  now = 1_500;
  assert.equal(sessions.get('abcdefgh'), null);
});
