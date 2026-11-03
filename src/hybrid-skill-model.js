import {
  achievementPercent,
  buildSkillProfile,
  normalizeSkillModelChartRow,
  predictChart
} from './skill-model.js';
import { buildRasmaiSkillProfile, predictRasmaiChart } from './rasmai-skill-model.js';

function normalizeRecordedPlay(raw, catalog) {
  const row = normalizeSkillModelChartRow(raw, catalog);
  if (!row) return null;
  return {
    ...row,
    bestBefore: achievementPercent(raw?.bestBefore ?? raw?.best_before) ?? 0,
    playedAtIso: raw?.playedAtIso || raw?.playedAt || raw?.played_at || raw?.played_at_iso || ''
  };
}

export function buildHybridSkillProfile(scores, history = [], catalog = null, suppliedParams = {}) {
  const maideck = buildSkillProfile(scores, history, catalog, suppliedParams);
  const recordedPlays = (Array.isArray(history) ? history : [])
    .map((raw) => normalizeRecordedPlay(raw, catalog))
    .filter(Boolean);
  const chartCeiling = maideck.bests.reduce((maximum, best) => Math.max(maximum, best.constant), 15);
  return {
    model: 'maideck-rasmai-hybrid',
    maideck,
    rasmai: buildRasmaiSkillProfile(maideck.bests, recordedPlays, { chartCeiling })
  };
}

export function predictHybridChart(profile, rawChart, rawBest = null) {
  if (!profile?.maideck || !profile?.rasmai) throw new Error('A hybrid skill profile is required.');
  const baseline = predictChart(profile.maideck, rawChart, rawBest);
  if (!rawBest) return { ...baseline, modelSource: 'maideck-first-pass' };
  const repeat = predictRasmaiChart(profile.rasmai, rawChart, rawBest);
  if (!repeat) return { ...baseline, modelSource: 'maideck-fallback' };
  return {
    ...repeat,
    nearby: baseline.nearby,
    baseline,
    modelSource: 'rasmai-repeat'
  };
}
