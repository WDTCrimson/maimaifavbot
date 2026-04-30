import dotenv from 'dotenv';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { LoadoutStore } from '../src/store.js';

dotenv.config({ quiet: true });

function parseArgs(argv) {
  const args = {
    output: null,
    retentionDays: null
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

    if (arg.startsWith('--retention-days=')) {
      const value = Number.parseInt(arg.split('=')[1] ?? '', 10);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('Invalid value for --retention-days (must be a positive integer).');
      }
      args.retentionDays = value;
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

async function cleanupOldExports(outputPath, retentionDays) {
  if (!retentionDays) {
    return 0;
  }

  const directory = dirname(outputPath);
  const currentFile = basename(outputPath);
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of await readdir(directory)) {
    if (entry === currentFile || !/^loadouts-export-\d{8}-\d{6}\.json$/.test(entry)) {
      continue;
    }

    const entryPath = resolve(directory, entry);
    const entryStat = await stat(entryPath);
    if (!entryStat.isFile()) {
      continue;
    }

    if (entryStat.mtimeMs < cutoffMs) {
      await rm(entryPath, { force: true });
      removed += 1;
    }
  }

  return removed;
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
    state: store.getExportState()
  };

  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  const removedBackups = await cleanupOldExports(outputPath, args.retentionDays);

  const users = Object.keys(store.state.users || {}).length;
  const loadouts = Object.values(store.state.users || {}).reduce((sum, user) => {
    const count = user?.loadouts && typeof user.loadouts === 'object' ? Object.keys(user.loadouts).length : 0;
    return sum + count;
  }, 0);

  console.log(`Exported ${users} users and ${loadouts} loadouts from ${backend} storage to ${outputPath}`);
  if (args.retentionDays) {
    console.log(`Removed ${removedBackups} old backup(s) older than ${args.retentionDays} day(s).`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
