import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSimulatedAchievement,
  simulateAchievement,
  summarizeEnteredJudgments
} from '../src/score-simulator.js';

test('simulates TAP GREAT and MISS judgments with every other note critical', () => {
  const result = simulateAchievement(
    { tap: 100, hold: 0, slide: 0, touch: 0, break: 0, total: 100 },
    { tap: { great: 20, miss: 1 } }
  );

  assert.equal(result.achievement.exact, true);
  assert.equal(formatSimulatedAchievement(result.achievement.minimum), '95.0000%');
  assert.equal(result.achievement.minimumRank, 'AAA');
  assert.equal(result.dxScore, 257);
  assert.equal(result.maximumDxScore, 300);
  assert.deepEqual(summarizeEnteredJudgments(result), ['TAP: 20 GREAT · 1 MISS']);
});

test('non-BREAK PERFECT affects DX Score but not achievement', () => {
  const result = simulateAchievement(
    { tap: 10, hold: 0, slide: 0, touch: 0, break: 0 },
    { tap: { perfect: 2 } }
  );
  assert.equal(formatSimulatedAchievement(result.achievement.minimum), '100.0000%');
  assert.equal(result.dxScore, 28);
});

test('weights HOLD, SLIDE, TOUCH, and BREAK judgments independently', () => {
  const result = simulateAchievement(
    { tap: 1, hold: 1, slide: 1, touch: 1, break: 1, total: 5 },
    {
      hold: { great: 1 },
      slide: { good: 1 },
      touch: { miss: 1 },
      break: { good: 1 }
    }
  );

  assert.equal(result.achievement.exact, true);
  assert.equal(formatSimulatedAchievement(result.achievement.minimum), '51.1333%');
  assert.equal(result.dxScore, 4);
});

test('returns a range for coarse BREAK PERFECT and GREAT counts', () => {
  const perfect = simulateAchievement(
    { tap: 10, hold: 0, slide: 0, touch: 0, break: 2, total: 12 },
    { break: { perfect: 1 } }
  );
  assert.equal(perfect.achievement.exact, false);
  assert.equal(formatSimulatedAchievement(perfect.achievement.minimum), '100.7500%');
  assert.equal(formatSimulatedAchievement(perfect.achievement.maximum), '100.8750%');

  const great = simulateAchievement(
    { tap: 10, hold: 0, slide: 0, touch: 0, break: 2, total: 12 },
    { break: { great: 1 } }
  );
  assert.equal(formatSimulatedAchievement(great.achievement.minimum), '88.2000%');
  assert.equal(formatSimulatedAchievement(great.achievement.maximum), '95.7000%');
});

test('rejects incomplete chart data and impossible judgment totals', () => {
  assert.throws(
    () => simulateAchievement({ total: 100 }, { tap: { miss: 1 } }),
    /complete note breakdown/
  );
  assert.throws(
    () => simulateAchievement(
      { tap: 2, hold: 0, slide: 0, touch: 0, break: 0 },
      { tap: { great: 2, miss: 1 } }
    ),
    /only has 2 TAP notes/
  );
});
