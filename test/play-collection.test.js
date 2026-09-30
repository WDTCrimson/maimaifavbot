import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlayCollectionObservation,
  defaultPlayCollectionState,
  isQuietReadDue
} from '../src/play-collection.js';

test('play collection establishes a baseline, counts a continuous window, and detects overflow', () => {
  const baseline = applyPlayCollectionObservation(defaultPlayCollectionState(), {
    playCount: 100,
    newlyCaptured: 15,
    observedAt: '2026-09-01T00:00:00.000Z'
  });
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.state.continuousPlays, 0);

  const continuous = applyPlayCollectionObservation(baseline.state, {
    playCount: 104,
    newlyCaptured: 4,
    observedAt: '2026-09-02T00:00:00.000Z',
    quiet: true
  });
  assert.equal(continuous.gap, null);
  assert.equal(continuous.state.continuousPlays, 4);
  assert.equal(continuous.state.quietReadAt, '2026-09-02T00:00:00.000Z');

  const overflow = applyPlayCollectionObservation(continuous.state, {
    playCount: 124,
    newlyCaptured: 15,
    observedAt: '2026-09-03T00:00:00.000Z'
  });
  assert.equal(overflow.gap.missingPlays, 5);
  assert.equal(overflow.state.continuousPlays, 0);
  assert.equal(overflow.state.gapsDetected, 1);
});

test('quiet-read due check enforces the 20-hour floor and backoff', () => {
  const now = Date.parse('2026-09-02T00:00:00.000Z');
  assert.equal(isQuietReadDue({ historyEnabled: false }, now), false);
  assert.equal(isQuietReadDue({ historyEnabled: true, quietReadAt: null }, now), true);
  assert.equal(isQuietReadDue({ historyEnabled: true, quietReadAt: '2026-09-01T05:00:00.000Z' }, now, 1), false);
  assert.equal(isQuietReadDue({ historyEnabled: true, quietReadAt: '2026-09-01T03:00:00.000Z' }, now, 1), true);
  assert.equal(isQuietReadDue({ historyEnabled: true, backoffUntil: '2026-09-02T01:00:00.000Z' }, now), false);
});
