import 'dotenv/config';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { canonicalChartKey, validateCatalogV2 } from '../src/recommendation-schema.js';
import { SongCatalog } from '../src/song-catalog.js';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

const sourceFile = resolve(argument('--source', './data/recommendations/community.example.json'));
const mappingFile = resolve(argument('--mappings', './data/recommendations/chart-mappings.json'));
const outputFile = resolve(argument('--output', './data/recommendations/community.json'));
const reportFile = resolve(argument('--report', './data/recommendations/migration-report.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
let mappings = {};
try { mappings = JSON.parse(await readFile(mappingFile, 'utf8')).mappings || {}; } catch (error) { if (error.code !== 'ENOENT') throw error; }

const songCatalog = new SongCatalog(config.songCatalogFile);
songCatalog.aliasFile = config.songAliasFile;
await songCatalog.ensureReady();
songCatalog.requireAvailable();

const now = new Date().toISOString();
const entries = [];
const needsChartMapping = [];
const unresolved = [];
for (let index = 0; index < (source.entries || []).length; index += 1) {
  const legacy = source.entries[index];
  const song = legacy.songId ? songCatalog.getByStoredId(legacy.songId) : songCatalog.getUniqueByNormalizedTitle(legacy.title);
  if (!song) { unresolved.push({ index, title: legacy.title || null, reason: 'song_not_unique' }); continue; }
  const mappingKey = legacy.songId || legacy.title || String(index);
  const charts = mappings[mappingKey];
  if (!Array.isArray(charts) || !charts.length) {
    needsChartMapping.push({ index, songId: song.songId, title: song.title, reason: 'needs_chart_mapping' });
    continue;
  }
  for (const chart of charts) {
    const type = String(chart.type || '').toLowerCase();
    const difficulty = String(chart.difficulty || '').toLowerCase();
    const key = canonicalChartKey(song.songId, type, difficulty);
    entries.push({
      key, songId: song.songId, chart: { type, difficulty },
      summary: String(legacy.note || legacy.reason || 'Manually migrated community recommendation.').slice(0, 180),
      tags: [...new Set(legacy.tags || [])], evidenceWeight: Math.max(0, Math.min(1, Number(legacy.weight) || 1)),
      manualWeightOverride: Math.max(0, Math.min(1, Number(legacy.weight) || 1)), firstSeenAt: now, lastSeenAt: now,
      evidence: [{ source: 'manual', sourceId: `manual:migration-${index}`, candidateId: null, threadId: null, url: null, createdAt: null, observedScore: null, status: 'active', lastCheckedAt: now }]
    });
  }
}
const catalog = validateCatalogV2({ schemaVersion: 2, generatedAt: now, entries });
await atomicWrite(outputFile, catalog);
await atomicWrite(reportFile, { schemaVersion: 1, generatedAt: now, migrated: entries.length, needsChartMapping, unresolved });
console.log(`Migrated ${entries.length} chart entries; ${needsChartMapping.length} need explicit chart mappings; ${unresolved.length} unresolved.`);
