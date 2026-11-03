import { canonicalChartKey } from './recommendation-schema.js';

export const MIN_NEARBY_BESTS = 20;
export const MIN_TOTAL_BESTS = 50;
export const NEARBY_CONSTANT_WINDOW = 1.0;
export const DEFAULT_RUN_SIGMA = 0.5;

export const RANK_THRESHOLDS = Object.freeze([
  { name: 'S', achievement: 97 },
  { name: 'S+', achievement: 98 },
  { name: 'SS', achievement: 99 },
  { name: 'SS+', achievement: 99.5 },
  { name: 'SSS', achievement: 100 },
  { name: 'SSS+', achievement: 100.5 }
]);

const ALL_RANK_THRESHOLDS = Object.freeze([
  { name: 'D', achievement: 0 },
  { name: 'C', achievement: 50 },
  { name: 'B', achievement: 60 },
  { name: 'BB', achievement: 70 },
  { name: 'BBB', achievement: 75 },
  { name: 'A', achievement: 80 },
  { name: 'AA', achievement: 90 },
  { name: 'AAA', achievement: 94 },
  ...RANK_THRESHOLDS
]);

export const DEFAULT_MODEL_PARAMS = Object.freeze({
  minNearbyBests: MIN_NEARBY_BESTS,
  minTotalBests: MIN_TOTAL_BESTS,
  nearbyConstantWindow: NEARBY_CONSTANT_WINDOW,
  thickBucketPercentile: 0.75,
  thinBucketPercentile: 0.65,
  thinBucketSize: 4,
  minSlope: 0.02,
  maxSlope: 1.5,
  fallbackSlope: 0.25,
  droppedRunResidual: 2.5,
  bestToRunOffset: 0.35,
  bestToRunPlayCountFactor: 0.12,
  firstPassPenalty: 0.7,
  firstPassSigmaMultiplier: 1.35,
  plannedRuns: 1,
  minimumSigmaLatent: 0.01,
  pooledSigmaLatent: null
});

const LATENT_CEILING = 101.0001;

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePart(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

export function achievementPercent(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return numeric > 101.0001 ? numeric / 10000 : numeric;
}

export function toLatent(achievement) {
  const numeric = finiteNumber(achievement);
  if (numeric == null) return Number.NaN;
  return Math.log(Math.max(Number.EPSILON, LATENT_CEILING - numeric));
}

export function fromLatent(latent) {
  const numeric = finiteNumber(latent);
  if (numeric == null) return Number.NaN;
  return clamp(LATENT_CEILING - Math.exp(numeric), 0, 101);
}

export function rankForAchievement(achievement) {
  const numeric = finiteNumber(achievement) ?? 0;
  let rank = ALL_RANK_THRESHOLDS[0].name;
  for (const threshold of ALL_RANK_THRESHOLDS) {
    if (numeric < threshold.achievement) break;
    rank = threshold.name;
  }
  return rank;
}

export function oddsBand(probability) {
  const numeric = clamp(finiteNumber(probability) ?? 0, 0, 1);
  if (numeric >= 0.5) return 'likely';
  if (numeric >= 0.25) return 'possible';
  if (numeric >= 0.1) return 'stretch';
  return 'unlikely';
}

export function formatOdds(probability, calibrated = false) {
  const numeric = clamp(finiteNumber(probability) ?? 0, 0, 1);
  if (!calibrated) return oddsBand(numeric);
  if (numeric <= 0) return '0%';
  const percent = Math.round(numeric * 100);
  const attempts = Math.max(1, Math.round(1 / numeric));
  return `1 in ${attempts} (${percent}%)`;
}

function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * clamp(probability, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function weightedLine(points, params) {
  if (!points.length) return { intercept: toLatent(97), slope: params.fallbackSlope };
  const weight = points.reduce((sum, point) => sum + point.weight, 0);
  const meanX = points.reduce((sum, point) => sum + point.x * point.weight, 0) / weight;
  const meanY = points.reduce((sum, point) => sum + point.y * point.weight, 0) / weight;
  const variance = points.reduce((sum, point) => sum + point.weight * ((point.x - meanX) ** 2), 0);
  const covariance = points.reduce((sum, point) => sum + point.weight * (point.x - meanX) * (point.y - meanY), 0);
  const rawSlope = variance > 1e-12 ? covariance / variance : params.fallbackSlope;
  const slope = clamp(rawSlope, params.minSlope, params.maxSlope);
  return { intercept: meanY - slope * meanX, slope };
}

function catalogSongFor(row, catalog) {
  if (!catalog) return null;
  const storedId = row.songId || row.favoriteId;
  if (storedId && typeof catalog.getByStoredId === 'function') {
    const direct = catalog.getByStoredId(storedId);
    if (direct) return direct;
  }
  if (typeof catalog.getUniqueByNormalizedTitle === 'function') {
    const direct = catalog.getUniqueByNormalizedTitle(row.title);
    if (direct) return direct;
  }
  return typeof catalog.getByAlias === 'function' ? catalog.getByAlias(row.title) : null;
}

export function normalizeSkillModelChartRow(row, catalog = null) {
  const type = normalizePart(row?.type || row?.chartType || row?.chart_type || 'std');
  const difficulty = normalizePart(row?.difficulty);
  const song = catalogSongFor(row || {}, catalog);
  const chart = song?.difficultyLevels?.find((candidate) =>
    normalizePart(candidate.type) === type && normalizePart(candidate.difficulty) === difficulty
  ) || row?.chart || null;
  const constant = finiteNumber(chart?.internalLevelValue ?? row?.internalLevelValue ?? row?.constant);
  const achievement = achievementPercent(row?.achievement);
  if (constant == null || achievement == null) return null;
  const songId = song?.songId || row?.songId || row?.favoriteId || normalizePart(row?.title);
  const key = row?.key || canonicalChartKey(String(songId), type, difficulty);
  return {
    ...row,
    key,
    songId,
    song,
    chart,
    type,
    difficulty,
    constant,
    achievement: clamp(achievement, 0, 101),
    playCount: Math.max(0, Math.floor(finiteNumber(row?.playCount ?? row?.play_count) ?? 0))
  };
}

function normalizeBests(scores, catalog) {
  const byKey = new Map();
  for (const raw of Array.isArray(scores) ? scores : []) {
    const row = normalizeSkillModelChartRow(raw, catalog);
    if (!row) continue;
    const previous = byKey.get(row.key);
    if (!previous || row.achievement > previous.achievement) byKey.set(row.key, row);
  }
  return [...byKey.values()];
}

function bucketPoints(bests, params) {
  const groups = new Map();
  for (const best of bests) {
    const constant = Math.round(best.constant * 2) / 2;
    const values = groups.get(constant) || [];
    values.push(best.achievement);
    groups.set(constant, values);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([constant, values]) => {
    const probability = values.length < params.thinBucketSize
      ? params.thinBucketPercentile
      : params.thickBucketPercentile;
    const representative = percentile(values, probability);
    return { x: constant, y: toLatent(representative), weight: values.length, constant, representative, count: values.length };
  });
}

function predictCurve(curve, constant, difficulty = '') {
  const offset = curve.difficultyOffsets[normalizePart(difficulty)] || 0;
  return fromLatent(curve.intercept + curve.slope * constant + offset);
}

function predictCurveLatent(curve, constant, difficulty = '') {
  const offset = curve.difficultyOffsets[normalizePart(difficulty)] || 0;
  return curve.intercept + curve.slope * constant + offset;
}

function fitDifficultyOffsets(bests, line) {
  const buckets = new Map();
  for (const best of bests) {
    if (best.difficulty !== 'expert' && best.difficulty !== 'master') continue;
    const key = Math.round(best.constant * 2) / 2;
    const group = buckets.get(key) || { expert: [], master: [] };
    group[best.difficulty].push(toLatent(best.achievement) - (line.intercept + line.slope * best.constant));
    buckets.set(key, group);
  }
  const differences = [];
  for (const group of buckets.values()) {
    if (!group.expert.length || !group.master.length) continue;
    const expert = group.expert.reduce((sum, value) => sum + value, 0) / group.expert.length;
    const master = group.master.reduce((sum, value) => sum + value, 0) / group.master.length;
    differences.push(expert - master);
  }
  const expert = differences.length
    ? differences.reduce((sum, value) => sum + value, 0) / differences.length
    : 0;
  return { expert, master: 0 };
}

function fitCurve(bests, params) {
  let points = bucketPoints(bests, params);
  let line = weightedLine(points, params);
  let curve = { ...line, difficultyOffsets: fitDifficultyOffsets(bests, line) };
  const droppedKeys = new Set(bests.filter((best) =>
    best.playCount <= 2 && predictCurve(curve, best.constant, best.difficulty) - best.achievement >= params.droppedRunResidual
  ).map((best) => best.key));
  if (droppedKeys.size && droppedKeys.size < bests.length) {
    const retained = bests.filter((best) => !droppedKeys.has(best.key));
    points = bucketPoints(retained, params);
    line = weightedLine(points, params);
    curve = { ...line, difficultyOffsets: fitDifficultyOffsets(retained, line) };
  }
  return { ...curve, buckets: points, droppedKeys: [...droppedKeys] };
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function detrendedResiduals(plays) {
  if (plays.length < 2) return [];
  const xs = plays.map((_, index) => index);
  const ys = plays.map((play) => toLatent(play.achievement));
  const meanX = (xs.length - 1) / 2;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const variance = xs.reduce((sum, value) => sum + ((value - meanX) ** 2), 0);
  const slope = variance > 0
    ? xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0) / variance
    : 0;
  return ys.map((value, index) => value - (meanY + slope * (index - meanX)));
}

export function estimateRunSigma(history, catalog, options = {}) {
  const normalized = (Array.isArray(history) ? history : []).map((raw) => {
    const row = normalizeSkillModelChartRow(raw, catalog);
    const playedAt = raw?.playedAtIso || raw?.playedAt || raw?.played_at_iso;
    const timestamp = Date.parse(String(playedAt || ''));
    return row && Number.isFinite(timestamp) ? { ...row, timestamp, day: new Date(timestamp).toISOString().slice(0, 10) } : null;
  }).filter(Boolean).sort((left, right) => left.timestamp - right.timestamp);

  const firstSeen = new Set();
  const groups = new Map();
  for (const play of normalized) {
    const isFirst = !firstSeen.has(play.key);
    firstSeen.add(play.key);
    if (isFirst) continue;
    const groupKey = `${play.key}\u0000${play.day}`;
    const group = groups.get(groupKey) || [];
    group.push(play);
    groups.set(groupKey, group);
  }

  const differences = [];
  for (const plays of groups.values()) {
    if (plays.length < 2) continue;
    const residuals = detrendedResiduals(plays);
    for (let index = 1; index < residuals.length; index += 1) {
      differences.push(residuals[index] - residuals[index - 1]);
    }
  }
  const pairDifferenceSigma = standardDeviation(differences);
  const sigmaLatent = pairDifferenceSigma == null ? null : pairDifferenceSigma / Math.sqrt(2);
  return {
    sigmaLatent,
    pairCount: differences.length,
    eligible: differences.length >= (finiteNumber(options.minimumPairs) ?? 30)
  };
}

function defaultSigmaLatent(referenceAchievement = 99) {
  const high = toLatent(clamp(referenceAchievement + DEFAULT_RUN_SIGMA / 2, 0, 101));
  const low = toLatent(clamp(referenceAchievement - DEFAULT_RUN_SIGMA / 2, 0, 101));
  return Math.abs(high - low);
}

export function buildSkillProfile(scores, history = [], catalog = null, suppliedParams = {}) {
  const params = { ...DEFAULT_MODEL_PARAMS, ...(suppliedParams || {}) };
  const bests = normalizeBests(scores, catalog);
  const curve = fitCurve(bests, params);
  const hardestSConstant = bests
    .filter((best) => best.achievement >= 97)
    .reduce((maximum, best) => Math.max(maximum, best.constant), Number.NEGATIVE_INFINITY);
  const sigma = estimateRunSigma(history, catalog, { minimumPairs: 30 });
  const referenceAchievement = bests.length
    ? bests.reduce((sum, best) => sum + best.achievement, 0) / bests.length
    : 99;
  const pooled = finiteNumber(params.pooledSigmaLatent);
  const sigmaSource = sigma.eligible ? 'player' : pooled != null ? 'pooled' : 'default';
  const sigmaLatent = Math.max(
    params.minimumSigmaLatent,
    sigma.eligible ? sigma.sigmaLatent : pooled ?? defaultSigmaLatent(referenceAchievement)
  );
  return {
    params,
    bests,
    total: bests.length,
    curve,
    hardestSConstant: Number.isFinite(hardestSConstant) ? hardestSConstant : null,
    sigmaLatent,
    sigmaPairCount: sigma.pairCount,
    sigmaSource
  };
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

export function targetOdds(centerLatent, sigmaLatent, target) {
  if (target > 101) return 0;
  if (target <= 0) return 1;
  return clamp(normalCdf((toLatent(target) - centerLatent) / sigmaLatent), 0, 1);
}

function sigmaInAchievementPoints(centerLatent, sigmaLatent) {
  const lower = fromLatent(centerLatent + sigmaLatent);
  const upper = fromLatent(centerLatent - sigmaLatent);
  return Math.max(0, (upper - lower) / 2);
}

export function predictChart(profile, rawChart, rawBest = null) {
  const params = { ...DEFAULT_MODEL_PARAMS, ...(profile?.params || {}) };
  const chart = normalizeSkillModelChartRow({ ...rawChart, achievement: 0 }, null);
  if (!profile || !chart) throw new Error('A skill profile and a chart with an internal constant are required.');
  const nearby = profile.bests.filter((best) => Math.abs(best.constant - chart.constant) <= params.nearbyConstantWindow).length;
  if (profile.total < params.minTotalBests || nearby < params.minNearbyBests) {
    return { insufficient: true, nearby, total: profile.total };
  }

  const best = rawBest ? normalizeSkillModelChartRow({ ...rawBest, constant: chart.constant }, null) : null;
  const dropped = best && best.playCount <= 2 && profile.curve.droppedKeys.includes(best.key);
  const firstPass = !best || dropped;
  let bestLatent = predictCurveLatent(profile.curve, chart.constant, chart.difficulty);
  if (profile.hardestSConstant == null || chart.constant > profile.hardestSConstant) {
    bestLatent = Math.max(bestLatent, toLatent(97));
  }
  const bestExpected = fromLatent(bestLatent);
  const playCount = firstPass ? 0 : best.playCount;
  const offset = params.bestToRunOffset + params.bestToRunPlayCountFactor * Math.log1p(playCount);
  const penalty = firstPass ? params.firstPassPenalty : offset;
  const expected = clamp(bestExpected - penalty, 0, 101);
  const centerLatent = toLatent(expected);
  const sigmaLatent = profile.sigmaLatent * (firstPass ? params.firstPassSigmaMultiplier : 1);
  const oddsByRank = Object.fromEntries(RANK_THRESHOLDS.map((threshold) => [
    threshold.name,
    targetOdds(centerLatent, sigmaLatent, threshold.achievement)
  ]));
  const currentBest = best?.achievement ?? null;
  const newBestSingleRunOdds = currentBest == null
    ? 1
    : currentBest >= 101
      ? 0
      : targetOdds(centerLatent, sigmaLatent, Math.min(101, currentBest + 0.0001));
  const plannedRuns = Math.max(1, Math.floor(finiteNumber(params.plannedRuns) ?? 1));
  return {
    insufficient: false,
    nearby,
    total: profile.total,
    expected,
    bestExpected,
    sigma: sigmaInAchievementPoints(centerLatent, sigmaLatent),
    sigmaLatent,
    rank: rankForAchievement(expected),
    oddsByRank,
    newBestOdds: 1 - ((1 - newBestSingleRunOdds) ** plannedRuns),
    newBestSingleRunOdds,
    plannedRuns,
    firstPass,
    capped: profile.hardestSConstant == null || chart.constant > profile.hardestSConstant
  };
}
