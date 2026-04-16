import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_YUZU_URL = 'https://www.yuzuchan.moe/api/maimaidx/maimaidxalias';
const DEFAULT_GCM_URLS = {
  en: 'https://raw.githubusercontent.com/lomotos10/GCM-bot/main/data/aliases/en/maimai.tsv',
  ko: 'https://raw.githubusercontent.com/lomotos10/GCM-bot/main/data/aliases/ko/maimai.tsv'
};
const DEFAULT_OUTPUT_FILE = './data/reference/song-aliases.json';
const DEFAULT_REPORT_FILE = './data/reference/song-aliases-report.json';

function parseArgs(argv) {
  const args = {
    sourceUrl: null,
    sourceFile: null,
    outputFile: DEFAULT_OUTPUT_FILE,
    reportFile: DEFAULT_REPORT_FILE,
    minAliases: 1,
    useYuzu: true,
    useGcm: true,
    preserveExisting: true
  };

  for (const arg of argv) {
    if (arg === '--no-fetch') {
      args.useYuzu = false;
      args.useGcm = false;
      continue;
    }
    if (arg === '--no-yuzu') {
      args.useYuzu = false;
      continue;
    }
    if (arg === '--no-gcm') {
      args.useGcm = false;
      continue;
    }
    if (arg === '--no-preserve-existing') {
      args.preserveExisting = false;
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

  if ((args.sourceUrl || args.sourceFile) && (args.useYuzu || args.useGcm)) {
    args.useYuzu = false;
    args.useGcm = false;
  }

  return args;
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await rename(tempFile, filePath);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'maimaifavbot-alias-importer/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Alias source returned HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/plain,text/tab-separated-values,*/*',
      'user-agent': 'maimaifavbot-alias-importer/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Alias source returned HTTP ${response.status} for ${url}`);
  }
  return response.text();
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

function normalizeYuzuEntry(rawEntry) {
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
    rawEntry.SongID ?? rawEntry.songId ?? rawEntry.song_id ?? rawEntry.id ?? ''
  ).trim();
  const title = String(rawEntry.Name || rawEntry.name || rawEntry.title || rawEntry.songName || '').trim();

  return {
    aliases,
    favoriteId: /^\d{1,8}$/.test(favoriteId) ? favoriteId : null,
    title: title || null,
    source: 'yuzu'
  };
}

function parseGcmTsv(text, locale) {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const cells = line.split('\t').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    const [title, ...aliases] = cells;
    const normalizedAliases = uniqAliases(aliases);
    if (!title || !normalizedAliases.length) {
      continue;
    }
    entries.push({
      aliases: normalizedAliases,
      favoriteId: null,
      title,
      source: `gcm:${locale}`
    });
  }
  return entries;
}

async function loadSourceEntries(args) {
  if (args.sourceFile) {
    const payload = JSON.parse(await readFile(args.sourceFile, 'utf8'));
    return {
      sources: [args.sourceFile],
      entries: unwrapSourcePayload(payload).map(normalizeYuzuEntry).filter(Boolean)
    };
  }

  if (args.sourceUrl) {
    const payload = await fetchJson(args.sourceUrl);
    return {
      sources: [args.sourceUrl],
      entries: unwrapSourcePayload(payload).map(normalizeYuzuEntry).filter(Boolean)
    };
  }

  const sources = [];
  const entries = [];

  if (args.useYuzu) {
    const payload = await fetchJson(DEFAULT_YUZU_URL);
    sources.push(DEFAULT_YUZU_URL);
    entries.push(...unwrapSourcePayload(payload).map(normalizeYuzuEntry).filter(Boolean));
  }

  if (args.useGcm) {
    for (const [locale, url] of Object.entries(DEFAULT_GCM_URLS)) {
      const text = await fetchText(url);
      sources.push(url);
      entries.push(...parseGcmTsv(text, locale));
    }
  }

  if (!entries.length) {
    throw new Error('No alias sources configured. Use default sources or pass --source-file/--source-url.');
  }

  return { sources, entries };
}

function mergeEntryMaps(target, incoming) {
  for (const alias of incoming.aliases) {
    const normalized = normalizeText(alias);
    if (!normalized || target.normAliasSet.has(normalized)) {
      continue;
    }
    target.normAliasSet.add(normalized);
    target.aliases.push(alias);
  }
  if (!target.favoriteId && incoming.favoriteId) {
    target.favoriteId = incoming.favoriteId;
  }
}

function entryKey(entry) {
  const title = normalizeText(entry.title);
  if (title) {
    return `title:${title}`;
  }
  const favoriteId = String(entry.favoriteId || '').trim();
  if (favoriteId) {
    return `favorite:${favoriteId}`;
  }
  return null;
}

function buildNormalizedEntries(entries, minAliases) {
  const byKey = new Map();

  for (const rawEntry of entries) {
    if (!rawEntry || rawEntry.aliases.length < minAliases) {
      continue;
    }

    const key = entryKey(rawEntry);
    if (!key) {
      continue;
    }

    const existing = byKey.get(key);
    if (existing) {
      mergeEntryMaps(existing, rawEntry);
      continue;
    }

    byKey.set(key, {
      aliases: [...rawEntry.aliases],
      normAliasSet: new Set(rawEntry.aliases.map((alias) => normalizeText(alias)).filter(Boolean)),
      favoriteId: rawEntry.favoriteId || null,
      title: rawEntry.title || null,
      sources: new Set(rawEntry.source ? [rawEntry.source] : [])
    });
  }

  const entriesOut = [...byKey.values()].map((entry) => ({
    aliases: entry.aliases,
    favoriteId: entry.favoriteId,
    title: entry.title,
    sources: [...entry.sources].sort()
  }));

  entriesOut.sort((a, b) => {
    const left = a.title || a.favoriteId || a.aliases[0] || '';
    const right = b.title || b.favoriteId || b.aliases[0] || '';
    return left.localeCompare(right);
  });

  return entriesOut;
}

function normalizeExistingEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return null;
  }
  const aliases = uniqAliases(rawEntry.aliases || rawEntry.alias || []);
  if (!aliases.length) {
    return null;
  }
  return {
    aliases,
    favoriteId: rawEntry.favoriteId ? String(rawEntry.favoriteId).trim() : null,
    title: rawEntry.title ? String(rawEntry.title).trim() : null,
    source: 'existing'
  };
}

async function loadExistingEntries(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.map(normalizeExistingEntry).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function preserveExistingAliases(importedEntries, existingEntries) {
  const importedAliasSet = new Set();
  const importedKeyMap = new Map();

  for (const entry of importedEntries) {
    const key = entryKey(entry);
    if (key) {
      importedKeyMap.set(key, entry);
    }
    for (const alias of entry.aliases) {
      importedAliasSet.add(normalizeText(alias));
    }
  }

  let preservedAliases = 0;
  for (const existingEntry of existingEntries) {
    const aliasesToPreserve = existingEntry.aliases.filter((alias) => !importedAliasSet.has(normalizeText(alias)));
    if (!aliasesToPreserve.length) {
      continue;
    }

    preservedAliases += aliasesToPreserve.length;
    const key = entryKey(existingEntry);
    const target = key ? importedKeyMap.get(key) : null;
    if (target) {
      for (const alias of aliasesToPreserve) {
        target.aliases.push(alias);
        importedAliasSet.add(normalizeText(alias));
      }
      target.sources = [...new Set([...(target.sources || []), 'existing'])].sort();
      continue;
    }

    const appended = {
      aliases: uniqAliases(aliasesToPreserve),
      favoriteId: existingEntry.favoriteId || null,
      title: existingEntry.title || null,
      sources: ['existing']
    };
    importedEntries.push(appended);
    const appendedKey = entryKey(appended);
    if (appendedKey) {
      importedKeyMap.set(appendedKey, appended);
    }
    for (const alias of appended.aliases) {
      importedAliasSet.add(normalizeText(alias));
    }
  }

  importedEntries.sort((a, b) => {
    const left = a.title || a.favoriteId || a.aliases[0] || '';
    const right = b.title || b.favoriteId || b.aliases[0] || '';
    return left.localeCompare(right);
  });

  return preservedAliases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const loaded = await loadSourceEntries(args);
  const importedEntries = buildNormalizedEntries(loaded.entries, args.minAliases);
  const existingEntries = args.preserveExisting ? await loadExistingEntries(args.outputFile) : [];
  const preservedAliases = args.preserveExisting ? preserveExistingAliases(importedEntries, existingEntries) : 0;

  const generatedAt = new Date().toISOString();
  const output = {
    generatedAt,
    source: loaded.sources.length === 1 ? loaded.sources[0] : 'combined',
    sources: loaded.sources,
    entries: importedEntries
  };
  const report = {
    generatedAt,
    source: output.source,
    sources: loaded.sources,
    entries: importedEntries.length,
    aliases: importedEntries.reduce((sum, entry) => sum + entry.aliases.length, 0),
    preservedExistingAliases: preservedAliases,
    unresolvedWithoutTitleOrFavoriteId: importedEntries.filter((entry) => !entry.title && !entry.favoriteId).length
  };

  await writeJson(args.outputFile, output);
  await writeJson(args.reportFile, report);

  console.log(`Saved ${report.aliases} aliases across ${report.entries} songs to ${args.outputFile}`);
  if (report.preservedExistingAliases) {
    console.log(`Preserved ${report.preservedExistingAliases} existing aliases from ${args.outputFile}`);
  }
  console.log(`Report: ${args.reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
