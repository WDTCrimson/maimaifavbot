#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { buildHybridSkillProfile, predictHybridChart } from '../src/hybrid-skill-model.js';
import { buildSkillProfile, predictChart, rankForAchievement } from '../src/skill-model.js';
import { SongCatalog, normalizeSongText } from '../src/song-catalog.js';

const DEFAULT_OUTPUT = './data/reports/hybrid-shadow-backtest.md';

function parseArgs(argv) {
  const options = { db: null, catalog: './data/import/songs.normalized.json', output: DEFAULT_OUTPUT, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--db', '--catalog', '--output'].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.help && !options.db) throw new Error('--db <path> is required.');
  return options;
}

function usage() {
  return `Usage: npm run backtest:hybrid -- --db <path> [options]

  --catalog <path>  Catalog used to resolve chart constants
  --output <path>   Aggregate Markdown output (default: ${DEFAULT_OUTPUT})
  --json            Print aggregate JSON
  --help            Show this help

No profile names, Discord IDs, raw plays, or prediction rows are written.`;
}

function norm(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number > 101.0001 ? number / 10000 : number) : null;
}

function chartResolver(catalog) {
  return (raw) => {
    const type = norm(raw?.type || raw?.chartType || raw?.chart_type || 'std');
    const difficulty = norm(raw?.difficulty);
    const song = catalog.getByStoredId(raw?.songId || raw?.favoriteId)
      || catalog.getUniqueByNormalizedTitle(normalizeSongText(raw?.title))
      || catalog.getByAlias(raw?.title);
    const chart = song?.difficultyLevels?.find((candidate) =>
      norm(candidate.type) === type && norm(candidate.difficulty) === difficulty
    );
    const constant = Number(chart?.internalLevelValue ?? raw?.internalLevelValue ?? raw?.constant);
    const achievement = percent(raw?.achievement);
    if (!song || !chart || !Number.isFinite(constant) || achievement == null) return null;
    return {
      key: `${song.songId}:${type}:${difficulty}`,
      songId: song.songId,
      type,
      difficulty,
      constant,
      achievement,
      playCount: Math.max(0, Math.trunc(Number(raw?.playCount ?? raw?.play_count) || 0))
    };
  };
}

function loadProfiles(db, catalog) {
  const resolveChart = chartResolver(catalog);
  const profiles = db.prepare('SELECT user_id, profile_name FROM account_profiles ORDER BY user_id, profile_name').all();
  const snapshots = db.prepare(`SELECT snapshot_id, captured_at, scores_json FROM account_snapshots
    WHERE user_id = ? AND profile_name = ? ORDER BY captured_at, snapshot_id`);
  const history = db.prepare(`SELECT played_at_iso, first_seen_at, data_json FROM account_recent_history
    WHERE user_id = ? AND profile_name = ? ORDER BY played_at_iso, first_seen_at`);
  return profiles.map((profile) => {
    const plays = history.all(profile.user_id, profile.profile_name).map((row) => {
      const play = resolveChart(JSON.parse(row.data_json));
      return play ? { ...play, playedAtIso: row.played_at_iso } : null;
    }).filter((play) => play && Number.isFinite(Date.parse(play.playedAtIso)));
    const candidates = snapshots.all(profile.user_id, profile.profile_name).map((snapshot) => {
      const bests = new Map();
      for (const raw of JSON.parse(snapshot.scores_json)) {
        const score = resolveChart(raw);
        if (!score) continue;
        const previous = bests.get(score.key);
        if (!previous || score.achievement > previous.achievement) bests.set(score.key, score);
      }
      return {
        snapshotId: snapshot.snapshot_id,
        cutoff: snapshot.captured_at,
        training: [...bests.values()],
        tests: plays.filter((play) => Date.parse(play.playedAtIso) > Date.parse(snapshot.captured_at))
      };
    }).filter((candidate) => candidate.training.length >= 50 && candidate.tests.length >= 8);
    candidates.sort((left, right) => right.tests.length - left.tests.length
      || Date.parse(left.cutoff) - Date.parse(right.cutoff) || left.snapshotId - right.snapshotId);
    return candidates[0] || null;
  }).filter(Boolean);
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, places = 4) => value == null ? null : Number(value.toFixed(places));

function modelMetrics(rows, key) {
  const usable = rows.filter((row) => Number.isFinite(row[key]?.expected));
  const errors = usable.map((row) => row[key].expected - row.actual);
  const oddsRows = usable.filter((row) => !row.firstPass && Number.isFinite(row[key].odds));
  const outcomes = oddsRows.map((row) => row.actual > row.bestBefore ? 1 : 0);
  return {
    n: usable.length,
    coverage: round(usable.length / Math.max(1, rows.length), 3),
    mae: round(mean(errors.map(Math.abs))),
    rmse: round(Math.sqrt(mean(errors.map((error) => error ** 2)) || 0)),
    bias: round(mean(errors)),
    exactRank: round(mean(usable.map((row) => rankForAchievement(row[key].expected) === rankForAchievement(row.actual) ? 1 : 0)), 3),
    oddsN: oddsRows.length,
    newBestBrier: round(mean(oddsRows.map((row, index) => (row[key].odds - outcomes[index]) ** 2)))
  };
}

function bundle(rows) {
  const repeats = rows.filter((row) => !row.firstPass);
  const baselineErrors = repeats.map((row) => row.bestBefore - row.actual);
  return {
    plays: rows.length,
    firstPass: rows.length - repeats.length,
    repeat: repeats.length,
    hybrid: modelMetrics(rows, 'hybrid'),
    maideck: modelMetrics(rows, 'maideck'),
    previousBest: {
      n: repeats.length,
      mae: round(mean(baselineErrors.map(Math.abs))),
      exactRank: round(mean(repeats.map((row) => rankForAchievement(row.bestBefore) === rankForAchievement(row.actual) ? 1 : 0)), 3)
    }
  };
}

function evaluate(profiles) {
  const rows = [];
  const profileRows = [];
  profiles.forEach((source, index) => {
    const current = new Map(source.training.map((score) => [score.key, { ...score }]));
    const recorded = [];
    const selected = [];
    for (const play of source.tests) {
      const before = current.get(play.key) || null;
      const maideckProfile = buildSkillProfile([...current.values()], recorded);
      const maideck = predictChart(maideckProfile, play, before);
      const hybridProfile = buildHybridSkillProfile([...current.values()], recorded);
      const hybrid = predictHybridChart(hybridProfile, play, before);
      const row = {
        actual: play.achievement,
        bestBefore: before?.achievement ?? 0,
        firstPass: !before,
        maideck: maideck.insufficient ? null : { expected: maideck.expected, odds: maideck.newBestSingleRunOdds },
        hybrid: hybrid.insufficient ? null : {
          expected: hybrid.expected,
          odds: hybrid.newBestSingleRunOdds,
          calibrationPlays: hybridProfile.rasmai.calibration.plays
        }
      };
      rows.push(row);
      selected.push(row);
      recorded.push({ ...play, bestBefore: before?.achievement ?? 0 });
      const playCount = (before?.playCount ?? 0) + 1;
      if (!before || play.achievement > before.achievement) current.set(play.key, { ...play, playCount });
      else before.playCount = playCount;
    }
    profileRows.push({ label: `Profile ${index + 1}`, ...bundle(selected) });
  });
  const shape = profiles.map((profile) => ({ cutoff: profile.cutoff, training: profile.training.length, heldOut: profile.tests.length }));
  return {
    generatedAt: new Date().toISOString(),
    design: 'time-forward snapshot replay; each held-out play is added only after prediction',
    datasetFingerprint: createHash('sha256').update(JSON.stringify(shape)).digest('hex'),
    profileCount: profiles.length,
    overall: bundle(rows),
    firstPass: bundle(rows.filter((row) => row.firstPass)),
    repeat: bundle(rows.filter((row) => !row.firstPass)),
    calibrated: bundle(rows.filter((row) => (row.hybrid?.calibrationPlays ?? 0) >= 15)),
    profiles: profileRows,
    releaseGate: { replayablePlaysRequired: 500, observationsPerReliabilityBucketRequired: 50, numericOddsEnabled: false }
  };
}

function displayPercent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function reportRow(label, segment) {
  return `| ${label} | ${segment.plays} | ${segment.firstPass} | ${segment.repeat} | ${segment.hybrid.mae ?? 'n/a'} | ${segment.maideck.mae ?? 'n/a'} | ${displayPercent(segment.hybrid.exactRank)} | ${segment.hybrid.newBestBrier ?? 'n/a'} |`;
}

function markdown(result) {
  return `# Hybrid model shadow backtest

Generated: ${result.generatedAt}

Aggregate metrics only: profile names, Discord IDs, raw plays, and individual predictions are excluded.

Design: ${result.design}. Profiles: ${result.profileCount}. Dataset fingerprint: \`${result.datasetFingerprint}\`.

| Segment | Plays | First pass | Repeat | Hybrid MAE | MaiDeck MAE | Hybrid exact rank | Hybrid new-best Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${reportRow('Overall', result.overall)}
${reportRow('First pass', result.firstPass)}
${reportRow('Repeat', result.repeat)}
${reportRow('After 15 calibration plays', result.calibrated)}

## Release status

- Shadow-only; not connected to Discord commands.
- Public output remains qualitative odds bands.
- Numeric odds require ${result.releaseGate.replayablePlaysRequired} replayable plays and ${result.releaseGate.observationsPerReliabilityBucketRequired} observations in every reliability bucket.
- Existing-profile results are development evidence, not fresh cross-player validation.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const catalog = new SongCatalog(resolve(options.catalog));
  await catalog.load();
  const db = new Database(resolve(options.db), { readonly: true, fileMustExist: true });
  try {
    const profiles = loadProfiles(db, catalog);
    if (!profiles.length) throw new Error('No profile has at least 50 training charts and 8 later plays.');
    const result = evaluate(profiles);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const output = resolve(options.output);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, markdown(result), { mode: 0o600 });
      console.log(`Wrote aggregate hybrid shadow report to ${output}`);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
