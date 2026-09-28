import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { verifyBestTimedPlayRows } from '../src/store.js';

function databasePath(argv) {
  const index = argv.indexOf('--db');
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  return resolve(process.env.SQLITE_FILE || './data/loadouts.sqlite');
}

function main() {
  const filePath = databasePath(process.argv.slice(2));
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    );
    for (const required of ['account_profiles', 'account_recent_history', 'account_best_timed_plays']) {
      if (!tables.has(required)) throw new Error(`Missing required table: ${required}`);
    }
    const historyRows = db.prepare(
      `SELECT h.user_id, h.profile_name, h.play_key, h.first_seen_at, h.data_json
       FROM account_recent_history h
       INNER JOIN account_profiles p
         ON p.user_id = h.user_id AND p.profile_name = h.profile_name`
    ).all();
    const actualRows = db.prepare(
      `SELECT user_id, profile_name, title, title_key, favorite_id, difficulty, chart_type,
              achievement, dx_score, fast_count, late_count, played_at_iso, play_key, synced_at
       FROM account_best_timed_plays`
    ).all();
    const result = verifyBestTimedPlayRows(historyRows, actualRows);
    console.log(JSON.stringify({ database: filePath, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}
