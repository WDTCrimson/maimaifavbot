import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function usageLogRetentionDays(environment = process.env) {
  return positiveInteger(environment.USAGE_LOG_RETENTION_DAYS, 30);
}

export async function pruneUsageLogs(directory, options = {}) {
  const retentionDays = positiveInteger(options.retentionDays, 30);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const cutoffMs = now.getTime() - retentionDays * DAY_MS;
  let removed = 0;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory)) {
    if (!/^usage-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const path = join(directory, name);
    const details = await stat(path);
    if (details.isFile() && details.mtimeMs < cutoffMs) {
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export async function removeUserFromUsageLogs(directory, userId) {
  const target = String(userId);
  let removedEvents = 0;
  let changedFiles = 0;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory)) {
    if (!/^usage-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const path = join(directory, name);
    const raw = await readFile(path, 'utf8');
    const kept = [];

    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (String(event?.userId ?? '') === target) {
          removedEvents += 1;
          continue;
        }
      } catch {
        // Preserve malformed lines rather than risking unrelated log loss.
      }
      kept.push(line);
    }

    const next = kept.length ? `${kept.join('\n')}\n` : '';
    if (next === raw) continue;
    changedFiles += 1;
    if (!next) {
      await rm(path, { force: true });
      continue;
    }

    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, next, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  }

  return { removedEvents, changedFiles };
}
