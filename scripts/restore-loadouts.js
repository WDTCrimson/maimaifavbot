import dotenv from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { LoadoutStore } from '../src/store.js';

dotenv.config({ quiet: true });

function parseArgs(argv) {
  const args = {
    input: null,
    skipBackup: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      const value = arg.split('=')[1]?.trim();
      if (!value) {
        throw new Error('Missing value for --input.');
      }
      args.input = value;
      continue;
    }

    if (arg === '--skip-backup') {
      args.skipBackup = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.input) {
    throw new Error('Missing required --input=... argument.');
  }

  return args;
}

function timestampForFile(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function parseDataBackend() {
  const value = (process.env.DATA_BACKEND || 'json').trim().toLowerCase();
  if (value !== 'json' && value !== 'sqlite') {
    throw new Error('DATA_BACKEND must be either "json" or "sqlite".');
  }
  return value;
}

function buildDefaultMetadata() {
  return {
    loadoutSchemaVersion: 1,
    loadoutSchemaMigratedAt: null,
    legacySongIdsRemaining: null
  };
}

function normalizeRestoredState(state) {
  const normalized = state && typeof state === 'object' ? { ...state } : {};
  if (!normalized.users || typeof normalized.users !== 'object' || Array.isArray(normalized.users)) {
    normalized.users = {};
  }
  if (
    !normalized.accountLinkSessions ||
    typeof normalized.accountLinkSessions !== 'object' ||
    Array.isArray(normalized.accountLinkSessions)
  ) {
    normalized.accountLinkSessions = {};
  }
  if (!normalized.metadata || typeof normalized.metadata !== 'object' || Array.isArray(normalized.metadata)) {
    normalized.metadata = buildDefaultMetadata();
  } else {
    normalized.metadata = {
      ...buildDefaultMetadata(),
      ...normalized.metadata
    };
  }
  return normalized;
}

async function writeSnapshot(filePath, snapshot) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backend = parseDataBackend();
  const jsonFile = process.env.DATA_FILE?.trim() || './data/loadouts.json';
  const sqliteFile = process.env.SQLITE_FILE?.trim() || './data/loadouts.sqlite';

  const store = new LoadoutStore(
    {
      backend,
      jsonFile,
      sqliteFile
    },
    {
      maxSongsPerLoadout: 30,
      maxNameLength: 32
    }
  );

  await store.ensureReady();

  if (!args.skipBackup) {
    const backupPath = resolve(`./backups/pre-restore-${timestampForFile()}.json`);
    await writeSnapshot(backupPath, {
      exportedAt: new Date().toISOString(),
      backend,
      source: backend === 'sqlite' ? sqliteFile : jsonFile,
      state: store.state
    });
    console.log(`Saved pre-restore backup to ${backupPath}`);
  }

  const inputPath = resolve(args.input);
  const raw = await readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  const state = normalizeRestoredState(parsed?.state ?? parsed);

  store.state = state;
  await store.save();

  const users = Object.keys(store.state.users || {}).length;
  const loadouts = Object.values(store.state.users || {}).reduce((sum, user) => {
    const count = user?.loadouts && typeof user.loadouts === 'object' ? Object.keys(user.loadouts).length : 0;
    return sum + count;
  }, 0);

  console.log(`Restored ${users} users and ${loadouts} loadouts into ${backend} storage from ${inputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
