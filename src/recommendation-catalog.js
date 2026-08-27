import { readFile } from 'node:fs/promises';
import { canonicalChartKey, sha256, validateCatalogV2 } from './recommendation-schema.js';

function resolveEntry(entry, songCatalog) {
  const song = songCatalog.getBySongId(entry.songId);
  if (!song) throw new Error(`Recommendation ${entry.key} references an unknown song.`);
  const resolvedChart = (song.difficultyLevels || []).find((chart) =>
    String(chart.type || '').toLowerCase() === entry.chart.type &&
    String(chart.difficulty || '').toLowerCase().replace(/^re:master$/, 'remaster') === entry.chart.difficulty
  );
  if (!resolvedChart) throw new Error(`Recommendation ${entry.key} references an unknown chart.`);
  const constant = Number(resolvedChart.internalLevelValue);
  if (!Number.isFinite(constant)) throw new Error(`Recommendation ${entry.key} chart has no internal constant.`);
  return Object.freeze({ ...entry, song, resolvedChart, constant });
}

export class RecommendationCatalog {
  constructor(filePath, songCatalog) {
    this.filePath = filePath;
    this.songCatalog = songCatalog;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.entries = Object.freeze([]);
    this.unresolvedEntries = Object.freeze([]);
    this.contentHash = null;
    this.generatedAt = null;
    this.byChartKey = new Map();
  }

  async ensureReady() {
    if (!this.loaded) await this.load();
  }

  async load() {
    this.loaded = true;
    if (!this.songCatalog.available) {
      this.error = new Error('Song catalog must be available before loading recommendations.');
      this.available = false;
      return false;
    }
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return this.#install(raw);
    } catch (error) {
      this.error = error;
      if (!this.available) {
        this.entries = Object.freeze([]);
        this.byChartKey = new Map();
      }
      return false;
    }
  }

  async reloadIfChanged() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const nextHash = sha256(raw);
      if (nextHash === this.contentHash) return { changed: false, reloaded: false, hash: nextHash };
      const reloaded = this.#install(raw, nextHash);
      return { changed: true, reloaded, hash: this.contentHash, error: reloaded ? null : this.error };
    } catch (error) {
      this.error = error;
      return { changed: false, reloaded: false, hash: this.contentHash, error };
    }
  }

  #install(raw, knownHash = null) {
    try {
      const parsed = JSON.parse(raw);
      const validated = validateCatalogV2(parsed);
      const resolved = validated.entries.map((entry) => resolveEntry(entry, this.songCatalog));
      const byChartKey = new Map(resolved.map((entry) => [entry.key, entry]));
      this.entries = Object.freeze(resolved);
      this.byChartKey = byChartKey;
      this.unresolvedEntries = Object.freeze([]);
      this.contentHash = knownHash || sha256(raw);
      this.generatedAt = validated.generatedAt;
      this.available = true;
      this.error = null;
      return true;
    } catch (error) {
      this.error = error;
      return false;
    }
  }

  requireAvailable() {
    if (!this.available) throw new Error(`Recommendation dataset is unavailable or invalid at ${this.filePath}.`);
  }

  getByChartKey(key) {
    return this.byChartKey.get(String(key || '')) || null;
  }

  get(songId, type, difficulty) {
    return this.getByChartKey(canonicalChartKey(songId, type, difficulty));
  }
}
