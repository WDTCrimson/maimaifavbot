#!/usr/bin/env node
import { statSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const DEFAULT_DB = './data/loadouts.sqlite';
const DEFAULT_DB_THRESHOLD_GIB = 1;
const DEFAULT_PROFILE_THRESHOLD = 250;
const LOW_DISK_PERCENT = 20;

function usage() {
  return `Usage: npm run storage:report -- [options]

Options:
  --db <path>                 SQLite database (default: ${DEFAULT_DB})
  --db-threshold-gib <value>  Warn at this allocated size (default: ${DEFAULT_DB_THRESHOLD_GIB})
  --profile-threshold <value> Warn at this profile count (default: ${DEFAULT_PROFILE_THRESHOLD})
  --json                      Print machine-readable JSON
  --help                      Show this help

This command is read-only. It never compacts, deletes, vacuums, or modifies the database.`;
}

function positiveNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${option} requires a positive number.`);
  return number;
}

function parseArgs(argv) {
  const options = {
    db: DEFAULT_DB,
    dbThresholdGib: DEFAULT_DB_THRESHOLD_GIB,
    profileThreshold: DEFAULT_PROFILE_THRESHOLD,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--db' || argument === '--db-threshold-gib' || argument === '--profile-threshold') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      if (argument === '--db') options.db = value;
      else if (argument === '--db-threshold-gib') options.dbThresholdGib = positiveNumber(value, argument);
      else options.profileThreshold = positiveNumber(value, argument);
      index += 1;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function tableExists(database, name) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name));
}

function aggregateTable(database, table, bytesExpression, timeColumn = null) {
  if (!tableExists(database, table)) return { count: 0, bytes: 0, oldest: null, newest: null };
  const timeFields = timeColumn
    ? `, MIN(${timeColumn}) AS oldest, MAX(${timeColumn}) AS newest`
    : ', NULL AS oldest, NULL AS newest';
  const row = database.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(${bytesExpression}), 0) AS bytes${timeFields} FROM ${table}`
  ).get();
  return {
    count: Number(row.count) || 0,
    bytes: Number(row.bytes) || 0,
    oldest: row.oldest || null,
    newest: row.newest || null
  };
}

function annualProjection(section) {
  if (!section.count || !section.bytes || !section.oldest || !section.newest) return null;
  const oldest = Date.parse(section.oldest);
  const newest = Date.parse(section.newest);
  if (!Number.isFinite(oldest) || !Number.isFinite(newest)) return null;
  const observedDays = Math.max(1, (newest - oldest) / 86_400_000 + 1);
  if (observedDays < 7) return null;
  return Math.round(section.bytes / observedDays * 365);
}

function diskStats(path) {
  const stats = statfsSync(dirname(path), { bigint: true });
  const totalBytes = Number(stats.blocks * stats.bsize);
  const freeBytes = Number(stats.bavail * stats.bsize);
  return {
    totalBytes,
    freeBytes,
    freePercent: totalBytes ? freeBytes / totalBytes * 100 : null
  };
}

export function collectStorageReport(path, options = {}) {
  const databasePath = resolve(path);
  const dbThresholdBytes = (options.dbThresholdGib ?? DEFAULT_DB_THRESHOLD_GIB) * 1024 ** 3;
  const profileThreshold = options.profileThreshold ?? DEFAULT_PROFILE_THRESHOLD;
  const fileBytes = statSync(databasePath).size;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const pageSize = Number(database.pragma('page_size', { simple: true }));
    const pageCount = Number(database.pragma('page_count', { simple: true }));
    const freePages = Number(database.pragma('freelist_count', { simple: true }));
    const allocatedBytes = pageSize * pageCount;
    const reclaimableBytes = pageSize * freePages;
    const profiles = tableExists(database, 'account_profiles')
      ? Number(database.prepare('SELECT COUNT(*) AS count FROM account_profiles').get().count)
      : 0;
    const scoreRows = tableExists(database, 'account_score_charts')
      ? Number(database.prepare('SELECT COUNT(*) AS count FROM account_score_charts').get().count)
      : 0;
    const snapshots = aggregateTable(
      database,
      'account_snapshots',
      'LENGTH(snapshot_json) + LENGTH(scores_json)',
      'captured_at'
    );
    const recentHistory = aggregateTable(
      database,
      'account_recent_history',
      'LENGTH(data_json)',
      'first_seen_at'
    );
    const disk = diskStats(databasePath);
    const warnings = [];
    if (allocatedBytes >= dbThresholdBytes) {
      warnings.push(`database allocation reached ${options.dbThresholdGib ?? DEFAULT_DB_THRESHOLD_GIB} GiB`);
    }
    if (profiles >= profileThreshold) warnings.push(`profile count reached ${profileThreshold}`);
    if (disk.freePercent != null && disk.freePercent < LOW_DISK_PERCENT) {
      warnings.push(`filesystem free space is below ${LOW_DISK_PERCENT}%`);
    }
    const snapshotAnnualBytes = annualProjection(snapshots);
    const historyAnnualBytes = annualProjection(recentHistory);
    return {
      generatedAt: new Date().toISOString(),
      databasePath,
      status: warnings.length ? 'warning' : 'ok',
      thresholds: {
        databaseBytes: dbThresholdBytes,
        profiles: profileThreshold,
        lowDiskPercent: LOW_DISK_PERCENT
      },
      database: { fileBytes, allocatedBytes, reclaimableBytes },
      disk,
      profiles,
      scoreRows,
      snapshots: { ...snapshots, annualProjectionBytes: snapshotAnnualBytes },
      recentHistory: { ...recentHistory, annualProjectionBytes: historyAnnualBytes },
      annualProjectionBytes: snapshotAnnualBytes == null && historyAnnualBytes == null
        ? null
        : (snapshotAnnualBytes || 0) + (historyAnnualBytes || 0),
      warnings
    };
  } finally {
    database.close();
  }
}

function bytes(value) {
  if (value == null) return 'insufficient history';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Number(value) || 0;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function render(report) {
  const lines = [
    `Storage status: ${report.status.toUpperCase()}`,
    `Database: ${bytes(report.database.allocatedBytes)} allocated (${bytes(report.database.reclaimableBytes)} reclaimable)`,
    `Profiles: ${report.profiles.toLocaleString()} / ${report.thresholds.profiles.toLocaleString()} warning threshold`,
    `Scores: ${report.scoreRows.toLocaleString()} rows`,
    `Snapshots: ${report.snapshots.count.toLocaleString()} rows, ${bytes(report.snapshots.bytes)} JSON payload`,
    `Recent history: ${report.recentHistory.count.toLocaleString()} rows, ${bytes(report.recentHistory.bytes)} JSON payload`,
    `Observed annual payload-growth projection: ${bytes(report.annualProjectionBytes)}`,
    `Filesystem: ${bytes(report.disk.freeBytes)} free (${report.disk.freePercent?.toFixed(1) ?? 'n/a'}%)`
  ];
  if (report.warnings.length) lines.push(`Warnings: ${report.warnings.join('; ')}`);
  else lines.push('Warnings: none; compaction remains disabled.');
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const report = collectStorageReport(options.db, options);
      console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    }
  } catch (error) {
    console.error(error.message);
    console.error('Run with --help for usage.');
    process.exitCode = 1;
  }
}
