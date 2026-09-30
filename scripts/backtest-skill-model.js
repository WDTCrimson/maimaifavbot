#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { fromLatent, rankForAchievement, toLatent } from '../src/skill-model.js';
import { SongCatalog } from '../src/song-catalog.js';

const DEFAULT_REPORT = './data/reports/skill-model-backtest.md';
const PERCENTILE_GRID = [
  { thickPercentile: 0.40, thinPercentile: 0.40 },
  { thickPercentile: 0.50, thinPercentile: 0.50 },
  { thickPercentile: 0.60, thinPercentile: 0.55 },
  { thickPercentile: 0.65, thinPercentile: 0.60 },
  { thickPercentile: 0.70, thinPercentile: 0.60 },
  { thickPercentile: 0.75, thinPercentile: 0.65 },
  { thickPercentile: 0.80, thinPercentile: 0.70 }
];
const PARAMETER_GRID = PERCENTILE_GRID.flatMap((percentiles) =>
  [0, 2, 3, 4, 5].flatMap((playCountPenalty) =>
    [0.25, 0.5, 0.75, 1].map((curveWeight) => ({ ...percentiles, playCountPenalty, curveWeight }))
  )
);

function usage() {
  return `Usage: npm run backtest -- [options]

Options:
  --fixture        Run the deterministic synthetic fixture (works on a fresh clone)
  --db <path>      Read account bests from a SQLite database
  --catalog <path> Resolve legacy score rows with this song catalog
                   (default: ./data/import/songs.normalized.json)
  --json           Print machine-readable JSON instead of writing Markdown
  --output <path>  Markdown report path (default: ${DEFAULT_REPORT})
  --help           Show this help

This command never claims odds calibration from best-score leave-one-out data.
History replay remains uncalibrated until at least 500 replayable plays exist.`;
}

function parseArgs(argv) {
  const options = {
    fixture: false,
    db: null,
    catalog: './data/import/songs.normalized.json',
    json: false,
    output: DEFAULT_REPORT,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--fixture') options.fixture = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--db' || argument === '--catalog' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.help && options.fixture === Boolean(options.db)) {
    throw new Error('Choose exactly one input: --fixture or --db <path>.');
  }
  return options;
}

function hashFraction(value) {
  const bytes = createHash('sha256').update(String(value)).digest();
  return bytes.readUInt32BE(0) / 0x100000000;
}

function fixturePlayers() {
  return ['steady', 'improving', 'expert-only'].map((playerId, playerIndex) => {
    const scores = Array.from({ length: 160 }, (_, index) => {
      const constant = 8 + (index % 75) / 10;
      const difficulty = playerId === 'expert-only' ? 'expert' : 'master';
      const baseLatent = -0.45 + constant * (0.31 + playerIndex * 0.008);
      const noise = ((((index * 37 + playerIndex * 17) % 23) - 11) / 11) * 0.025;
      return {
        key: `${playerId}-${index}::dx::${difficulty}`,
        title: `${playerId} ${index}`,
        type: 'dx',
        difficulty,
        constant,
        internalLevelValue: constant,
        achievement: Math.round(fromLatent(baseLatent + noise) * 10000),
        playCount: 4 + (index % 12)
      };
    });
    return { id: playerId, scores };
  });
}

function normalizeChartPart(value) {
  return String(value || '').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

async function loadDatabasePlayers(path, catalogPath) {
  const catalog = new SongCatalog(resolve(catalogPath));
  await catalog.load();
  if (!catalog.available) throw new Error(`Song catalog is unavailable: ${catalog.error?.message || catalogPath}`);
  const database = new Database(resolve(path), { readonly: true, fileMustExist: true });
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_score_charts'").get();
    if (!table) throw new Error('The database has no account_score_charts table.');
    const rows = database.prepare(
      `SELECT user_id, profile_name, title, difficulty, chart_type, achievement,
              play_count, internal_level_value, song_id, favorite_id
       FROM account_score_charts
       WHERE achievement IS NOT NULL
       ORDER BY user_id, profile_name, title, difficulty, chart_type`
    ).all();
    const players = new Map();
    for (const row of rows) {
      const type = normalizeChartPart(row.chart_type);
      const difficulty = normalizeChartPart(row.difficulty);
      const song = catalog.getUniqueByNormalizedTitle(row.title) || catalog.getByAlias(row.title);
      const chart = song?.difficultyLevels?.find((candidate) =>
        normalizeChartPart(candidate.type) === type
        && normalizeChartPart(candidate.difficulty) === difficulty
      );
      const constant = Number(row.internal_level_value ?? chart?.internalLevelValue);
      if (!Number.isFinite(constant)) continue;
      const id = `${row.user_id}/${row.profile_name}`;
      const player = players.get(id) || { id: `Player ${players.size + 1}`, scores: [] };
      player.scores.push({
        key: `${row.song_id || song?.songId || row.favorite_id || row.title}::${type}::${difficulty}`,
        title: row.title,
        songId: row.song_id || song?.songId,
        favoriteId: row.favorite_id,
        type,
        difficulty,
        constant,
        internalLevelValue: constant,
        achievement: row.achievement,
        playCount: row.play_count
      });
      players.set(id, player);
    }
    return [...players.values()];
  } finally {
    database.close();
  }
}

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(sorted) {
  return percentile(sorted, 0.5);
}

function bucketKey(constant) {
  return Math.round(constant * 2) / 2;
}

function preparePartition(scores) {
  const normalized = scores.map((score, index) => ({
    ...score,
    index,
    constant: Number(score.constant ?? score.internalLevelValue),
    achievement: Number(score.achievement) > 101.0001 ? Number(score.achievement) / 10000 : Number(score.achievement)
  })).filter((score) => Number.isFinite(score.constant) && Number.isFinite(score.achievement));
  const buckets = new Map();
  for (const score of normalized) {
    const key = bucketKey(score.constant);
    const bucket = buckets.get(key) || [];
    bucket.push(score);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) bucket.sort((left, right) => left.achievement - right.achievement);
  return { scores: normalized, buckets };
}

function representativePoints(partition, excluded, params) {
  const points = [];
  for (const [constant, bucket] of partition.buckets) {
    const values = bucket.filter((score) => score !== excluded).map((score) => score.achievement);
    if (!values.length) continue;
    const probability = values.length < 4 ? params.thinPercentile : params.thickPercentile;
    points.push({ constant, latent: toLatent(percentile(values, probability)), weight: values.length });
  }
  return points;
}

function fitLine(points) {
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (!totalWeight) return null;
  const meanX = points.reduce((sum, point) => sum + point.constant * point.weight, 0) / totalWeight;
  const meanY = points.reduce((sum, point) => sum + point.latent * point.weight, 0) / totalWeight;
  const variance = points.reduce((sum, point) => sum + point.weight * ((point.constant - meanX) ** 2), 0);
  const covariance = points.reduce((sum, point) => sum + point.weight * (point.constant - meanX) * (point.latent - meanY), 0);
  const slope = Math.min(1.5, Math.max(0.02, variance > 1e-12 ? covariance / variance : 0.25));
  return { slope, intercept: meanY - slope * meanX };
}

function difficultyOffsets(scores, line) {
  const buckets = new Map();
  for (const score of scores) {
    if (score.difficulty !== 'expert' && score.difficulty !== 'master') continue;
    const key = bucketKey(score.constant);
    const group = buckets.get(key) || { expert: [], master: [] };
    group[score.difficulty].push(toLatent(score.achievement) - (line.intercept + line.slope * score.constant));
    buckets.set(key, group);
  }
  const differences = [];
  for (const group of buckets.values()) {
    if (!group.expert.length || !group.master.length) continue;
    const expert = group.expert.reduce((sum, value) => sum + value, 0) / group.expert.length;
    const master = group.master.reduce((sum, value) => sum + value, 0) / group.master.length;
    differences.push(expert - master);
  }
  return {
    expert: differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : 0,
    master: 0
  };
}

function fitPartitionModel(partition, excluded, params) {
  const scores = partition.scores.filter((score) => score !== excluded);
  let line = fitLine(representativePoints(partition, excluded, params));
  if (!line) return null;
  let offsets = difficultyOffsets(scores, line);
  const retained = scores.filter((score) => {
    if ((Number(score.playCount) || 0) > 2) return true;
    const latent = line.intercept + line.slope * score.constant + (offsets[score.difficulty] || 0);
    return fromLatent(latent) - score.achievement < 2.5;
  });
  if (retained.length && retained.length < scores.length) {
    const retainedPartition = preparePartition(retained);
    line = fitLine(representativePoints(retainedPartition, null, params));
    offsets = difficultyOffsets(retained, line);
  }
  return { ...line, offsets };
}

function predictBest(model, score, params) {
  const curveBest = fromLatent(
    model.intercept + model.slope * score.constant + (model.offsets[score.difficulty] || 0)
  );
  const effectivePlayCount = Math.max(1, Number(score.playCount) || 0);
  return Math.max(0, curveBest - params.playCountPenalty / effectivePlayCount);
}

function nearestBaseline(partition, excluded) {
  const candidates = [];
  for (const [constant, bucket] of partition.buckets) {
    const values = bucket.filter((score) => score !== excluded).map((score) => score.achievement);
    if (values.length) candidates.push({ distance: Math.abs(constant - excluded.constant), value: median(values) });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.value ?? null;
}

function evaluatePartition(scores, params) {
  const partition = preparePartition(scores);
  const samples = [];
  for (const score of partition.scores) {
    const model = fitPartitionModel(partition, score, params);
    const baseline = nearestBaseline(partition, score);
    const curvePrediction = model ? predictBest(model, score, params) : null;
    if (curvePrediction == null || baseline == null) continue;
    const predicted = params.curveWeight * curvePrediction + (1 - params.curveWeight) * baseline;
    samples.push({
      actual: score.achievement,
      predicted,
      baseline,
      playCount: Number(score.playCount) || 0,
      signedError: predicted - score.achievement,
      modelError: Math.abs(predicted - score.achievement),
      baselineError: Math.abs(baseline - score.achievement),
      modelRankHit: rankForAchievement(predicted) === rankForAchievement(score.achievement),
      baselineRankHit: rankForAchievement(baseline) === rankForAchievement(score.achievement)
    });
  }
  return summarize(samples);
}

function evaluateHeldOut(trainingScores, targetScores, params) {
  const training = preparePartition(trainingScores);
  const targets = preparePartition(targetScores).scores;
  const model = fitPartitionModel(training, null, params);
  if (!model) return summarize([]);
  const samples = [];
  for (const score of targets) {
    const baseline = nearestBaseline(training, score);
    if (baseline == null) continue;
    const curvePrediction = predictBest(model, score, params);
    const predicted = params.curveWeight * curvePrediction + (1 - params.curveWeight) * baseline;
    samples.push({
      actual: score.achievement,
      predicted,
      baseline,
      playCount: Number(score.playCount) || 0,
      signedError: predicted - score.achievement,
      modelError: Math.abs(predicted - score.achievement),
      baselineError: Math.abs(baseline - score.achievement),
      modelRankHit: rankForAchievement(predicted) === rankForAchievement(score.achievement),
      baselineRankHit: rankForAchievement(baseline) === rankForAchievement(score.achievement)
    });
  }
  return summarize(samples);
}

function summarize(samples) {
  const count = samples.length;
  if (!count) return {
    count: 0,
    mae: null,
    bias: null,
    baselineMae: null,
    rankHitRate: null,
    baselineRankHitRate: null,
    playCountBands: []
  };
  const bandDefinitions = [
    { label: '0–2', includes: (value) => value <= 2 },
    { label: '3–9', includes: (value) => value >= 3 && value <= 9 },
    { label: '10+', includes: (value) => value >= 10 }
  ];
  return {
    count,
    mae: samples.reduce((sum, sample) => sum + sample.modelError, 0) / count,
    bias: samples.reduce((sum, sample) => sum + sample.signedError, 0) / count,
    baselineMae: samples.reduce((sum, sample) => sum + sample.baselineError, 0) / count,
    rankHitRate: samples.filter((sample) => sample.modelRankHit).length / count,
    baselineRankHitRate: samples.filter((sample) => sample.baselineRankHit).length / count,
    playCountBands: bandDefinitions.map((band) => {
      const selected = samples.filter((sample) => band.includes(sample.playCount));
      return {
        label: band.label,
        count: selected.length,
        mae: selected.length ? selected.reduce((sum, sample) => sum + sample.modelError, 0) / selected.length : null,
        bias: selected.length ? selected.reduce((sum, sample) => sum + sample.signedError, 0) / selected.length : null,
        rankHitRate: selected.length ? selected.filter((sample) => sample.modelRankHit).length / selected.length : null
      };
    })
  };
}

function aggregate(rows) {
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  if (!count) return summarize([]);
  const weighted = (field) => rows.reduce((sum, row) => sum + row[field] * row.count, 0) / count;
  return {
    count,
    mae: weighted('mae'),
    bias: weighted('bias'),
    baselineMae: weighted('baselineMae'),
    rankHitRate: weighted('rankHitRate'),
    baselineRankHitRate: weighted('baselineRankHitRate')
  };
}

function splitPlayer(player) {
  const tuning = [];
  const heldOut = [];
  for (const score of player.scores) {
    (hashFraction(`${player.id}\u0000${score.key}`) < 0.8 ? tuning : heldOut).push(score);
  }
  return { ...player, tuning, heldOut };
}

function runBacktest(players, source) {
  const split = players.map(splitPlayer).filter((player) => player.tuning.length >= 2 && player.heldOut.length >= 2);
  if (!split.length) throw new Error('No player has enough resolved charts for an 80/20 split.');
  const candidates = PARAMETER_GRID.map((params) => {
    const rows = split.map((player) => evaluatePartition(player.tuning, params));
    return { params, metrics: aggregate(rows) };
  });
  const beatsBaseline = (candidate) =>
    candidate.metrics.mae < candidate.metrics.baselineMae
    && candidate.metrics.rankHitRate > candidate.metrics.baselineRankHitRate;
  candidates.sort((left, right) =>
    Number(beatsBaseline(right)) - Number(beatsBaseline(left))
    || left.metrics.mae - right.metrics.mae
    || right.metrics.rankHitRate - left.metrics.rankHitRate
  );
  const selected = candidates[0].params;
  const perPlayer = split.map((player) => ({
    player: player.id,
    totalBests: player.scores.length,
    tuning: evaluatePartition(player.tuning, selected),
    heldOut: evaluateHeldOut(player.tuning, player.heldOut, selected)
  }));
  const tuning = aggregate(perPlayer.map((row) => row.tuning));
  const heldOut = aggregate(perPlayer.map((row) => row.heldOut));
  const eligiblePlayers = perPlayer.filter((row) => row.totalBests >= 100);
  const pass = heldOut.mae < heldOut.baselineMae
    && heldOut.rankHitRate > heldOut.baselineRankHitRate
    && eligiblePlayers.every((row) =>
      row.heldOut.mae < row.heldOut.baselineMae
      && row.heldOut.rankHitRate > row.heldOut.baselineRankHitRate
    );
  return {
    generatedAt: new Date().toISOString(),
    source,
    selected,
    split: 'deterministic chart-level 80/20 per player',
    evaluationStatus: source === 'deterministic synthetic fixture'
      ? 'Synthetic pipeline validation only.'
      : 'Development holdout: parameters must receive a final evaluation on newly accumulated data.',
    tuning,
    heldOut,
    perPlayer,
    pass,
    calibration: {
      replayablePlays: 0,
      numericOddsEnabled: false,
      statement: 'No calibration claim: best-score leave-one-out does not measure single-run odds.'
    }
  };
}

function percent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function number(value) {
  return value == null ? 'n/a' : value.toFixed(4);
}

function markdown(result) {
  const rows = result.perPlayer.map((row) =>
    `| ${row.player.replaceAll('|', '\\|')} | ${row.totalBests} | ${row.heldOut.count} | ${number(row.heldOut.mae)} | ${number(row.heldOut.baselineMae)} | ${percent(row.heldOut.rankHitRate)} | ${percent(row.heldOut.baselineRankHitRate)} |`
  ).join('\n');
  const playCountRows = result.perPlayer.flatMap((row) => row.heldOut.playCountBands.map((band) =>
    `| ${row.player.replaceAll('|', '\\|')} | ${band.label} | ${band.count} | ${number(band.mae)} | ${number(band.bias)} | ${percent(band.rankHitRate)} |`
  )).join('\n');
  return `# Skill model backtest

Generated: ${result.generatedAt}

Source: ${result.source}

Split: ${result.split}

Status: ${result.evaluationStatus}

Parameters: thick p${Math.round(result.selected.thickPercentile * 100)}, thin p${Math.round(result.selected.thinPercentile * 100)}, play-count penalty ${result.selected.playCountPenalty.toFixed(1)} ÷ plays, curve weight ${Math.round(result.selected.curveWeight * 100)}%

## Result

**${result.pass ? 'PASS' : 'FAIL'}** against the Phase 2 fixture/data acceptance rule.

| Set | n | Model MAE | Baseline MAE | Model rank hit | Baseline rank hit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tuning 80% | ${result.tuning.count} | ${number(result.tuning.mae)} | ${number(result.tuning.baselineMae)} | ${percent(result.tuning.rankHitRate)} | ${percent(result.tuning.baselineRankHitRate)} |
| Held-out 20% | ${result.heldOut.count} | ${number(result.heldOut.mae)} | ${number(result.heldOut.baselineMae)} | ${percent(result.heldOut.rankHitRate)} | ${percent(result.heldOut.baselineRankHitRate)} |

## Held-out by player

| Player | Total bests | Held-out n | Model MAE | Baseline MAE | Model rank hit | Baseline rank hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Held-out by play count

Positive bias means the model predicted a higher achievement than the recorded best.

| Player | Plays | n | Model MAE | Bias | Rank hit |
| --- | --- | ---: | ---: | ---: | ---: |
${playCountRows}

## Calibration status

${result.calibration.statement} Numeric odds remain disabled; surfaces must use likely/possible/stretch/unlikely bands. History replay needs at least 500 replayable plays, and each reliability bucket needs at least 50 observations before numeric odds may be enabled.

## Method notes

- Tuning leave-one-out removes each score from its half-constant bucket incrementally rather than rebuilding account data.
- Held-out charts are predicted only from the player's 80% training charts. The baseline is the nearest training half-constant bucket median.
- Exact-rank hit uses the same achievement rank boundaries as the model.
- This report does not use future scores or treat best scores as individual attempts.
`;
}

export { evaluatePartition, fixturePlayers, runBacktest };

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const players = options.fixture ? fixturePlayers() : await loadDatabasePlayers(options.db, options.catalog);
    const result = runBacktest(players, options.fixture ? 'deterministic synthetic fixture' : resolve(options.db));
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const output = resolve(options.output);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, markdown(result));
      console.log(`${result.pass ? 'PASS' : 'FAIL'}: wrote ${output}`);
    }
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    console.error('Run with --help for usage.');
    process.exitCode = 1;
  }
}
