import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { LoadoutStore } from '../src/store.js';

dotenv.config({ quiet: true });

function parseArgs(argv) {
  const args = {
    output: null
  };

  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      const value = arg.split('=')[1]?.trim();
      if (!value) {
        throw new Error('Missing value for --output.');
      }
      args.output = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
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

function resolveOutputPath(explicitOutput) {
  if (explicitOutput) {
    return resolve(explicitOutput);
  }
  return resolve(`./backups/loadouts-export-${timestampForFile()}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backend = parseDataBackend();
  const jsonFile = process.env.DATA_FILE?.trim() || './data/loadouts.json';
  const sqliteFile = process.env.SQLITE_FILE?.trim() || './data/loadouts.sqlite';
  const outputPath = resolveOutputPath(args.output);

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
  await mkdir(dirname(outputPath), { recursive: true });

  const snapshot = {
    exportedAt: new Date().toISOString(),
    backend,
    source: backend === 'sqlite' ? sqliteFile : jsonFile,
    state: store.state
  };

  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');

  const users = Object.keys(store.state.users || {}).length;
  const loadouts = Object.values(store.state.users || {}).reduce((sum, user) => {
    const count = user?.loadouts && typeof user.loadouts === 'object' ? Object.keys(user.loadouts).length : 0;
    return sum + count;
  }, 0);

  console.log(`Exported ${users} users and ${loadouts} loadouts from ${backend} storage to ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
