import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneUsageLogs, removeUserFromUsageLogs, usageLogRetentionDays } from '../src/log-retention.js';

test('usage log retention defaults to 30 days and accepts a positive override', () => {
  assert.equal(usageLogRetentionDays({}), 30);
  assert.equal(usageLogRetentionDays({ USAGE_LOG_RETENTION_DAYS: '14' }), 14);
  assert.equal(usageLogRetentionDays({ USAGE_LOG_RETENTION_DAYS: '0' }), 30);
});

test('usage log deletion removes one user while preserving unrelated and malformed events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'usage-logs-'));
  const path = join(directory, 'usage-2026-10-13.log');
  try {
    await writeFile(path, [
      JSON.stringify({ userId: 'delete-me', cmd: 'song' }),
      '{malformed',
      JSON.stringify({ userId: 'keep-me', cmd: 'account' }),
      ''
    ].join('\n'));

    const result = await removeUserFromUsageLogs(directory, 'delete-me');
    assert.deepEqual(result, { removedEvents: 1, changedFiles: 1 });
    const remaining = await readFile(path, 'utf8');
    assert.doesNotMatch(remaining, /delete-me/);
    assert.match(remaining, /keep-me/);
    assert.match(remaining, /malformed/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('usage log pruning removes only expired dated usage logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'usage-prune-'));
  try {
    await writeFile(join(directory, 'usage-2026-08-01.log'), 'old\n');
    await writeFile(join(directory, 'usage-2026-10-13.log'), 'current\n');
    await writeFile(join(directory, 'error-2026-08-01.log'), 'unrelated\n');
    const old = new Date('2026-08-01T00:00:00Z');
    const current = new Date('2026-10-13T00:00:00Z');
    const { utimes } = await import('node:fs/promises');
    await utimes(join(directory, 'usage-2026-08-01.log'), old, old);
    await utimes(join(directory, 'usage-2026-10-13.log'), current, current);

    assert.equal(await pruneUsageLogs(directory, { retentionDays: 30, now: current }), 1);
    await assert.rejects(() => stat(join(directory, 'usage-2026-08-01.log')), { code: 'ENOENT' });
    assert.equal((await stat(join(directory, 'usage-2026-10-13.log'))).isFile(), true);
    assert.equal((await stat(join(directory, 'error-2026-08-01.log'))).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
