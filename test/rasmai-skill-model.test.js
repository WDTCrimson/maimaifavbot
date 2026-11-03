import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHybridSkillProfile, predictHybridChart } from '../src/hybrid-skill-model.js';
import { buildRasmaiSkillProfile, predictRasmaiChart } from '../src/rasmai-skill-model.js';
import { predictChart } from '../src/skill-model.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
}

function syntheticBests(count = 36) {
  return Array.from({ length: count }, (_, index) => {
    const constant = 11 + (index % 8) * 0.5;
    const difficulty = index % 3 === 0 ? 'expert' : 'master';
    return {
      key: `synthetic ${index}|dx|${difficulty}`,
      songId: `synthetic-${index}`,
      title: `synthetic ${index}`,
      type: 'dx',
      difficulty,
      constant,
      achievement: 102.1 - constant * 0.31 + (((index * 7) % 9) - 4) * 0.08,
      playCount: 3 + (index % 7)
    };
  });
}

function syntheticHistory(bests) {
  return Array.from({ length: 21 }, (_, index) => {
    const source = bests[(index % 3) * 3 + 1];
    return {
      ...source,
      achievement: source.achievement - 0.7 + (index % 5) * 0.19,
      best_before: source.achievement - 0.2,
      played_at: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`
    };
  });
}

test('JavaScript port matches the Rasmai Python oracle on a synthetic calibrated profile', () => {
  const bests = syntheticBests();
  const profile = buildRasmaiSkillProfile(bests, syntheticHistory(bests));
  const prediction = predictRasmaiChart(profile, bests[4], bests[4]);

  close(profile.curveIntercept, 102.24160237388728);
  close(profile.curveSlope, -0.31170919881305864);
  close(profile.consistency, 0.4);
  close(profile.runConsistency, 0.44456844103952914);
  close(profile.sigmaScale, 0.95);
  close(profile.calibrationShift, -0.01);
  assert.equal(profile.calibration.plays, 21);
  close(prediction.expected, 97.83);
  close(prediction.sigma, 0.45150047193572085);
  close(prediction.newBestOdds, 0.5, 1e-7);
  assert.equal(prediction.rank, 'S');
});

test('hybrid keeps MaiDeck for first passes and selects Rasmai for repeat plays', () => {
  const bests = syntheticBests(64);
  const history = syntheticHistory(bests).map((play) => ({
    ...play,
    bestBefore: play.best_before,
    playedAtIso: play.played_at
  }));
  const profile = buildHybridSkillProfile(bests, history, null, { nearbyConstantWindow: 10 });
  const chart = { key: 'unseen|dx|master', songId: 'unseen', type: 'dx', difficulty: 'master', constant: 13 };

  const baselineFirstPass = predictChart(profile.maideck, chart);
  const hybridFirstPass = predictHybridChart(profile, chart);
  assert.equal(hybridFirstPass.modelSource, 'maideck-first-pass');
  assert.equal(hybridFirstPass.expected, baselineFirstPass.expected);
  assert.equal(hybridFirstPass.sigma, baselineFirstPass.sigma);

  const repeat = predictHybridChart(profile, bests[4], bests[4]);
  assert.equal(repeat.modelSource, 'rasmai-repeat');
  assert.equal(repeat.firstPass, false);
  assert.equal(repeat.baseline.modelSource, undefined);
  assert.notEqual(repeat.expected, repeat.baseline.expected);
});
