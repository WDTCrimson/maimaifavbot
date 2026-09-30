import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import {
  prepareLinkedAuthForStorage,
  restoreLinkedAuthFromStorage
} from '../src/account-link-auth.js';
import { planLinkedAuthRekey } from '../scripts/rekey-linked-auth.js';

const AUTH = { region: 'intl', type: 'clal', token: 'A'.repeat(32) };
const execFileAsync = promisify(execFile);

test('linked-auth rekey plan migrates old rows and is idempotent with the new key', () => {
  const oldSecret = 'old-secret'.repeat(4);
  const newSecret = 'new-secret'.repeat(4);
  const oldAccount = {
    player: { name: 'Old' },
    linkedAuth: prepareLinkedAuthForStorage(AUTH, oldSecret)
  };
  const newAccount = {
    player: { name: 'New' },
    linkedAuth: prepareLinkedAuthForStorage(AUTH, newSecret)
  };
  const plan = planLinkedAuthRekey([
    { user_id: '1', profile_name: 'default', account_json: JSON.stringify(oldAccount) },
    { user_id: '2', profile_name: 'default', account_json: JSON.stringify(newAccount) },
    { user_id: '3', profile_name: 'default', account_json: JSON.stringify({ player: { name: 'None' } }) }
  ], oldSecret, newSecret);

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.alreadyRekeyed, 1);
  assert.equal(plan.withoutLinkedAuth, 1);
  assert.deepEqual(plan.failures, []);
  const migrated = JSON.parse(plan.updates[0].nextJson);
  assert.equal(restoreLinkedAuthFromStorage(migrated.linkedAuth, newSecret).token, AUTH.token);
  assert.throws(() => restoreLinkedAuthFromStorage(migrated.linkedAuth, oldSecret));
});

test('linked-auth rekey plan reports undecryptable rows without producing updates', () => {
  const account = {
    linkedAuth: prepareLinkedAuthForStorage(AUTH, 'unrelated-secret'.repeat(3))
  };
  const plan = planLinkedAuthRekey([
    { user_id: '1', profile_name: 'default', account_json: JSON.stringify(account) }
  ], 'old-secret'.repeat(4), 'new-secret'.repeat(4));
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.failures.length, 1);
  assert.equal(plan.failures[0].reason, 'decrypt-failed');
});

test('rekey CLI backs up, migrates, verifies, and activates the collector', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linked-auth-rekey-'));
  const sqliteFile = join(directory, 'state.sqlite');
  const envFile = join(directory, '.env');
  const secretFile = join(directory, 'new-secret');
  const backupDir = join(directory, 'backups');
  const oldSecret = 'old-shared-secret'.repeat(3);
  const newSecret = 'new-data-secret'.repeat(3);
  const db = new Database(sqliteFile);
  try {
    db.exec('CREATE TABLE account_profiles (user_id TEXT, profile_name TEXT, account_json TEXT, PRIMARY KEY (user_id, profile_name))');
    db.prepare('INSERT INTO account_profiles VALUES (?, ?, ?)').run(
      '1',
      'default',
      JSON.stringify({ linkedAuth: prepareLinkedAuthForStorage(AUTH, oldSecret) })
    );
    db.close();
    await writeFile(envFile, `ACCOUNT_LINK_SHARED_SECRET=${oldSecret}\nACCOUNT_LINK_SIGNING_SECRET=signing-only-secret-value-123456789\n`, { mode: 0o600 });
    await writeFile(secretFile, `${newSecret}\n`, { mode: 0o600 });
    await chmod(secretFile, 0o600);

    const args = [
      'scripts/rekey-linked-auth.js',
      `--new-secret-file=${secretFile}`,
      `--env-file=${envFile}`,
      `--sqlite-file=${sqliteFile}`,
      `--backup-dir=${backupDir}`
    ];
    const dryRun = await execFileAsync(process.execPath, args, { cwd: process.cwd(), env: { PATH: process.env.PATH } });
    assert.match(dryRun.stdout, /To rekey: 1/);

    const applied = await execFileAsync(process.execPath, [...args, '--apply', '--activate-collector'], {
      cwd: process.cwd(), env: { PATH: process.env.PATH }
    });
    assert.match(applied.stdout, /Rekeyed 1 linked profile/);
    const migratedDb = new Database(sqliteFile, { readonly: true });
    const account = JSON.parse(migratedDb.prepare('SELECT account_json FROM account_profiles').get().account_json);
    migratedDb.close();
    assert.equal(restoreLinkedAuthFromStorage(account.linkedAuth, newSecret).token, AUTH.token);
    assert.match(await readFile(envFile, 'utf8'), /ACCOUNT_LINK_DATA_SECRET=new-data-secret/);
    assert.match(await readFile(envFile, 'utf8'), /QUIET_READS_ENABLED=true/);
    assert.equal((await readdir(backupDir)).length, 2);
  } finally {
    if (db.open) db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
