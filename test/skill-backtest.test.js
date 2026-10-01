import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParameterArtifact,
  fixturePlayers,
  parseParameterArtifact,
  runBacktest,
  runFrozenEvaluation,
  runTuning
} from '../scripts/backtest-skill-model.js';

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

test('training-only tuning does not evaluate or expose held-out metrics', () => {
  const result = runTuning(fixturePlayers(), 'test fixture');
  assert.ok(result.tuning.count > 0);
  assert.ok(result.candidates.length > 1);
  assert.equal('heldOut' in result, false);
  assert.match(result.split, /held-out 20% not evaluated/);
});

test('frozen parameters exclude the training cohort and evaluate only fresh profiles', () => {
  const trainingPlayers = fixturePlayers();
  const tuning = runTuning(trainingPlayers, 'training fixture');
  const artifact = buildParameterArtifact(trainingPlayers, tuning, 'fixed-test-salt');
  const freshPlayers = fixturePlayers().map((player) => ({
    ...player,
    sourceIdentity: `fresh/${player.sourceIdentity}`
  }));
  const result = runFrozenEvaluation([...trainingPlayers, ...freshPlayers], 'external fixture', artifact);

  assert.equal(result.excludedPlayerCount, trainingPlayers.length);
  assert.equal(result.perPlayer.length, freshPlayers.length);
  assert.equal(result.pass, true);
  assert.equal(JSON.stringify(artifact).includes('steady'), false);
});

test('frozen evaluation fails closed without an eligible fresh cohort', () => {
  const players = fixturePlayers();
  const artifact = buildParameterArtifact(players, runTuning(players, 'training fixture'), 'fixed-test-salt');
  assert.throws(
    () => runFrozenEvaluation(players, 'same fixture', artifact),
    /No fresh profiles remain/
  );
  assert.throws(
    () => parseParameterArtifact({ ...artifact, schemaVersion: 999 }),
    /Unsupported skill-model parameter artifact/
  );
});
