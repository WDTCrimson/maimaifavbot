import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('hybrid shadow backtest documents its privacy boundary and required input', () => {
  const help = spawnSync(process.execPath, ['scripts/backtest-hybrid-model.js', '--help'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--db <path>/);
  assert.match(help.stdout, /No profile names, Discord IDs, raw plays, or prediction rows are written/);

  const missing = spawnSync(process.execPath, ['scripts/backtest-hybrid-model.js'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--db <path> is required/);
});
