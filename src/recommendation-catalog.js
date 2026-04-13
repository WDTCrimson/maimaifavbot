import { readFile } from 'node:fs/promises';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseInternalConstant(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => normalizeText(tag)).filter(Boolean))];
}

function normalizeSources(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (entry && typeof entry === 'object') {
        return String(entry.label || entry.name || entry.url || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function uniqueExactTitleSong(songCatalog, normalizedTitle) {
  const matches = songCatalog.songs.filter((song) => song.normTitle === normalizedTitle);
  return matches.length === 1 ? matches[0] : null;
}

function resolveRecommendedSong(songCatalog, rawEntry) {
  if (rawEntry.songId) {
    return songCatalog.getByFavoriteId(rawEntry.songId);
  }

  const normalizedTitle = normalizeText(rawEntry.title);
  const normalizedArtist = normalizeText(rawEntry.artist);

  if (normalizedTitle && normalizedArtist) {
    const exact = songCatalog.songs.find(
      (song) => song.normTitle === normalizedTitle && song.normArtist === normalizedArtist
    );
    if (exact) {
      return exact;
    }
  }

  if (normalizedTitle) {
    const exactTitle = uniqueExactTitleSong(songCatalog, normalizedTitle);
    if (exactTitle) {
      return exactTitle;
    }

    return songCatalog.resolveSong(rawEntry.title);
  }

  if (rawEntry.query) {
    return songCatalog.resolveSong(rawEntry.query);
  }

  return null;
}

function findMatchingCharts(song, minConstant, maxConstant) {
  const matches = [];

  for (const chart of Array.isArray(song.difficultyLevels) ? song.difficultyLevels : []) {
    const constant = parseInternalConstant(chart.internalLevelValue);
    if (constant == null) {
      continue;
    }
    if (constant < minConstant || constant > maxConstant) {
      continue;
    }

    matches.push({
      difficulty: String(chart.difficulty || '').toLowerCase(),
      type: String(chart.type || '').toLowerCase(),
      level: String(chart.level || '').trim() || '?',
      constant,
      version: String(chart.version || '').trim() || 'Unknown'
    });
  }

  matches.sort((a, b) => a.constant - b.constant);
  return matches;
}

function midpoint(minConstant, maxConstant) {
  return (minConstant + maxConstant) / 2;
}

export class RecommendationCatalog {
  constructor(filePath, songCatalog) {
    this.filePath = filePath;
    this.songCatalog = songCatalog;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.entries = [];
    this.unresolvedEntries = [];
  }

  async ensureReady() {
    if (!this.loaded) {
      await this.load();
    }
  }

  async load() {
    this.loaded = true;

    if (!this.songCatalog.available) {
      this.available = false;
      this.error = new Error('Song catalog must be available before loading recommendations.');
      return;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const sourceEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const resolvedEntries = [];
      const unresolvedEntries = [];

      for (const rawEntry of sourceEntries) {
        if (!rawEntry || typeof rawEntry !== 'object') {
          continue;
        }

        const song = resolveRecommendedSong(this.songCatalog, rawEntry);
        if (!song) {
          unresolvedEntries.push({
            songId: rawEntry.songId || null,
            title: rawEntry.title || rawEntry.query || 'Unknown'
          });
          continue;
        }

        const note = String(rawEntry.note || rawEntry.reason || '').trim();
        const tags = normalizeTags(rawEntry.tags);
        const sources = normalizeSources(rawEntry.sources);
        const weight = Number.isFinite(Number(rawEntry.weight)) ? Number(rawEntry.weight) : 1;

        resolvedEntries.push({
          songId: song.favoriteId,
          song,
          note,
          tags,
          sources,
          weight
        });
      }

      this.entries = resolvedEntries;
      this.unresolvedEntries = unresolvedEntries;
      this.available = true;
      this.error = null;
    } catch (error) {
      this.entries = [];
      this.unresolvedEntries = [];
      this.available = false;
      this.error = error;
    }
  }

  requireAvailable() {
    if (!this.available) {
      throw new Error(
        `Recommendation dataset is unavailable. Generate ${this.filePath} with \`npm run import:recommendations\` first.`
      );
    }
  }

  suggest({ minConstant, maxConstant, focus, limit = 5 }) {
    this.requireAvailable();

    const normalizedFocus = normalizeText(focus);
    const targetMidpoint = midpoint(minConstant, maxConstant);

    const ranked = [];

    for (const entry of this.entries) {
      if (normalizedFocus && !entry.tags.includes(normalizedFocus)) {
        continue;
      }

      const matchingCharts = findMatchingCharts(entry.song, minConstant, maxConstant);
      if (!matchingCharts.length) {
        continue;
      }

      const closestDistance = Math.min(
        ...matchingCharts.map((chart) => Math.abs(chart.constant - targetMidpoint))
      );

      const score = entry.weight * 100 - closestDistance * 10 + matchingCharts.length;

      ranked.push({
        ...entry,
        matchingCharts,
        score
      });
    }

    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.song.title.localeCompare(b.song.title);
    });

    return ranked.slice(0, limit);
  }
}
