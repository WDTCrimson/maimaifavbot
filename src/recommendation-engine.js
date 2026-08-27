import { calculateChartRating, getCurrentIntlVersionId } from './maimai-intl.js';
import { canonicalChartKey } from './recommendation-schema.js';

const RANK_THRESHOLDS = [
  { name: 'S', value: 970000 },
  { name: 'S+', value: 980000 },
  { name: 'SS', value: 990000 },
  { name: 'SS+', value: 995000 },
  { name: 'SSS', value: 1000000 },
  { name: 'SSS+', value: 1005000 }
];

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeChartPart(value) {
  return String(value || '').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findExactScoreSong(score, songCatalog) {
  const storedId = score.songId || score.favoriteId;
  if (storedId) {
    const direct = songCatalog.getByStoredId(storedId);
    if (direct) return direct;
  }
  const byTitle = songCatalog.getUniqueByNormalizedTitle(score.title);
  if (byTitle) return byTitle;
  return songCatalog.getByAlias(score.title);
}

export function resolvePlayerScores(scores, songCatalog) {
  const gameVersion = getCurrentIntlVersionId() ?? 0;
  const byKey = new Map();

  for (const score of Array.isArray(scores) ? scores : []) {
    const song = findExactScoreSong(score, songCatalog);
    const type = normalizeChartPart(score.type || score.chartType || 'std');
    const difficulty = normalizeChartPart(score.difficulty);
    if (!song || !type || !difficulty) continue;
    const chart = (song.difficultyLevels || []).find((item) =>
      normalizeChartPart(item.type) === type && normalizeChartPart(item.difficulty) === difficulty
    );
    const constant = finiteNumber(chart?.internalLevelValue ?? score.internalLevelValue);
    const achievement = finiteNumber(score.achievement);
    if (!chart || constant == null || achievement == null) continue;
    const rating = finiteNumber(score.rating) ?? calculateChartRating({
      achievement,
      fc: score.fc,
      internalLevelValue: constant,
      gameVersion
    });
    const key = canonicalChartKey(song.songId, type, difficulty);
    const resolved = { ...score, key, songId: song.songId, song, chart, type, difficulty, constant, achievement, rating };
    const existing = byKey.get(key);
    if (!existing || achievement > existing.achievement || (achievement === existing.achievement && rating > existing.rating)) {
      byKey.set(key, resolved);
    }
  }
  return [...byKey.values()];
}

function catalogConstantBounds(songCatalog) {
  const constants = songCatalog.songs.flatMap((song) =>
    (song.difficultyLevels || []).map((chart) => finiteNumber(chart.internalLevelValue)).filter((value) => value != null)
  );
  return {
    min: constants.length ? Math.min(...constants) : 1,
    max: constants.length ? Math.max(...constants) : 15
  };
}

export function inferSuggestionRange(scores, songCatalog) {
  const resolved = resolvePlayerScores(scores, songCatalog);
  if (resolved.length < 10) {
    throw new Error('At least 10 distinct resolved chart scores are required to infer a range. Provide `range` explicitly or sync more scores.');
  }
  resolved.sort((a, b) => b.rating - a.rating || a.key.localeCompare(b.key));
  const selected = resolved.length < 15 ? resolved : resolved.slice(0, 15);
  const constants = selected.map((item) => item.constant).sort((a, b) => a - b);
  const middle = Math.floor(constants.length / 2);
  const median = constants.length % 2 ? constants[middle] : (constants[middle - 1] + constants[middle]) / 2;
  const bounds = catalogConstantBounds(songCatalog);
  return {
    minConstant: Math.max(bounds.min, Math.round((median - 0.3) * 10) / 10),
    maxConstant: Math.min(bounds.max, Math.round((median + 0.3) * 10) / 10),
    inferred: true,
    sampleSize: selected.length,
    median: Math.round(median * 10) / 10
  };
}

function minMaxNormalize(items, getValue) {
  if (!items.length) return new Map();
  const values = items.map(getValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return new Map(items.map((item, index) => [item, min === max ? 0.5 : (values[index] - min) / (max - min)]));
}

function stableSort(items) {
  return items.sort((a, b) =>
    b.score - a.score ||
    a.songId.localeCompare(b.songId) ||
    a.type.localeCompare(b.type) ||
    a.difficulty.localeCompare(b.difficulty)
  );
}

function inRange(constant, range) {
  return constant >= range.minConstant && constant <= range.maxConstant;
}

function activeEvidence(entry) {
  return entry && entry.evidence.some((item) => item.status === 'active');
}

function evidenceFor(catalog, key, focus) {
  const entry = catalog?.getByChartKey(key) || null;
  if (!activeEvidence(entry)) return focus ? null : { entry: null, weight: 0.5 };
  if (focus && !entry.tags.includes(normalizeText(focus))) return null;
  return { entry, weight: entry.evidenceWeight };
}

function buildImprovementCandidates({ resolvedScores, catalog, range, focus }) {
  const gameVersion = getCurrentIntlVersionId() ?? 0;
  const filtered = [];
  for (const score of resolvedScores) {
    const threshold = RANK_THRESHOLDS.find((item) => item.value > score.achievement);
    if (!threshold) continue;
    const gap = threshold.value - score.achievement;
    if (gap > 5000) continue;
    if (!inRange(score.constant, range)) continue;
    const evidence = evidenceFor(catalog, score.key, focus);
    if (!evidence) continue;
    const thresholdRating = calculateChartRating({
      achievement: threshold.value,
      fc: score.fc,
      internalLevelValue: score.constant,
      gameVersion
    });
    const delta = thresholdRating - score.rating;
    if (delta <= 0) continue;
    filtered.push({ score, threshold, gap, delta, evidence });
  }
  const normalizedDelta = minMaxNormalize(filtered, (item) => item.delta);
  return stableSort(filtered.map((item) => {
    const composite = 0.55 * item.evidence.weight + 0.30 * normalizedDelta.get(item) + 0.15 * (1 - Math.min(item.gap / 5000, 1));
    return {
      lane: 'improvement',
      key: item.score.key,
      songId: item.score.songId,
      song: item.score.song,
      chart: item.score.chart,
      type: item.score.type,
      difficulty: item.score.difficulty,
      constant: item.score.constant,
      score: Math.round(composite * 1e6) / 1e6,
      evidence: item.evidence.entry,
      gap: item.gap,
      delta: item.delta,
      nextThreshold: item.threshold.name,
      reason: `Reach ${item.threshold.name} with ${item.gap.toLocaleString('en-US')} more achievement points (+${item.delta} rating).`
    };
  }));
}

function buildDiscoveryCandidates({ resolvedScores, catalog, range, focus }) {
  if (!catalog?.available) return [];
  const played = new Set(resolvedScores.map((item) => item.key));
  const midpoint = (range.minConstant + range.maxConstant) / 2;
  const denominator = Math.max((range.maxConstant - range.minConstant) / 2, 0.1);
  const candidates = [];
  for (const entry of catalog.entries) {
    if (!activeEvidence(entry) || played.has(entry.key) || !inRange(entry.constant, range)) continue;
    if (focus && !entry.tags.includes(normalizeText(focus))) continue;
    const levelFit = 1 - Math.min(Math.abs(entry.constant - midpoint) / denominator, 1);
    candidates.push({
      lane: 'discovery',
      key: entry.key,
      songId: entry.songId,
      song: entry.song,
      chart: entry.resolvedChart,
      type: entry.chart.type,
      difficulty: entry.chart.difficulty,
      constant: entry.constant,
      score: Math.round((0.70 * entry.evidenceWeight + 0.30 * levelFit) * 1e6) / 1e6,
      evidence: entry,
      reason: entry.summary
    });
  }
  return stableSort(candidates);
}

export function recommendCharts({ catalog, songCatalog, scores = [], range, focus = '', mode = 'balanced', limit = 5 }) {
  if (!['balanced', 'discovery', 'improvement'].includes(mode)) throw new Error('Mode must be balanced, discovery, or improvement.');
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  const resolvedScores = resolvePlayerScores(scores, songCatalog);
  const discovery = mode === 'improvement' ? [] : buildDiscoveryCandidates({ resolvedScores, catalog, range, focus });
  const improvement = mode === 'discovery' ? [] : buildImprovementCandidates({ resolvedScores, catalog, range, focus });
  if (mode === 'discovery') return discovery.slice(0, safeLimit);
  if (mode === 'improvement') return improvement.slice(0, safeLimit);

  const discoveryTarget = Math.ceil(safeLimit / 2);
  const improvementTarget = safeLimit - discoveryTarget;
  const selected = [...discovery.slice(0, discoveryTarget), ...improvement.slice(0, improvementTarget)];
  const selectedKeys = new Set(selected.map((item) => item.key));
  const remainder = [...discovery.slice(discoveryTarget), ...improvement.slice(improvementTarget)];
  for (const item of remainder) {
    if (selected.length >= safeLimit) break;
    if (selectedKeys.has(item.key)) continue;
    selected.push(item);
    selectedKeys.add(item.key);
  }
  return selected;
}

export function accountSnapshotAge(account, now = Date.now()) {
  const timestamp = Date.parse(account?.updatedAt || account?.sourceFetchedAt || '');
  if (!Number.isFinite(timestamp)) return { ageDays: Number.POSITIVE_INFINITY, stale: true, expired: true };
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return { ageDays, stale: ageDays > 30, expired: ageDays > 90 };
}

export function resolveSuggestionAccess({ linked, mode = 'balanced', hasExplicitRange, snapshotAge = null }) {
  if (!['balanced', 'discovery', 'improvement'].includes(mode)) throw new Error('Mode must be balanced, discovery, or improvement.');
  if (mode === 'improvement' && !linked) {
    return { allowed: false, reason: 'link_required', effectiveMode: mode };
  }
  if (!hasExplicitRange && !linked) {
    return { allowed: false, reason: 'range_or_link_required', effectiveMode: mode };
  }
  if (!hasExplicitRange && snapshotAge?.expired) {
    return { allowed: false, reason: 'snapshot_expired', effectiveMode: mode };
  }
  return { allowed: true, reason: null, effectiveMode: !linked && mode === 'balanced' ? 'discovery' : mode };
}
