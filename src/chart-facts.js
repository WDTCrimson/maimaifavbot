import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalChartKey } from './recommendation-schema.js';
import { foldLatin, romajiVariants } from './romaji.js';

const DEFAULT_TAGS_FILE = './data/reference/chart-tags.json';
const DEFAULT_LABELS_FILE = './data/reference/pattern-labels.json';
const DEFAULT_REPORT_FILE = './data/reference/chart-tags-report.json';

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function hashInputs(values) {
  const hash = createHash('sha256');
  for (const value of values) hash.update(value || '').update('\0');
  return hash.digest('hex');
}

function normalizePart(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/^re:master$/, 'remaster');
}

function cleanTag(value) {
  return String(value || '').normalize('NFKC').trim().slice(0, 64);
}

function chartKey(songId, chart) {
  return canonicalChartKey(songId, normalizePart(chart?.type), normalizePart(chart?.difficulty));
}

function normalizeLabels(parsed) {
  const source = parsed?.labels && typeof parsed.labels === 'object' ? parsed.labels : parsed;
  const labels = new Map();
  if (!source || typeof source !== 'object' || Array.isArray(source)) return labels;
  for (const [rawTag, rawValue] of Object.entries(source)) {
    const tag = cleanTag(rawTag);
    if (!tag) continue;
    const value = typeof rawValue === 'string' ? { en: rawValue } : rawValue;
    labels.set(tag, {
      en: cleanTag(value?.en) || tag,
      group: cleanTag(value?.group) || 'other'
    });
  }
  return labels;
}

export function formatPatternLabel(tag, labels = new Map()) {
  const clean = cleanTag(tag);
  const english = labels.get(clean)?.en || clean;
  return english === clean ? clean : `${english} (${clean})`;
}

export class ChartFacts {
  constructor({ tagsFile = DEFAULT_TAGS_FILE, labelsFile = DEFAULT_LABELS_FILE, reportFile = DEFAULT_REPORT_FILE } = {}) {
    this.tagsFile = tagsFile;
    this.labelsFile = labelsFile;
    this.reportFile = reportFile;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.generatedAt = null;
    this.contentHash = null;
    this.byChartKey = new Map();
    this.byTag = new Map();
    this.labels = new Map();
  }

  async ensureReady() {
    if (!this.loaded) await this.load();
  }

  async load() {
    const [tagsRaw, labelsRaw, reportRaw] = await Promise.all([
      readOptional(this.tagsFile),
      readOptional(this.labelsFile),
      readOptional(this.reportFile)
    ]);
    try {
      const labels = normalizeLabels(labelsRaw ? JSON.parse(labelsRaw) : {});
      const report = reportRaw ? JSON.parse(reportRaw) : null;
      const byChartKey = new Map();
      const byTag = new Map();
      if (tagsRaw) {
        const parsed = JSON.parse(tagsRaw);
        for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
          const songId = String(entry.songId || '').trim();
          const type = normalizePart(entry.type);
          const difficulty = normalizePart(entry.difficulty);
          if (!songId || !type || !difficulty) continue;
          const key = canonicalChartKey(songId, type, difficulty);
          const tags = [...new Set((Array.isArray(entry.tags) ? entry.tags : []).map(cleanTag).filter(Boolean))];
          const normalized = { songId, type, difficulty, tags };
          byChartKey.set(key, normalized);
          for (const tag of tags) {
            const entries = byTag.get(tag) || [];
            entries.push(normalized);
            byTag.set(tag, entries);
          }
        }
        this.generatedAt = parsed.generatedAt || report?.generatedAt || null;
      } else {
        this.generatedAt = report?.generatedAt || null;
      }
      this.labels = labels;
      this.byChartKey = byChartKey;
      this.byTag = byTag;
      this.available = Boolean(tagsRaw);
      this.error = null;
      this.contentHash = hashInputs([tagsRaw, labelsRaw, reportRaw]);
    } catch (error) {
      this.available = false;
      this.error = error;
      this.byChartKey = new Map();
      this.byTag = new Map();
      this.labels = new Map();
      this.contentHash = hashInputs([tagsRaw, labelsRaw, reportRaw]);
    } finally {
      this.loaded = true;
    }
  }

  async reloadIfChanged() {
    const raws = await Promise.all([readOptional(this.tagsFile), readOptional(this.labelsFile), readOptional(this.reportFile)]);
    const nextHash = hashInputs(raws);
    if (nextHash === this.contentHash) return { changed: false, reloaded: false, hash: nextHash };
    const previous = this.available ? {
      available: this.available,
      generatedAt: this.generatedAt,
      contentHash: this.contentHash,
      byChartKey: this.byChartKey,
      byTag: this.byTag,
      labels: this.labels
    } : null;
    await this.load();
    if (this.error && previous) {
      const error = this.error;
      Object.assign(this, previous, { error, loaded: true });
      return { changed: true, reloaded: false, hash: this.contentHash, error };
    }
    return { changed: true, reloaded: !this.error, hash: this.contentHash, error: this.error };
  }

  tagsFor(songOrEntry, maybeChart = null) {
    const songId = maybeChart ? songOrEntry?.songId : songOrEntry?.songId;
    const chart = maybeChart || songOrEntry?.chart || songOrEntry;
    if (!songId || !chart) return [];
    return [...(this.byChartKey.get(chartKey(songId, chart))?.tags || [])];
  }

  labelFor(tag) {
    return formatPatternLabel(tag, this.labels);
  }

  autocomplete(query, limit = 25) {
    const needle = foldLatin(query);
    const ranked = [];
    for (const tag of this.byTag.keys()) {
      const english = this.labels.get(tag)?.en || tag;
      const variants = [tag, english, foldLatin(tag), foldLatin(english), ...romajiVariants(tag)]
        .map((value) => String(value || '').normalize('NFKC').toLowerCase())
        .filter(Boolean);
      const foldedVariants = [...variants, ...variants.map(foldLatin)].filter(Boolean);
      const exactPrefix = !needle || foldedVariants.some((value) => value.startsWith(needle));
      const contains = !needle || foldedVariants.some((value) => value.includes(needle));
      if (!contains) continue;
      ranked.push({ tag, name: formatPatternLabel(tag, this.labels), rank: exactPrefix ? 0 : 1 });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    return ranked.slice(0, Math.max(1, Math.min(25, Number(limit) || 25))).map(({ tag, name }) => ({ name: name.slice(0, 100), value: tag }));
  }

  chartsWithTag(tag, { songCatalog, level = null, difficulty = null } = {}) {
    if (!songCatalog) return [];
    const wantedLevel = normalizePart(level);
    const wantedDifficulty = normalizePart(difficulty);
    const results = [];
    for (const entry of this.byTag.get(cleanTag(tag)) || []) {
      const song = songCatalog.getBySongId(entry.songId);
      const chart = song?.difficultyLevels?.find((candidate) =>
        normalizePart(candidate.type) === entry.type && normalizePart(candidate.difficulty) === entry.difficulty
      );
      if (!song || !chart) continue;
      if (wantedDifficulty && normalizePart(chart.difficulty) !== wantedDifficulty) continue;
      const constant = Number(chart.internalLevelValue);
      const levelMatches = !wantedLevel || normalizePart(chart.level) === wantedLevel || (Number.isFinite(constant) && constant.toFixed(1) === wantedLevel);
      if (!levelMatches) continue;
      results.push({ songId: song.songId, song, chart, tags: [...entry.tags] });
    }
    return results.sort((a, b) => Number(a.chart.internalLevelValue) - Number(b.chart.internalLevelValue) || a.song.title.localeCompare(b.song.title));
  }

  unavailableMessage() {
    const date = this.generatedAt ? String(this.generatedAt).slice(0, 10) : 'never';
    return `Pattern data is unavailable right now (last import: ${date}). It refreshes daily.`;
  }
}
