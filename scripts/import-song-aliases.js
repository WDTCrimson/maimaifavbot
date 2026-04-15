import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_SOURCE_URL = 'https://www.yuzuchan.moe/api/maimaidx/maimaidxalias';
const DEFAULT_OUTPUT_FILE = './data/reference/song-aliases.json';
const DEFAULT_REPORT_FILE = './data/reference/song-aliases-report.json';

function parseArgs(argv) {
  const args = {
    sourceUrl: DEFAULT_SOURCE_URL,
    sourceFile: null,
    outputFile: DEFAULT_OUTPUT_FILE,
    reportFile: DEFAULT_REPORT_FILE,
    minAliases: 1
  };

  for (const arg of argv) {
    if (arg === '--no-fetch') {
      args.sourceUrl = null;
      continue;
    }
    if (arg.startsWith('--source-url=')) {
      args.sourceUrl = arg.slice('--source-url='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--source-file=')) {
      args.sourceFile = arg.slice('--source-file='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--output-file=')) {
      args.outputFile = arg.slice('--output-file='.length).trim();
      continue;
    }
    if (arg.startsWith('--report-file=')) {
      args.reportFile = arg.slice('--report-file='.length).trim();
      continue;
    }
    if (arg.startsWith('--min-aliases=')) {
      const parsed = Number.parseInt(arg.slice('--min-aliases='.length), 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--min-aliases must be a positive integer.');
      }
      args.minAliases = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await rename(tempFile, filePath);
}

async function loadSource(args) {
  if (args.sourceFile) {
    return JSON.parse(await readFile(args.sourceFile, 'utf8'));
  }

  if (!args.sourceUrl) {
    throw new Error('No source configured. Use --source-file or --source-url.');
  }

  const response = await fetch(args.sourceUrl, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'maimaifavbot-alias-importer/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Alias source returned HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqAliases(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const alias = String(value || '').trim();
    const normalized = normalizeText(alias);
    if (!alias || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(alias);
  }
  return out;
}

function unwrapSourcePayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.content)) {
    return payload.content;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.aliases)) {
    return payload.aliases;
  }
  if (Array.isArray(payload?.songs)) {
    return payload.songs;
  }
  return [];
}

function normalizeSourceEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return null;
  }

  const aliases = uniqAliases(
    rawEntry.Alias ||
      rawEntry.alias ||
      rawEntry.aliases ||
      rawEntry.Nicknames ||
      rawEntry.nicknames ||
      []
  );
  if (!aliases.length) {
    return null;
  }

  const favoriteId = String(
    rawEntry.SongID ??
      rawEntry.songId ??
      rawEntry.song_id ??
      rawEntry.id ??
      ''
  ).trim();
  const title = String(rawEntry.Name || rawEntry.name || rawEntry.title || rawEntry.songName || '').trim();

  return {
    aliases,
    favoriteId: /^\d{1,8}$/.test(favoriteId) ? favoriteId : null,
    title: title || null
  };
}

function normalizeAliasEntries(payload, minAliases) {
  const rawEntries = unwrapSourcePayload(payload);
  const entries = [];
  const seenAlias = new Set();

  for (const rawEntry of rawEntries) {
    const entry = normalizeSourceEntry(rawEntry);
    if (!entry || entry.aliases.length < minAliases) {
      continue;
    }

    const aliases = [];
    for (const alias of entry.aliases) {
      const normalized = normalizeText(alias);
      if (seenAlias.has(normalized)) {
        continue;
      }
      seenAlias.add(normalized);
      aliases.push(alias);
    }

    if (!aliases.length) {
      continue;
    }

    entries.push({
      aliases,
      favoriteId: entry.favoriteId,
      title: entry.title
    });
  }

  entries.sort((a, b) => {
    const left = a.title || a.favoriteId || a.aliases[0] || '';
    const right = b.title || b.favoriteId || b.aliases[0] || '';
    return left.localeCompare(right);
  });

  return entries;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await loadSource(args);
  const entries = normalizeAliasEntries(payload, args.minAliases);
  const output = {
    generatedAt: new Date().toISOString(),
    source: args.sourceFile || args.sourceUrl,
    entries
  };
  const report = {
    generatedAt: output.generatedAt,
    source: output.source,
    entries: entries.length,
    aliases: entries.reduce((sum, entry) => sum + entry.aliases.length, 0),
    unresolvedWithoutTitleOrFavoriteId: entries.filter((entry) => !entry.title && !entry.favoriteId).length
  };

  await writeJson(args.outputFile, output);
  await writeJson(args.reportFile, report);

  console.log(`Saved ${report.aliases} aliases across ${report.entries} songs to ${args.outputFile}`);
  console.log(`Report: ${args.reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
