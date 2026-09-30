import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  prepareLinkedAuthForStorage,
  restoreLinkedAuthFromStorage
} from '../src/account-link-auth.js';

function parseArgs(argv) {
  const args = {
    apply: false,
    activateCollector: false,
    newSecretFile: null,
    envFile: resolve('.env'),
    sqliteFile: null,
    backupDir: resolve('backups')
  };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--activate-collector') args.activateCollector = true;
    else if (arg.startsWith('--new-secret-file=')) args.newSecretFile = resolve(arg.slice(18));
    else if (arg.startsWith('--env-file=')) args.envFile = resolve(arg.slice(11));
    else if (arg.startsWith('--sqlite-file=')) args.sqliteFile = resolve(arg.slice(14));
    else if (arg.startsWith('--backup-dir=')) args.backupDir = resolve(arg.slice(13));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.newSecretFile) throw new Error('Missing required --new-secret-file=PATH.');
  if (args.activateCollector && !args.apply) {
    throw new Error('--activate-collector requires --apply.');
  }
  return args;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function readProtectedSecret(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('The new secret path is not a regular file.');
  if ((info.mode & 0o077) !== 0) {
    throw new Error('The new secret file must not be readable or writable by group/other users (use chmod 600).');
  }
  const secret = (await readFile(filePath, 'utf8')).trim();
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('The new data secret must be at least 32 bytes.');
  }
  return secret;
}

export function planLinkedAuthRekey(rows, oldSecret, newSecret) {
  const updates = [];
  let withoutLinkedAuth = 0;
  let alreadyRekeyed = 0;
  const failures = [];

  for (const row of rows) {
    let account;
    try {
      account = JSON.parse(row.account_json);
    } catch {
      failures.push({ userId: row.user_id, profileName: row.profile_name, reason: 'invalid-account-json' });
      continue;
    }
    if (!account?.linkedAuth) {
      withoutLinkedAuth += 1;
      continue;
    }

    try {
      restoreLinkedAuthFromStorage(account.linkedAuth, newSecret);
      alreadyRekeyed += 1;
      continue;
    } catch {
      // Expected for rows still encrypted with the old key.
    }

    try {
      const auth = restoreLinkedAuthFromStorage(account.linkedAuth, oldSecret);
      updates.push({
        userId: row.user_id,
        profileName: row.profile_name,
        previousJson: row.account_json,
        nextJson: JSON.stringify({
          ...account,
          linkedAuth: prepareLinkedAuthForStorage(auth, newSecret)
        })
      });
    } catch {
      failures.push({ userId: row.user_id, profileName: row.profile_name, reason: 'decrypt-failed' });
    }
  }

  return { updates, withoutLinkedAuth, alreadyRekeyed, failures };
}

function replaceEnvValue(source, key, value) {
  const lines = source.split(/\r?\n/);
  const indexes = lines.flatMap((line, index) => line.startsWith(`${key}=`) ? [index] : []);
  if (indexes.length > 1) throw new Error(`The env file contains duplicate ${key} entries.`);
  if (indexes.length === 1) lines[indexes[0]] = `${key}=${value}`;
  else {
    if (lines.at(-1) !== '') lines.push('');
    lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

async function writeActivatedEnv(envFile, newSecret) {
  const current = await readFile(envFile, 'utf8');
  const next = replaceEnvValue(
    replaceEnvValue(current, 'ACCOUNT_LINK_DATA_SECRET', newSecret),
    'QUIET_READS_ENABLED',
    'true'
  );
  const tempPath = `${envFile}.rekey-${process.pid}.tmp`;
  await writeFile(tempPath, next, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, envFile);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: args.envFile, quiet: true });
  const oldSecret = process.env.ACCOUNT_LINK_DATA_SECRET?.trim()
    || process.env.ACCOUNT_LINK_SHARED_SECRET?.trim();
  if (!oldSecret) throw new Error('The current ACCOUNT_LINK_DATA_SECRET or ACCOUNT_LINK_SHARED_SECRET is missing.');
  const newSecret = await readProtectedSecret(args.newSecretFile);
  const signingSecret = process.env.ACCOUNT_LINK_SIGNING_SECRET?.trim()
    || process.env.ACCOUNT_LINK_SHARED_SECRET?.trim();
  const sharedSecret = process.env.ACCOUNT_LINK_SHARED_SECRET?.trim();
  if (newSecret === oldSecret || newSecret === signingSecret || newSecret === sharedSecret) {
    throw new Error('The new data secret must differ from the current data, signing, and shared secrets.');
  }

  const sqliteFile = args.sqliteFile
    || resolve(process.env.SQLITE_FILE?.trim() || './data/loadouts.sqlite');
  const db = new Database(sqliteFile);
  db.pragma('busy_timeout = 5000');
  try {
    const rows = db.prepare(
      'SELECT user_id, profile_name, account_json FROM account_profiles WHERE account_json IS NOT NULL'
    ).all();
    const plan = planLinkedAuthRekey(rows, oldSecret, newSecret);
    console.log(`Profiles scanned: ${rows.length}. To rekey: ${plan.updates.length}. Already rekeyed: ${plan.alreadyRekeyed}. Without linked auth: ${plan.withoutLinkedAuth}.`);
    if (plan.failures.length) {
      throw new Error(`${plan.failures.length} linked profile(s) could not be validated; no changes were written.`);
    }
    if (!args.apply) {
      console.log('Dry run complete. Re-run with --apply --activate-collector while the bot is stopped.');
      return;
    }

    await mkdir(args.backupDir, { recursive: true });
    const stamp = timestampForFile();
    const databaseBackup = resolve(args.backupDir, `loadouts-pre-linked-auth-rekey-${stamp}.sqlite`);
    await db.backup(databaseBackup);
    let envBackup = null;
    if (args.activateCollector) {
      envBackup = resolve(args.backupDir, `env-pre-linked-auth-rekey-${stamp}`);
      await copyFile(args.envFile, envBackup);
      await chmod(envBackup, 0o600);
    }

    const update = db.prepare(
      'UPDATE account_profiles SET account_json = ? WHERE user_id = ? AND profile_name = ? AND account_json = ?'
    );
    const writeUpdates = db.transaction((updates) => {
      for (const item of updates) {
        const result = update.run(item.nextJson, item.userId, item.profileName, item.previousJson);
        if (result.changes !== 1) throw new Error('Concurrent account change detected; rekey aborted.');
      }
    });
    const restoreUpdates = db.transaction((updates) => {
      for (const item of updates) {
        update.run(item.previousJson, item.userId, item.profileName, item.nextJson);
      }
    });

    writeUpdates(plan.updates);
    try {
      for (const item of plan.updates) {
        const account = JSON.parse(item.nextJson);
        restoreLinkedAuthFromStorage(account.linkedAuth, newSecret);
      }
      if (args.activateCollector) await writeActivatedEnv(args.envFile, newSecret);
    } catch (error) {
      restoreUpdates(plan.updates);
      throw error;
    }

    console.log(`Rekeyed ${plan.updates.length} linked profile(s). Database backup: ${databaseBackup}`);
    if (envBackup) console.log(`Collector enabled in ${args.envFile}. Env backup: ${envBackup}`);
  } finally {
    db.close();
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
