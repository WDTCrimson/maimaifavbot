import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreSimulatorView,
  parseScoreSimulatorCustomId,
  ScoreSimulatorSessions,
  simulatableChartsForSong
} from '../src/score-simulator-view.js';

function chart(overrides = {}) {
  return {
    type: 'dx',
    difficulty: 'master',
    level: '12',
    noteCounts: { tap: 100, hold: 0, slide: 0, touch: 0, break: 0, total: 100 },
    ...overrides
  };
}

test('interactive simulator renders chart, type, judgment, adjustment, and finish controls', () => {
  const sessions = new ScoreSimulatorSessions();
  const session = sessions.create('abcdefgh', {
    ownerId: 'user',
    song: { title: 'Test Song' },
    charts: [chart()]
  });
  const view = buildScoreSimulatorView('abcdefgh', session);

  assert.equal(view.components.length, 5);
  assert.equal(view.components[0].toJSON().components[0].custom_id, 'score-sim:abcdefgh:chart');
  assert.equal(view.components[1].toJSON().components[0].custom_id, 'score-sim:abcdefgh:type');
  assert.equal(view.components[2].toJSON().components[0].custom_id, 'score-sim:abcdefgh:judgment');
  assert.deepEqual(
    view.components[3].toJSON().components.map((component) => component.label),
    ['−10', '−1', '+1', '+10', 'Reset']
  );
  assert.match(view.embeds[0].data.fields.at(-1).value, /100\.0000%/);
});

test('button adjustments update the live score and retain independent counts per chart', () => {
  const sessions = new ScoreSimulatorSessions();
  const session = sessions.create('abcdefgh', {
    ownerId: 'user',
    song: { title: 'Test Song' },
    charts: [
      chart(),
      chart({ type: 'std', difficulty: 'expert', level: '10', noteCounts: { tap: 10, hold: 0, slide: 0, touch: 0, break: 0 } })
    ]
  });

  sessions.apply('abcdefgh', 'plus10');
  sessions.apply('abcdefgh', 'plus10');
  sessions.apply('abcdefgh', 'judgment', 'miss');
  sessions.apply('abcdefgh', 'plus1');
  let view = buildScoreSimulatorView('abcdefgh', session);
  assert.match(view.embeds[0].data.fields.find((field) => field.name === 'All entered judgments').value, /20 GREAT · 1 MISS/);
  assert.match(view.embeds[0].data.fields.at(-1).value, /95\.0000%/);

  sessions.apply('abcdefgh', 'chart', '1');
  view = buildScoreSimulatorView('abcdefgh', session);
  assert.match(view.embeds[0].data.fields.find((field) => field.name === 'All entered judgments').value, /None yet/);
  sessions.apply('abcdefgh', 'plus10');
  sessions.apply('abcdefgh', 'plus10');
  assert.equal(session.judgmentsByChart['1'].tap.miss, 10);

  sessions.apply('abcdefgh', 'chart', '0');
  assert.equal(session.judgmentsByChart['0'].tap.great, 20);
  assert.equal(session.judgmentsByChart['0'].tap.miss, 1);
});

test('done removes controls, custom IDs parse strictly, and sessions expire', () => {
  let now = 1000;
  const sessions = new ScoreSimulatorSessions({ ttlMs: 500, now: () => now });
  const session = sessions.create('abcdefgh', {
    ownerId: 'user',
    song: { title: 'Test Song' },
    charts: [chart()]
  });

  assert.deepEqual(parseScoreSimulatorCustomId('score-sim:abcdefgh:plus10'), {
    sessionId: 'abcdefgh',
    action: 'plus10'
  });
  assert.equal(parseScoreSimulatorCustomId('score-sim:bad:plus10'), null);
  sessions.apply('abcdefgh', 'done');
  assert.equal(buildScoreSimulatorView('abcdefgh', session).components.length, 0);
  now = 1500;
  assert.equal(sessions.get('abcdefgh'), null);
});

test('chart choices exclude incomplete note breakdowns', () => {
  const charts = simulatableChartsForSong({
    difficultyLevels: [
      chart({ difficulty: 'basic', level: '3' }),
      chart({ difficulty: 'advanced', level: '6', noteCounts: { total: 100 } })
    ]
  });
  assert.equal(charts.length, 1);
  assert.equal(charts[0].difficulty, 'basic');
});
