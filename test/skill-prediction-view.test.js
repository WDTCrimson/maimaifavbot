import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillPredictionEmbed,
  findPredictionBest,
  findPredictionChart
} from '../src/skill-prediction-view.js';

const chart = {
  type: 'dx',
  difficulty: 'master',
  internalLevel: '13+',
  internalLevelValue: 13.7
};
const song = { songId: 'song-1', title: 'Test Song', difficultyLevels: [chart] };
const catalog = {
  getByStoredId(id) { return id === song.songId ? song : null; },
  getUniqueByNormalizedTitle(title) { return title === song.title ? song : null; },
  getByAlias() { return null; }
};

test('prediction chart and personal best resolution use the exact chart identity', () => {
  assert.equal(findPredictionChart(song, 'DX', 'MASTER'), chart);
  assert.equal(findPredictionChart(song, 'std', 'master'), chart);

  const best = findPredictionBest([{
    songId: song.songId,
    type: 'dx',
    difficulty: 'master',
    achievement: 99.1234,
    playCount: 4
  }], catalog, song, chart);
  assert.equal(best.achievement, 99.1234);
  assert.equal(best.constant, 13.7);
});

test('title-only legacy scores recover the canonical song ID before best matching', () => {
  const best = findPredictionBest([{
    title: song.title,
    type: 'dx',
    difficulty: 'master',
    achievement: 99.7206,
    playCount: 2
  }], catalog, song, chart);

  assert.equal(best.songId, song.songId);
  assert.equal(best.achievement, 99.7206);
  assert.equal(best.constant, 13.7);
});

test('prediction chart resolution repairs unavailable types and prefers a played chart', () => {
  const standard = { ...chart, type: 'std' };
  const standardOnly = { ...song, difficultyLevels: [standard] };
  assert.equal(findPredictionChart(standardOnly, 'dx', 'master'), standard);
  assert.equal(findPredictionChart(standardOnly, null, 'master'), standard);

  const dualSong = { ...song, difficultyLevels: [standard, chart] };
  const standardScore = {
    songId: song.songId,
    type: 'std',
    difficulty: 'master',
    achievement: 98.5,
    playCount: 8
  };
  const dualCatalog = { ...catalog, getByStoredId(id) { return id === song.songId ? dualSong : null; } };
  assert.equal(findPredictionChart(dualSong, null, 'master', [standardScore], dualCatalog), standard);
  assert.equal(findPredictionChart(dualSong, 'dx', 'master', [standardScore], dualCatalog), chart);
  assert.equal(findPredictionChart(dualSong, null, 'master', [], dualCatalog), chart);
});

test('prediction embed exposes qualitative target bands without numeric odds', () => {
  const json = buildSkillPredictionEmbed({
    song,
    chart,
    best: { achievement: 99.1234, playCount: 4 },
    prediction: {
      expected: 99.4321,
      rank: 'SS',
      modelSource: 'rasmai-repeat',
      oddsByRank: { S: 0.9, 'S+': 0.7, SS: 0.4, 'SS+': 0.2, SSS: 0.08, 'SSS+': 0.01 }
    },
    imageUrl: 'attachment://jacket.png'
  }).toJSON();
  const outlook = json.fields.find((field) => field.name === 'Rank status and next-run outlook').value;

  assert.match(json.title, /Next-play estimate/);
  assert.match(outlook, /\*\*SS\*\* — Achieved/);
  assert.match(outlook, /\*\*SS\+\*\* — Stretch/);
  assert.match(outlook, /Stretch/);
  assert.match(outlook, /Unlikely/);
  assert.doesNotMatch(outlook, /\d+%|1 in \d+/);
  assert.match(json.fields.find((field) => field.name === 'Model').value, /Rasmai-derived/);
  assert.equal(json.thumbnail.url, 'attachment://jacket.png');
});

test('rank targets at or below the personal best are marked achieved', () => {
  const json = buildSkillPredictionEmbed({
    song,
    chart,
    best: { achievement: 99.7206, playCount: 2 },
    prediction: {
      expected: 99.35,
      rank: 'SS',
      modelSource: 'rasmai-repeat',
      oddsByRank: { S: 0.99, 'S+': 0.95, SS: 0.68, 'SS+': 0.42, SSS: 0.19, 'SSS+': 0.03 }
    }
  }).toJSON();
  const outlook = json.fields.find((field) => field.name === 'Rank status and next-run outlook').value;

  assert.match(outlook, /\*\*S\*\* — Achieved/);
  assert.match(outlook, /\*\*S\+\*\* — Achieved/);
  assert.match(outlook, /\*\*SS\*\* — Achieved/);
  assert.match(outlook, /\*\*SS\+\*\* — Achieved/);
  assert.match(outlook, /\*\*SSS\*\* — Stretch/);
  assert.match(outlook, /\*\*SSS\+\*\* — Unlikely/);
});
