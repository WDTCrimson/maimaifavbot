/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Adapted from Rasmai commit 52d8002b643f97ee3a73265dbef50cc5899b023a:
 * - rasmai/engine/analysis/profile/fit.py
 * - rasmai/engine/analysis/profile/model.py
 * - rasmai/engine/analysis/profile/build.py
 * - rasmai/engine/analysis/planning/predict.py
 * - rasmai/engine/insights/calibration.py
 *
 * Upstream: https://github.com/Ne-k/Rasmai
 * Copyright (C) Rasmai contributors.
 * Modified for MaiDeck's JavaScript data model on 2026-11-03.
 * This file remains licensed under GPL-3.0-only. See LICENSES/GPL-3.0.txt.
 */

import { RANK_THRESHOLDS, rankForAchievement } from './skill-model.js';

const ACHIEVEMENT_CAP = 100.5;
const DEFAULT_RUN_SPREAD = 0.5;
const RUN_SPREAD_PAIRS = 12;
const DROPPED_RUN = 5;
const DROPPED_BEST_PLAYS = 2;
const DROPPED_BEST_GAP = 2;
const DROPPED_BEST_SPREADS = 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePart(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

function pythonRound(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) > Number.EPSILON * Math.abs(value) * 4) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

function roundTo(value, places) {
  const scale = 10 ** places;
  return pythonRound(value * scale) / scale;
}

function median(values) {
  if (!values.length) return null;
  const ordered = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function quantile(values, probability) {
  const ordered = values.slice().sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, pythonRound(probability * (ordered.length - 1)))];
}

function populationStandardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
}

function errorFunction(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-(x ** 2)));
}

function normalCdf(value) {
  return 0.5 * (1 + errorFunction(value / Math.sqrt(2)));
}

function normalizeBest(raw) {
  const constant = finite(raw?.constant ?? raw?.internalLevelValue);
  const achievementRaw = finite(raw?.achievement);
  if (constant == null || achievementRaw == null || constant <= 0 || achievementRaw <= 0) return null;
  const achievement = achievementRaw > 101.0001 ? achievementRaw / 10000 : achievementRaw;
  const type = normalizePart(raw?.type || raw?.chartType || raw?.chart_type || 'std');
  const difficulty = normalizePart(raw?.difficulty);
  const key = String(raw?.key || `${raw?.songId || raw?.favoriteId || raw?.title || ''}|${type}|${difficulty}`);
  return {
    ...raw,
    key,
    type,
    difficulty,
    constant,
    achievement,
    playCount: Math.max(0, Math.trunc(finite(raw?.playCount ?? raw?.play_count) ?? 0))
  };
}

function normalizeRecordedPlay(raw) {
  const row = normalizeBest(raw);
  if (!row) return null;
  const bestBeforeRaw = finite(raw?.bestBefore ?? raw?.best_before);
  const bestBefore = bestBeforeRaw != null && bestBeforeRaw > 101.0001 ? bestBeforeRaw / 10000 : bestBeforeRaw ?? 0;
  return {
    ...row,
    bestBefore,
    playedAt: String(raw?.playedAtIso || raw?.playedAt || raw?.played_at || raw?.played_at_iso || '')
  };
}

function fitSkillCurve(points) {
  const buckets = new Map();
  for (const [constant, achievement] of points) {
    const bucket = pythonRound(constant * 2) / 2;
    const values = buckets.get(bucket) || [];
    values.push(achievement);
    buckets.set(bucket, values);
  }

  const bucketStats = new Map();
  const samples = [];
  for (const [constant, rawValues] of buckets) {
    const values = rawValues.slice().sort((left, right) => left - right);
    const probability = values.length >= 6 ? 0.75 : 0.65;
    const representative = values[Math.min(values.length - 1, pythonRound(probability * (values.length - 1)))];
    bucketStats.set(constant, { representative, count: values.length, best: values.at(-1) });
    samples.push({ constant, representative, weight: Math.min(values.length, 10) });
  }

  const dense = [...bucketStats].filter(([, value]) => value.count >= 3).map(([constant]) => constant);
  const constants = [...bucketStats.keys()];
  const denseCeiling = dense.length ? Math.max(...dense) : constants.length ? Math.max(...constants) - 0.5 : 0;
  if (points.length < 8 || samples.length < 3) {
    return { intercept: 101, slope: -0.3, consistency: 0.9, bucketStats, denseCeiling };
  }

  const weightTotal = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const meanX = samples.reduce((sum, sample) => sum + sample.constant * sample.weight, 0) / weightTotal;
  const meanY = samples.reduce((sum, sample) => sum + sample.representative * sample.weight, 0) / weightTotal;
  const covariance = samples.reduce((sum, sample) => sum + sample.weight * (sample.constant - meanX) * (sample.representative - meanY), 0);
  const variance = samples.reduce((sum, sample) => sum + sample.weight * ((sample.constant - meanX) ** 2), 0);
  const slope = clamp(variance > 1e-9 ? covariance / variance : -0.3, -2.5, -0.2);
  const intercept = meanY - slope * meanX;
  const top = Math.max(...constants);
  const residuals = [];
  for (const [constant, rawValues] of buckets) {
    if (constant < top - 4 || rawValues.length < 3) continue;
    const values = rawValues.slice().sort((left, right) => left - right);
    const representative = bucketStats.get(constant).representative;
    residuals.push(...values.slice(Math.floor(values.length / 2)).map((value) => value - representative));
  }
  const consistency = clamp(residuals.length > 4 ? populationStandardDeviation(residuals) : 0.9, 0.4, 2);
  return { intercept, slope, consistency, bucketStats, denseCeiling };
}

function localExpectation(profile, constant) {
  let numerator = 0;
  let denominator = 0;
  for (const [bucket, value] of profile.bucketStats) {
    const weight = Math.min(value.count, 10) * Math.exp(-(((bucket - constant) / 0.6) ** 2));
    numerator += weight * value.representative;
    denominator += weight;
  }
  return denominator < 1e-9 ? { expected: null, weight: 0 } : { expected: numerator / denominator, weight: denominator };
}

function ownCeiling(profile, constant) {
  const populated = [...profile.bucketStats].filter(([, value]) => value.count >= 4).map(([bucket]) => bucket);
  const below = populated.filter((bucket) => bucket <= constant);
  const above = populated.filter((bucket) => bucket >= constant);
  if (!below.length || !above.length) return null;
  const low = Math.max(...below);
  const high = Math.min(...above);
  if (low === high) return profile.bucketStats.get(low).representative;
  const start = profile.bucketStats.get(low).representative;
  const end = profile.bucketStats.get(high).representative;
  return start + (end - start) * (constant - low) / (high - low);
}

function rawExpectation(profile, constant) {
  let line = profile.curveIntercept + profile.curveSlope * constant;
  const local = localExpectation(profile, constant);
  if (local.expected != null) {
    const blend = local.weight / (local.weight + 3);
    line = blend * local.expected + (1 - blend) * line;
  }
  if (profile.denseCeiling && constant > profile.denseCeiling) line -= 0.8 * (constant - profile.denseCeiling);
  const ceiling = ownCeiling(profile, constant);
  if (ceiling != null) line = Math.min(line, ceiling + 0.3);
  return Math.min(ACHIEVEMENT_CAP, line);
}

function smoothCurve(profile) {
  if (profile.smoothed) return profile.smoothed;
  const populated = [...profile.bucketStats].filter(([, value]) => value.count > 0);
  const low = populated.length ? Math.min(...populated.map(([constant]) => constant)) : 0;
  const high = Math.max(profile.chartCeiling, profile.playedCeiling || 0, low);
  if (high <= low) return [];
  const anchor = populated.length
    ? populated.reduce((best, item) => item[1].count > best[1].count ? item : best)[0]
    : low;
  const grid = [];
  for (let tick = pythonRound(low * 10); tick <= pythonRound(high * 10); tick += 1) {
    grid.push([tick / 10, rawExpectation(profile, tick / 10)]);
  }
  let at = 0;
  for (let index = 1; index < grid.length; index += 1) {
    if (Math.abs(grid[index][0] - anchor) < Math.abs(grid[at][0] - anchor)) at = index;
  }
  for (let index = at + 1; index < grid.length; index += 1) grid[index][1] = Math.min(grid[index][1], grid[index - 1][1]);
  for (let index = at - 1; index >= 0; index -= 1) grid[index][1] = Math.max(grid[index][1], grid[index + 1][1]);
  profile.smoothed = grid;
  return grid;
}

function expectedAccuracy(profile, constant) {
  const grid = smoothCurve(profile);
  if (!grid.length) return rawExpectation(profile, constant);
  if (constant <= grid[0][0]) return grid[0][1];
  if (constant >= grid.at(-1)[0]) return Math.min(grid.at(-1)[1], rawExpectation(profile, constant));
  const step = Math.trunc((constant - grid[0][0]) * 10);
  const [lowConstant, lowExpected] = grid[clamp(step, 0, grid.length - 1)];
  const [highConstant, highExpected] = grid[clamp(step + 1, 0, grid.length - 1)];
  if (highConstant <= lowConstant) return lowExpected;
  return lowExpected + (highExpected - lowExpected) * (constant - lowConstant) / (highConstant - lowConstant);
}

function expectedFor(profile, constant, difficulty) {
  const tier = normalizePart(difficulty);
  return Math.min(ACHIEVEMENT_CAP, expectedAccuracy(profile, constant)
    + (profile.difficultyOffset[tier] || 0) + profile.calibrationShift + (profile.tierShift[tier] || 0));
}

function sigmaAt(profile, constant) {
  let sigma = Math.max(0.3, profile.consistency);
  if (profile.denseCeiling && constant > profile.denseCeiling) sigma *= 1 + 0.5 * (constant - profile.denseCeiling);
  if (profile.sampleSize < 40) sigma = Math.max(sigma, 0.8);
  return Math.min(3, sigma * profile.sigmaScale);
}

function runSigmaAt(profile, constant) {
  let sigma = Math.max(0.25, profile.runConsistency);
  if (profile.denseCeiling && constant > profile.denseCeiling) sigma = Math.max(sigma, sigmaAt(profile, constant));
  return Math.min(3, sigma * profile.sigmaScale);
}

function estimateRunSpread(recordedPlays) {
  const byChart = new Map();
  for (const play of recordedPlays) {
    if (!play.key || !(play.achievement > 0 && play.achievement <= 101)) continue;
    const runs = byChart.get(play.key) || [];
    runs.push([play.playedAt, play.achievement]);
    byChart.set(play.key, runs);
  }
  const gaps = [];
  for (const runs of byChart.values()) {
    if (runs.length < 2) continue;
    runs.sort((left, right) => left[0].localeCompare(right[0]));
    const floor = Math.max(...runs.map(([, value]) => value)) - DROPPED_RUN;
    const kept = runs.filter(([, value]) => value >= floor);
    for (let index = 1; index < kept.length; index += 1) gaps.push(Math.abs(kept[index][1] - kept[index - 1][1]));
  }
  if (gaps.length < RUN_SPREAD_PAIRS) return null;
  const measured = 1.4826 * median(gaps) / Math.sqrt(2);
  const weight = gaps.length / (gaps.length + 15);
  return clamp(DEFAULT_RUN_SPREAD + (measured - DEFAULT_RUN_SPREAD) * weight, 0.3, 1.5);
}

function chartExpectation(profile, chart, bestAccuracy) {
  const plays = Math.max(profile.playCounts.get(chart.key) ?? 0, bestAccuracy > 0 ? 1 : 0);
  const history = profile.history.get(chart.key) || [];
  const gap = Math.max(DROPPED_BEST_GAP, DROPPED_BEST_SPREADS * sigmaAt(profile, chart.constant));
  const dropped = bestAccuracy > 0 && plays <= DROPPED_BEST_PLAYS && history.length <= DROPPED_BEST_PLAYS
    && bestAccuracy < expectedFor(profile, chart.constant, chart.difficulty) - gap;
  if (dropped) {
    const sigma = Math.max(0.3, sigmaAt(profile, chart.constant));
    return { expected: Math.min(ACHIEVEMENT_CAP, expectedFor(profile, chart.constant, chart.difficulty) - 0.35 - 0.4 * sigma), sigma };
  }
  const curve = expectedFor(profile, chart.constant, chart.difficulty);
  let sigma = runSigmaAt(profile, chart.constant);
  let expected = curve;
  if (bestAccuracy > 0 && plays > 0) {
    const weight = plays / (plays + 3);
    expected = curve - weight * Math.max(0, curve - bestAccuracy);
    sigma *= Math.sqrt(1 + 1 / plays);
  }
  if (bestAccuracy > 0) {
    expected = Math.max(expected, bestAccuracy - 0.5 * sigma);
    expected = Math.min(expected, bestAccuracy);
  }
  if (history.length >= 2 && history.at(-1) > history[0]) expected += Math.min(0.4, (history.at(-1) - history[0]) * 0.25);
  return { expected: Math.min(ACHIEVEMENT_CAP, expected), sigma };
}

function calibrate(profile, recordedPlays, chartIndex) {
  const zs = [];
  const residuals = [];
  const perTier = new Map();
  const predictedNewBest = [];
  const actualNewBest = [];
  let inside = 0;
  for (const play of recordedPlays) {
    const chart = chartIndex.get(play.key);
    if (!chart || chart.constant <= 0 || play.achievement <= 0 || play.bestBefore <= 0) continue;
    const prediction = chartExpectation(profile, chart, play.bestBefore);
    const sigma = Math.max(0.3, prediction.sigma);
    const z = (play.achievement - prediction.expected) / sigma;
    if (z < -4) continue;
    const residual = play.achievement - prediction.expected;
    zs.push(z);
    residuals.push(residual);
    const tier = perTier.get(chart.difficulty) || [];
    tier.push(residual);
    perTier.set(chart.difficulty, tier);
    if (Math.abs(z) <= 1) inside += 1;
    predictedNewBest.push(normalCdf((prediction.expected - play.bestBefore) / sigma));
    actualNewBest.push(play.achievement >= play.bestBefore - 0.0001 ? 1 : 0);
  }
  const result = { plays: zs.length };
  if (zs.length < 15) return result;
  const centre = median(zs);
  const robust = 1.4826 * median(zs.map((z) => Math.abs(z - centre)));
  const scale = 1 + (clamp(robust, 0.6, 1.8) - 1) * zs.length / (zs.length + 30);
  const upperThird = quantile(residuals, 0.65);
  const shift = clamp(upperThird * zs.length / (zs.length + 30), -2, 2);
  const tierShifts = {};
  for (const [tier, values] of perTier) {
    if (values.length >= 8) tierShifts[tier] = roundTo(clamp((quantile(values, 0.65) - upperThird) * values.length / (values.length + 20), -2, 2), 2);
  }
  return {
    ...result,
    sigmaScale: roundTo(scale, 2),
    shift: roundTo(shift, 2),
    tierShifts,
    coverage: roundTo(inside / zs.length, 2),
    newBestPredicted: roundTo(predictedNewBest.reduce((sum, value) => sum + value, 0) / predictedNewBest.length, 2),
    newBestActual: roundTo(actualNewBest.reduce((sum, value) => sum + value, 0) / actualNewBest.length, 2)
  };
}

export function buildRasmaiSkillProfile(rawBests, rawRecordedPlays = [], options = {}) {
  const bests = (Array.isArray(rawBests) ? rawBests : []).map(normalizeBest).filter((row) => row && row.difficulty !== 'utage');
  const recordedPlays = (Array.isArray(rawRecordedPlays) ? rawRecordedPlays : []).map(normalizeRecordedPlay).filter(Boolean);
  const fit = fitSkillCurve(bests.map((best) => [best.constant, best.achievement]));
  const profile = {
    sampleSize: bests.length,
    curveIntercept: fit.intercept,
    curveSlope: fit.slope,
    consistency: fit.consistency,
    runConsistency: estimateRunSpread(recordedPlays) ?? DEFAULT_RUN_SPREAD,
    bucketStats: fit.bucketStats,
    denseCeiling: fit.denseCeiling,
    chartCeiling: finite(options.chartCeiling) ?? 15,
    playedCeiling: bests.length ? Math.max(...bests.map((best) => best.constant)) : 0,
    difficultyOffset: {},
    sigmaScale: 1,
    calibrationShift: 0,
    tierShift: {},
    calibration: { plays: 0 },
    playCounts: new Map(bests.map((best) => [best.key, best.playCount])),
    recentGrind: new Map(),
    history: new Map(),
    smoothed: null
  };
  if (!bests.length) return profile;

  const residuals = new Map();
  for (const best of bests) {
    const values = residuals.get(best.difficulty) || [];
    values.push(best.achievement - expectedAccuracy(profile, best.constant));
    residuals.set(best.difficulty, values);
  }
  const rawOffsets = new Map();
  for (const [tier, values] of residuals) {
    if (values.length >= 3) rawOffsets.set(tier, median(values) * values.length / (values.length + 12));
  }
  if (rawOffsets.size) {
    const weight = [...rawOffsets].reduce((sum, [tier]) => sum + residuals.get(tier).length, 0);
    const centre = [...rawOffsets].reduce((sum, [tier, value]) => sum + value * residuals.get(tier).length, 0) / weight;
    for (const [tier, value] of rawOffsets) profile.difficultyOffset[tier] = clamp(value - centre, -6, 6);
  }

  const chartIndex = new Map(bests.map((best) => [best.key, best]));
  for (const play of recordedPlays) {
    if (!chartIndex.has(play.key)) chartIndex.set(play.key, play);
  }
  for (const play of recordedPlays.slice(-50)) {
    profile.recentGrind.set(play.key, (profile.recentGrind.get(play.key) ?? 0) + 1);
    profile.playCounts.set(play.key, Math.max(profile.playCounts.get(play.key) ?? 0, profile.recentGrind.get(play.key)));
    const values = profile.history.get(play.key) || [];
    // Rasmai builds this list from maimai's integer achievement field.
    values.unshift(Math.round(play.achievement * 10000) / 10000);
    profile.history.set(play.key, values);
  }
  profile.calibration = calibrate(profile, recordedPlays, chartIndex);
  if (profile.calibration.plays >= 15) {
    profile.sigmaScale = profile.calibration.sigmaScale;
    profile.calibrationShift = profile.calibration.shift;
    profile.tierShift = { ...profile.calibration.tierShifts };
  }
  return profile;
}

export function predictRasmaiChart(profile, rawChart, rawBest = null) {
  const chart = normalizeBest({ ...rawChart, achievement: 1 });
  if (!profile || !chart || !profile.sampleSize) return null;
  const best = rawBest ? normalizeBest({ ...rawBest, constant: chart.constant }) : null;
  const played = Boolean(best && best.achievement > 0);
  let expected;
  let sigma;
  if (played) {
    ({ expected, sigma } = chartExpectation(profile, chart, best.achievement));
  } else {
    sigma = Math.max(0.3, sigmaAt(profile, chart.constant));
    expected = expectedFor(profile, chart.constant, chart.difficulty) - 0.35 - 0.4 * sigma;
    sigma *= 1.5;
  }
  expected = Math.min(ACHIEVEMENT_CAP, expected);
  sigma = Math.max(0.3, sigma);
  const currentBest = played ? best.achievement : null;
  const oddsByRank = Object.fromEntries(RANK_THRESHOLDS.map(({ name, achievement }) => [
    name,
    normalCdf((expected - achievement) / sigma)
  ]));
  const newBestSingleRunOdds = currentBest == null ? null : normalCdf((expected - currentBest) / sigma);
  return {
    insufficient: false,
    total: profile.sampleSize,
    expected,
    bestExpected: expected,
    sigma,
    sigmaLatent: null,
    rank: rankForAchievement(expected),
    oddsByRank,
    newBestOdds: newBestSingleRunOdds,
    newBestSingleRunOdds,
    plannedRuns: 1,
    firstPass: !played,
    capped: expected >= ACHIEVEMENT_CAP,
    low: Math.max(0, expected - sigma),
    high: Math.min(ACHIEVEMENT_CAP, expected + sigma),
    calibrationPlays: profile.calibration.plays,
    modelSource: 'rasmai-gpl'
  };
}
