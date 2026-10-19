import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLevelSummaryGraphic, selectLevelSummaryEntries } from '../src/level-summary-graphic.js';

const scores = [
  { title: 'Expert 13+', difficulty: 'expert', type: 'dx', internalLevelValue: 13.6, achievement: 990000 },
  { title: 'Master 13+', difficulty: 'master', type: 'dx', internalLevelValue: 13.7, achievement: 995000 },
  { title: 'Re:MASTER 13+', difficulty: 'remaster', type: 'std', internalLevelValue: 13.9, achievement: 1000000 },
  { title: 'Master 13', difficulty: 'master', type: 'dx', internalLevelValue: 13.5, achievement: 1005000 },
  { title: 'Utage 13+', difficulty: 'utage', type: 'dx', internalLevelValue: 13.8, achievement: 970000 }
];

test('level summary defaults to every standard difficulty in the selected bracket', () => {
  const selected = selectLevelSummaryEntries({ scores, levelBracket: '13+', songCatalog: null });
  assert.deepEqual(selected.map((entry) => entry.difficulty), ['expert', 'master', 'remaster']);
});

test('level summary can still select one difficulty', () => {
  const selected = selectLevelSummaryEntries({ scores, difficulty: 'master', levelBracket: '13+', songCatalog: null });
  assert.deepEqual(selected.map((entry) => entry.title), ['Master 13+']);
});

test('all-difficulty graphic combines matching difficulties into one compact image', async () => {
  const graphic = await renderLevelSummaryGraphic({
    account: { player: { name: 'Test' }, gameVersion: 13 },
    scores,
    difficulty: 'all',
    levelBracket: '13+',
    songCatalog: null
  });
  assert.equal(graphic.fileName, 'Test-level-13plus-all.png');
  assert.deepEqual(graphic.buffer.subarray(1, 4).toString(), 'PNG');
});
