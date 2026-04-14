import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_PLAYLIST_ID_MAP_FILE = './data/reference/playlist-id-map.json';
const SEARCH_CACHE_LIMIT = 200;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFavoriteId(value) {
  const id = String(value || '').trim();
  if (!/^\d{1,8}$/.test(id)) {
    return null;
  }
  return id;
}

function buildCanonicalSongId(title, artist) {
  const digest = createHash('sha1')
    .update(`${normalizeText(title)}::${normalizeText(artist)}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `song:${digest}`;
}

function resolveStableFavoriteId(sourceSong) {
  const linkedOtogeSort = normalizeFavoriteId(sourceSong.playlistId || sourceSong.linkedOtogeSort);
  if (linkedOtogeSort) {
    return linkedOtogeSort;
  }

  const sourceId = normalizeFavoriteId(sourceSong.sourceSongId);
  if (sourceId && String(sourceSong.id || '').startsWith('otoge:')) {
    return sourceId;
  }

  return null;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function scoreSong(song, query) {
  if (!query) {
    return 1;
  }

  let score = 0;

  if (song.songId === query) {
    score += 3000;
  }
  if (song.favoriteId === query) {
    score += 2000;
  }
  if (song.normTitle === query) {
    score += 1200;
  }
  if (song.normArtist === query) {
    score += 900;
  }
  if (song.normTitle.startsWith(query)) {
    score += 700;
  }
  if (song.normArtist.startsWith(query)) {
    score += 500;
  }
  if (song.searchBlob.includes(query)) {
    score += 250;
  }

  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => song.searchBlob.includes(token))) {
    score += 300;
  }

  return score;
}

function buildSongLabel(song) {
  const prefix = `[${song.favoriteId}]`;
  const body = `${song.title} - ${song.artist}`;
  return truncate(`${prefix} ${body}`, 100);
}

function insertRankedResult(results, candidate, limit) {
  let inserted = false;

  for (let index = 0; index < results.length; index += 1) {
    const existing = results[index];
    if (
      candidate.score > existing.score ||
      (candidate.score === existing.score &&
        candidate.song.title.localeCompare(existing.song.title) < 0)
    ) {
      results.splice(index, 0, candidate);
      inserted = true;
      break;
    }
  }

  if (!inserted) {
    results.push(candidate);
  }

  if (results.length > limit) {
    results.length = limit;
  }
}

export class SongCatalog {
  constructor(filePath) {
    this.filePath = filePath;
    this.playlistIdMapFile = DEFAULT_PLAYLIST_ID_MAP_FILE;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.songs = [];
    this.bySongId = new Map();
    this.byFavoriteId = new Map();
    this.byLegacyFavoriteId = new Map();
    this.byNormTitle = new Map();
    this.byNormTitleArtist = new Map();
    this.searchCache = new Map();
  }

  async ensureReady() {
    if (!this.loaded) {
      await this.load();
    }
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const sourceSongs = Array.isArray(parsed?.songs) ? parsed.songs : [];
      let playlistIdMap = new Map();

      try {
        const playlistMapRaw = await readFile(this.playlistIdMapFile, 'utf8');
        const playlistMapParsed = JSON.parse(playlistMapRaw);
        const entries =
          playlistMapParsed && typeof playlistMapParsed === 'object' && playlistMapParsed.entries && typeof playlistMapParsed.entries === 'object'
            ? playlistMapParsed.entries
            : {};
        playlistIdMap = new Map(Object.entries(entries));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      const bySongId = new Map();
      const byFavoriteId = new Map();
      const byLegacyFavoriteId = new Map();
      const byNormTitle = new Map();
      const byNormTitleArtist = new Map();

      for (const sourceSong of sourceSongs) {
        const playlistKey = `${normalizeText(sourceSong.title)}::${normalizeText(sourceSong.artist)}`;
        const legacyFavoriteId = normalizeFavoriteId(playlistIdMap.get(playlistKey));
        const favoriteId = resolveStableFavoriteId(sourceSong);
        if (!favoriteId) {
          continue;
        }

        const title = String(sourceSong.title || '').trim();
        const artist = String(sourceSong.artist || '').trim();
        if (!title) {
          continue;
        }

        const song = {
          songId: buildCanonicalSongId(title, artist),
          favoriteId,
          legacyFavoriteId: legacyFavoriteId && legacyFavoriteId !== favoriteId ? legacyFavoriteId : null,
          title,
          artist: artist || 'Unknown',
          bpm: sourceSong.bpm ?? null,
          category: sourceSong.category ?? null,
          jacket: {
            dxratingFile: sourceSong.jacket?.dxratingFile || null,
            otogeFile: sourceSong.jacket?.otogeFile || null
          },
          difficultyLevels: Array.isArray(sourceSong.difficultyLevels)
            ? sourceSong.difficultyLevels
            : [],
          normTitle: normalizeText(title),
          normArtist: normalizeText(artist),
          searchBlob: normalizeText(`${favoriteId} ${legacyFavoriteId || ''} ${title} ${artist}`)
        };

        const existing = bySongId.get(song.songId);
        if (!existing || song.difficultyLevels.length > existing.difficultyLevels.length) {
          if (existing) {
            byFavoriteId.delete(existing.favoriteId);
            if (existing.legacyFavoriteId) {
              byLegacyFavoriteId.delete(existing.legacyFavoriteId);
            }
          }
          bySongId.set(song.songId, song);
          byFavoriteId.set(favoriteId, song);
          if (song.legacyFavoriteId) {
            byLegacyFavoriteId.set(song.legacyFavoriteId, song);
          }
        }
      }

      this.songs = [...bySongId.values()].sort((a, b) => a.title.localeCompare(b.title));

      for (const song of this.songs) {
        const titleMatches = byNormTitle.get(song.normTitle) || [];
        titleMatches.push(song);
        byNormTitle.set(song.normTitle, titleMatches);

        byNormTitleArtist.set(`${song.normTitle}::${song.normArtist}`, song);
      }

      this.bySongId = bySongId;
      this.byFavoriteId = byFavoriteId;
      this.byLegacyFavoriteId = byLegacyFavoriteId;
      this.byNormTitle = byNormTitle;
      this.byNormTitleArtist = byNormTitleArtist;
      this.searchCache = new Map();
      this.available = true;
      this.error = null;
    } catch (error) {
      this.available = false;
      this.error = error;
      this.bySongId = new Map();
      this.byFavoriteId = new Map();
      this.byLegacyFavoriteId = new Map();
      this.byNormTitle = new Map();
      this.byNormTitleArtist = new Map();
      this.searchCache = new Map();
      this.songs = [];
    } finally {
      this.loaded = true;
    }
  }

  requireAvailable() {
    if (!this.available) {
      throw new Error(
        `Song catalog is unavailable. Run \`npm run import:data\` and check ${this.filePath}.`
      );
    }
  }

  get count() {
    return this.songs.length;
  }

  getByFavoriteId(favoriteId) {
    const normalized = normalizeFavoriteId(favoriteId);
    if (!normalized) {
      return null;
    }
    return this.byFavoriteId.get(normalized) || null;
  }

  getByLegacyFavoriteId(favoriteId) {
    const normalized = normalizeFavoriteId(favoriteId);
    if (!normalized) {
      return null;
    }
    return this.byLegacyFavoriteId.get(normalized) || null;
  }

  getBySongId(songId) {
    const normalized = String(songId || '').trim();
    if (!/^song:[a-f0-9]{16}$/.test(normalized)) {
      return null;
    }
    return this.bySongId.get(normalized) || null;
  }

  getByStoredId(songId) {
    return this.getBySongId(songId) || this.getByFavoriteId(songId) || this.getByLegacyFavoriteId(songId);
  }

  getByNormalizedTitle(normalizedTitle) {
    const key = normalizeText(normalizedTitle);
    return this.byNormTitle.get(key) || [];
  }

  getUniqueByNormalizedTitle(normalizedTitle) {
    const matches = this.getByNormalizedTitle(normalizedTitle);
    return matches.length === 1 ? matches[0] : null;
  }

  getByNormalizedTitleArtist(normalizedTitle, normalizedArtist) {
    const title = normalizeText(normalizedTitle);
    const artist = normalizeText(normalizedArtist);
    if (!title || !artist) {
      return null;
    }
    return this.byNormTitleArtist.get(`${title}::${artist}`) || null;
  }

  search(query, limit = 10) {
    this.requireAvailable();
    const normalized = normalizeText(query);
    const safeLimit = Math.max(1, Number(limit) || 10);

    if (!normalized) {
      return this.songs.slice(0, safeLimit);
    }

    const cacheKey = `${normalized}::${safeLimit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const direct = this.getByStoredId(normalized);
    if (direct) {
      const directResults = [direct];
      this.searchCache.set(cacheKey, directResults);
      return directResults;
    }

    const ranked = [];
    for (const song of this.songs) {
      const score = scoreSong(song, normalized);
      if (score <= 0) {
        continue;
      }

      if (ranked.length < safeLimit) {
        insertRankedResult(ranked, { song, score }, safeLimit);
        continue;
      }

      const weakest = ranked[ranked.length - 1];
      if (
        score > weakest.score ||
        (score === weakest.score && song.title.localeCompare(weakest.song.title) < 0)
      ) {
        insertRankedResult(ranked, { song, score }, safeLimit);
      }
    }

    const results = ranked.map((item) => item.song);
    this.searchCache.set(cacheKey, results);
    if (this.searchCache.size > SEARCH_CACHE_LIMIT) {
      const oldestKey = this.searchCache.keys().next().value;
      this.searchCache.delete(oldestKey);
    }
    return results;
  }

  resolveSong(query) {
    this.requireAvailable();
    const direct = this.getByStoredId(query);
    if (direct) {
      return direct;
    }

    const results = this.search(query, 1);
    return results[0] || null;
  }

  autocomplete(query, limit = 25) {
    this.requireAvailable();
    return this.search(query, limit).map((song) => ({
      name: buildSongLabel(song),
      value: song.songId
    }));
  }
}
