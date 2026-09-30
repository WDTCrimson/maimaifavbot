import test from 'node:test';
import assert from 'node:assert/strict';
import { fixturePlayers, runBacktest } from '../scripts/backtest-skill-model.js';

test('fixture backtest uses held-out charts and beats its bucket-median baseline', () => {
  const first = runBacktest(fixturePlayers(), 'test fixture');
  const second = runBacktest(fixturePlayers(), 'test fixture');
  assert.equal(first.pass, true);
  assert.ok(first.heldOut.count > 0);
  assert.ok(first.heldOut.mae < first.heldOut.baselineMae);
  assert.ok(first.heldOut.rankHitRate > first.heldOut.baselineRankHitRate);
  assert.deepEqual(first.selected, second.selected);
  assert.equal(first.calibration.numericOddsEnabled, false);
});
