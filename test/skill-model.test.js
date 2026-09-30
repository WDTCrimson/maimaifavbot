import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillProfile,
  estimateRunSigma,
  formatOdds,
  fromLatent,
  oddsBand,
  predictChart,
  rankForAchievement,
  targetOdds,
  toLatent
} from '../src/skill-model.js';

function best(index, overrides = {}) {
  const constant = overrides.constant ?? 11 + (index % 35) / 10;
  return {
    key: `song-${index}::dx::${overrides.difficulty || 'master'}`,
    songId: `song-${index}`,
    type: 'dx',
    difficulty: overrides.difficulty || 'master',
    constant,
    internalLevelValue: constant,
    achievement: Math.round((overrides.achievement ?? (101.2 - constant * 0.18)) * 10000),
    playCount: overrides.playCount ?? 8
  };
}

function profileWith(count, params = {}) {
  return buildSkillProfile(Array.from({ length: count }, (_, index) => best(index)), [], null, params);
}

function gaussianGenerator(seed = 123456789) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state + 1) / 4294967297;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

test('latent achievement conversion round trips near the score cap', () => {
  for (const achievement of [0, 97, 99.5, 100.5, 101]) {
    assert.ok(Math.abs(fromLatent(toLatent(achievement)) - achievement) < 1e-9);
  }
});

test('confidence gate is inclusive at exactly 20 nearby and 50 total bests', () => {
  const chart = { songId: 'target', type: 'dx', difficulty: 'master', constant: 13 };
  const gatedTotal = profileWith(49, { minNearbyBests: 0 });
  const totalResult = predictChart(gatedTotal, chart);
  assert.equal(totalResult.insufficient, true);
  assert.equal(totalResult.total, 49);

  const scores = Array.from({ length: 50 }, (_, index) => best(index, {
    constant: index < 19 ? 13 : 9 + index / 100
  }));
  const gatedNearby = buildSkillProfile(scores);
  assert.equal(predictChart(gatedNearby, chart).insufficient, true);
  scores[19] = best(19, { constant: 13 });
  const accepted = buildSkillProfile(scores);
  assert.equal(predictChart(accepted, chart).insufficient, false);
});

test('rank odds are monotone, targets above 101 are impossible, and hard charts are capped at S', () => {
  const profile = profileWith(70, { nearbyConstantWindow: 10 });
  const result = predictChart(profile, { songId: 'hard', type: 'dx', difficulty: 'master', constant: 15.5 });
  const ordered = ['S', 'S+', 'SS', 'SS+', 'SSS', 'SSS+'].map((rank) => result.oddsByRank[rank]);
  for (let index = 1; index < ordered.length; index += 1) assert.ok(ordered[index] <= ordered[index - 1]);
  assert.ok(result.bestExpected <= 97);
  assert.equal(result.capped, true);
  assert.equal(targetOdds(toLatent(99), 0.1, 101.00001), 0);

  const impossible = predictChart(profile, { songId: 'normal', type: 'dx', difficulty: 'master', constant: 13 });
  assert.equal(impossible.oddsByRank['SSS+'] >= 0, true);
  assert.equal(rankForAchievement(100.5), 'SSS+');
});

test('a heavily played best has lower one-run new-best odds', () => {
  const profile = profileWith(70);
  const chart = { songId: 'target', type: 'dx', difficulty: 'master', constant: 13 };
  const achievement = 98.5 * 10000;
  const low = predictChart(profile, chart, { ...chart, achievement, playCount: 1 });
  const high = predictChart(profile, chart, { ...chart, achievement, playCount: 200 });
  assert.ok(high.expected < low.expected);
  assert.ok(high.newBestSingleRunOdds < low.newBestSingleRunOdds);
});

test('an unplayed chart gets a lower centre and wider spread than a played chart', () => {
  const profile = profileWith(70);
  const chart = { songId: 'target', type: 'dx', difficulty: 'master', constant: 13 };
  const played = predictChart(profile, chart, { ...chart, achievement: 98.5 * 10000, playCount: 1 });
  const firstPass = predictChart(profile, chart);
  assert.equal(firstPass.firstPass, true);
  assert.ok(firstPass.expected < firstPass.bestExpected);
  assert.ok(firstPass.sigmaLatent > played.sigmaLatent);
  assert.equal(firstPass.newBestOdds, 1);
});

test('one dropped low-play best is excluded while an Expert-only profile remains valid', () => {
  const steady = Array.from({ length: 60 }, (_, index) => best(index, { difficulty: 'expert' }));
  const dropped = best(999, { constant: 13, achievement: 88, playCount: 1, difficulty: 'expert' });
  const profile = buildSkillProfile([...steady, dropped]);
  assert.ok(profile.curve.droppedKeys.includes(dropped.key));
  assert.ok(Number.isFinite(profile.curve.intercept));
  assert.equal(profile.curve.difficultyOffsets.expert, 0);
});

test('same-day repeat estimator removes improvement trend and recovers known latent sigma', () => {
  const random = gaussianGenerator();
  const knownSigma = 0.08;
  const history = Array.from({ length: 800 }, (_, index) => {
    const latent = toLatent(98.5) - index * 0.0002 + random() * knownSigma;
    return {
      key: 'repeat::dx::master',
      songId: 'repeat',
      type: 'dx',
      difficulty: 'master',
      constant: 13,
      achievement: fromLatent(latent),
      playedAtIso: `2026-01-01T${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`
    };
  });
  const result = estimateRunSigma(history, null, { minimumPairs: 30 });
  assert.equal(result.eligible, true);
  assert.ok(Math.abs(result.sigmaLatent - knownSigma) / knownSigma < 0.1, `${result.sigmaLatent} was not within 10% of ${knownSigma}`);
});

test('odds bands include every exact boundary', () => {
  assert.equal(oddsBand(0.5), 'likely');
  assert.equal(oddsBand(0.25), 'possible');
  assert.equal(oddsBand(0.1), 'stretch');
  assert.equal(oddsBand(0.099), 'unlikely');
  assert.equal(formatOdds(0.2), 'stretch');
  assert.equal(formatOdds(0.2, true), '1 in 5 (20%)');
});
