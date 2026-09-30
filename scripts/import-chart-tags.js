import { pathToFileURL } from 'node:url';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildCanonicalSongId, normalizeSongText } from '../src/song-catalog.js';

const DEFAULT_SOURCE_URL = 'https://mai-notes.com/data/manifest.json';
const DEFAULT_CATALOG_FILE = './data/import/songs.normalized.json';
const DEFAULT_OUTPUT_FILE = './data/reference/chart-tags.json';
const DEFAULT_REPORT_FILE = './data/reference/chart-tags-report.json';

const HELP = `Import editor pattern tags from mai-notes.

Usage: node scripts/import-chart-tags.js [options]

Options:
  --help                 Show this help
  --dry-run              Fetch and match without writing files
  --json                 Print the result summary as JSON
  --source-url <url>     Manifest URL (default: ${DEFAULT_SOURCE_URL})
  --source-file <path>   Read a local manifest fixture instead of fetching
  --catalog <path>       Song catalog JSON
  --output <path>        Derived chart-tag output JSON
  --report <path>        Match report JSON
`;

export function parseArgs(argv) {
  const args = {
    help: false,
    dryRun: false,
    json: false,
    sourceUrl: DEFAULT_SOURCE_URL,
    sourceFile: null,
    catalogFile: DEFAULT_CATALOG_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    reportFile: DEFAULT_REPORT_FILE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (['--source-url', '--source-file', '--catalog', '--output', '--report'].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === '--source-url') args.sourceUrl = value;
      if (arg === '--source-file') args.sourceFile = value;
      if (arg === '--catalog') args.catalogFile = value;
      if (arg === '--output') args.outputFile = value;
      if (arg === '--report') args.reportFile = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] != null && object[key] !== '') return object[key];
  }
  return null;
}

function normalizeType(value) {
  const text = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (['dx', 'deluxe', 'でらっくす'].includes(text)) return 'dx';
  if (['std', 'standard', 'legacy', 'スタンダード'].includes(text)) return 'std';
  return text;
}

function normalizeDifficulty(value) {
  if (Number.isInteger(value)) return ['basic', 'advanced', 'expert', 'master', 'remaster', 'utage'][value] || String(value);
  const text = String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[_\s-]+/g, '');
  const aliases = { 're:master': 'remaster', remaster: 'remaster', basic: 'basic', advanced: 'advanced', expert: 'expert', master: 'master', utage: 'utage' };
  return aliases[text] || text;
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,、]/) : [];
  return [...new Set(source.map((tag) => {
    if (tag && typeof tag === 'object') return firstValue(tag, ['name', 'label', 'tag', 'title']);
    return tag;
  }).map((tag) => String(tag || '').normalize('NFKC').trim().slice(0, 64)).filter(Boolean))];
}

function inheritedSongFields(song) {
  return {
    songId: firstValue(song, ['songId', 'song_id', 'musicId', 'music_id', 'id']),
    title: firstValue(song, ['title', 'songTitle', 'song_name', 'name'])
  };
}

function normalizeManifestChart(chart, parent = {}) {
  const song = chart?.song && typeof chart.song === 'object' ? chart.song : {};
  return {
    sourceSongId: firstValue(chart, ['songId', 'song_id', 'musicId', 'music_id']) ?? firstValue(song, ['id', 'songId', 'musicId']) ?? parent.songId ?? null,
    title: String(firstValue(chart, ['title', 'songTitle', 'song_name']) ?? firstValue(song, ['title', 'name']) ?? parent.title ?? '').trim(),
    type: normalizeType(firstValue(chart, ['type', 'chartType', 'chart_type', 'mode'])),
    difficulty: normalizeDifficulty(firstValue(chart, ['difficulty', 'difficultyName', 'difficulty_name', 'diff'])),
    tags: normalizeTags(firstValue(chart, ['tags', 'patterns', 'patternTags', 'pattern_tags']))
  };
}

export function flattenManifest(manifest) {
  if (
    Array.isArray(manifest?.charts) &&
    manifest?.songs && typeof manifest.songs === 'object' && !Array.isArray(manifest.songs) &&
    Array.isArray(manifest?.tags)
  ) {
    const tagById = new Map(manifest.tags.map((tag) => [String(tag?.id), String(tag?.name || '').normalize('NFKC').trim()]));
    return manifest.charts.map((chart) => {
      const song = manifest.songs[chart?.song_id] || null;
      const title = String(song?.title || '').trim();
      const artist = String(song?.artist || '').trim();
      return {
        sourceSongId: title ? buildCanonicalSongId(title, artist) : null,
        sourceNativeSongId: chart?.song_id || null,
        title,
        type: normalizeType(song?.type),
        difficulty: normalizeDifficulty(chart?.difficulty),
        tags: [...new Set((Array.isArray(chart?.tags) ? chart.tags : [])
          .map((tagId) => tagById.get(String(tagId)) || '')
          .map((tag) => tag.slice(0, 64))
          .filter(Boolean))]
      };
    }).filter((chart) => chart.tags.length > 0);
  }

  const roots = Array.isArray(manifest) ? manifest : firstValue(manifest, ['songs', 'charts', 'entries', 'data', 'manifest']) || [];
  const output = [];
  for (const item of Array.isArray(roots) ? roots : []) {
    const children = firstValue(item, ['charts', 'sheets', 'difficulties']);
    if (Array.isArray(children)) {
      const parent = inheritedSongFields(item);
      for (const chart of children) output.push(normalizeManifestChart(chart, parent));
    } else output.push(normalizeManifestChart(item));
  }
  return output.filter((chart) => chart.tags.length > 0);
}

function addIndex(map, key, value) {
  const normalized = String(key ?? '').normalize('NFKC').trim().toLowerCase();
  if (!normalized) return;
  const values = map.get(normalized) || [];
  if (!values.includes(value)) values.push(value);
  map.set(normalized, values);
}

function buildCatalogIndex(catalog) {
  const chartsById = new Map();
  const songsByTitle = new Map();
  for (const sourceSong of Array.isArray(catalog?.songs) ? catalog.songs : []) {
    const title = String(sourceSong.title || '').trim();
    if (!title) continue;
    const songId = buildCanonicalSongId(title, sourceSong.artist || '');
    const song = { songId, title, charts: sourceSong.difficultyLevels || [] };
    addIndex(songsByTitle, normalizeSongText(title), song);
    for (const id of [songId, sourceSong.id, sourceSong.sourceSongId, sourceSong.songId, sourceSong.playlistId, sourceSong.linkedOtogeSort]) addIndex(chartsById, id, song);
  }
  return { chartsById, songsByTitle };
}

function findChart(song, source) {
  const matches = (song?.charts || []).filter((chart) =>
    normalizeType(chart.type) === source.type && normalizeDifficulty(chart.difficulty) === source.difficulty
  );
  return matches.length === 1 ? matches[0] : null;
}

export function matchManifest(manifest, catalog) {
  const sourceCharts = flattenManifest(manifest);
  const index = buildCatalogIndex(catalog);
  const matched = new Map();
  const unmatched = [];
  for (const source of sourceCharts) {
    let candidates = [];
    let method = null;
    if (source.sourceSongId != null) {
      candidates = index.chartsById.get(String(source.sourceSongId).normalize('NFKC').trim().toLowerCase()) || [];
      method = 'song-id';
    } else if (source.title) {
      candidates = index.songsByTitle.get(normalizeSongText(source.title)) || [];
      method = 'title';
    }
    if (candidates.length !== 1) {
      unmatched.push({ ...source, reason: candidates.length > 1 ? 'ambiguous-song' : 'song-not-found' });
      continue;
    }
    const chart = findChart(candidates[0], source);
    if (!chart) {
      unmatched.push({ ...source, reason: 'chart-not-found' });
      continue;
    }
    const key = `${candidates[0].songId}:${source.type}:${source.difficulty}`;
    const existing = matched.get(key);
    matched.set(key, {
      songId: candidates[0].songId,
      type: source.type,
      difficulty: source.difficulty,
      tags: [...new Set([...(existing?.tags || []), ...source.tags])].sort(),
      matchedBy: method
    });
  }
  return { sourceCharts, entries: [...matched.values()].sort((a, b) => a.songId.localeCompare(b.songId) || a.type.localeCompare(b.type) || a.difficulty.localeCompare(b.difficulty)), unmatched };
}

async function loadManifest(args, previous, fetchImpl) {
  if (args.sourceFile) return { manifest: JSON.parse(await readFile(args.sourceFile, 'utf8')), etag: null, notModified: false, source: args.sourceFile };
  const headers = { accept: 'application/json', 'user-agent': 'MaiDeck chart-tag importer/1.0' };
  if (previous?.sourceEtag && Array.isArray(previous?.entries) && previous.entries.length > 0) {
    headers['if-none-match'] = previous.sourceEtag;
  }
  const response = await fetchImpl(args.sourceUrl, { headers });
  if (response.status === 304) return { manifest: null, etag: previous?.sourceEtag || null, notModified: true, source: args.sourceUrl };
  if (!response.ok) throw new Error(`mai-notes manifest returned HTTP ${response.status}.`);
  return { manifest: await response.json(), etag: response.headers.get('etag'), notModified: false, source: args.sourceUrl };
}

export async function runImport(args, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const previous = await readOptionalJson(args.outputFile);
  const loaded = await loadManifest(args, previous, fetchImpl);
  if (loaded.notModified) return { status: 'not-modified', outputFile: args.outputFile, keptEntries: previous?.entries?.length || 0 };
  const catalog = JSON.parse(await readFile(args.catalogFile, 'utf8'));
  const result = matchManifest(loaded.manifest, catalog);
  const generatedAt = now().toISOString();
  const output = {
    version: 1,
    generatedAt,
    source: loaded.source,
    sourceEtag: loaded.etag,
    entries: result.entries.map(({ matchedBy: _matchedBy, ...entry }) => entry)
  };
  const report = {
    generatedAt,
    source: loaded.source,
    sourceTaggedCharts: result.sourceCharts.length,
    mappedCharts: result.entries.length,
    mappedBySongId: result.entries.filter((entry) => entry.matchedBy === 'song-id').length,
    mappedByTitle: result.entries.filter((entry) => entry.matchedBy === 'title').length,
    unmatchedCharts: result.unmatched.length,
    unmatched: result.unmatched
  };
  const previousCount = Array.isArray(previous?.entries) ? previous.entries.length : 0;
  if (previousCount > 0 && result.entries.length < Math.ceil(previousCount * 0.5)) {
    throw new Error(`Refusing to overwrite ${args.outputFile}: mapped charts fell from ${previousCount} to ${result.entries.length}.`);
  }
  if (!args.dryRun) {
    await writeJsonAtomic(args.outputFile, output);
    await writeJsonAtomic(args.reportFile, report);
  }
  return { status: args.dryRun ? 'dry-run' : 'written', outputFile: args.outputFile, reportFile: args.reportFile, ...report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = await runImport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.status === 'not-modified') console.log(`Chart tags unchanged (HTTP 304); kept ${result.keptEntries} mapped charts.`);
  else console.log(`${result.status === 'dry-run' ? 'Would map' : 'Mapped'} ${result.mappedCharts}/${result.sourceTaggedCharts} tagged charts. Unmatched: ${result.unmatchedCharts}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
