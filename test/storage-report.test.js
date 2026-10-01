import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { collectStorageReport } from '../scripts/storage-report.js';

function fixtureDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'maideck-storage-report-'));
  const path = join(directory, 'loadouts.sqlite');
  const database = new Database(path);
  database.exec(`
    CREATE TABLE account_profiles (user_id TEXT, profile_name TEXT, account_json TEXT);
    CREATE TABLE account_score_charts (user_id TEXT, profile_name TEXT, title TEXT);
    CREATE TABLE account_snapshots (
      snapshot_json TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE account_recent_history (
      data_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL
    );
    INSERT INTO account_profiles VALUES ('one', 'default', '{}'), ('two', 'default', '{}');
    INSERT INTO account_score_charts VALUES ('one', 'default', 'A'), ('two', 'default', 'B');
    INSERT INTO account_snapshots VALUES
      ('{"rating": 1}', '[{"score": 1}]', '2026-01-01T00:00:00.000Z'),
      ('{"rating": 2}', '[{"score": 2}]', '2026-02-01T00:00:00.000Z');
    INSERT INTO account_recent_history VALUES
      ('{"play": 1}', '2026-01-01T00:00:00.000Z'),
      ('{"play": 2}', '2026-02-01T00:00:00.000Z');
  `);
  database.close();
  return { directory, path };
}

test('storage report measures snapshots and history without modifying the database', () => {
  const fixture = fixtureDatabase();
  try {
    const before = statSync(fixture.path);
    const report = collectStorageReport(fixture.path);
    const after = statSync(fixture.path);

    assert.equal(report.status, 'ok');
    assert.equal(report.profiles, 2);
    assert.equal(report.scoreRows, 2);
    assert.equal(report.snapshots.count, 2);
    assert.equal(report.recentHistory.count, 2);
    assert.ok(report.annualProjectionBytes > 0);
    assert.equal(before.size, after.size);
    assert.equal(before.mtimeMs, after.mtimeMs);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('storage report warns at configured size and profile thresholds', () => {
  const fixture = fixtureDatabase();
  try {
    const report = collectStorageReport(fixture.path, {
      dbThresholdGib: 0.000001,
      profileThreshold: 2
    });
    assert.equal(report.status, 'warning');
    assert.equal(report.warnings.length, 2);
    assert.match(report.warnings.join(' '), /database allocation reached/);
    assert.match(report.warnings.join(' '), /profile count reached/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
