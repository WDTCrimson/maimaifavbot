import { readFile } from 'node:fs/promises';

const DEFAULT_PLAYLIST_ID_MAP_FILE = './data/reference/playlist-id-map.json';

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

export class SongCatalog {
  constructor(filePath) {
    this.filePath = filePath;
    this.playlistIdMapFile = DEFAULT_PLAYLIST_ID_MAP_FILE;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.songs = [];
    this.byFavoriteId = new Map();
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

      const byId = new Map();

      for (const sourceSong of sourceSongs) {
        const playlistKey = `${normalizeText(sourceSong.title)}::${normalizeText(sourceSong.artist)}`;
        const frozenPlaylistId = normalizeFavoriteId(playlistIdMap.get(playlistKey));
        const favoriteId = frozenPlaylistId || resolveStableFavoriteId(sourceSong);
        if (!favoriteId) {
          continue;
        }

        const title = String(sourceSong.title || '').trim();
        const artist = String(sourceSong.artist || '').trim();
        if (!title) {
          continue;
        }

        const song = {
          favoriteId,
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
          searchBlob: normalizeText(`${favoriteId} ${title} ${artist}`)
        };

        const existing = byId.get(favoriteId);
        if (!existing || song.difficultyLevels.length > existing.difficultyLevels.length) {
          byId.set(favoriteId, song);
        }
      }

      this.byFavoriteId = byId;
      this.songs = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
      this.available = true;
      this.error = null;
    } catch (error) {
      this.available = false;
      this.error = error;
      this.byFavoriteId = new Map();
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

  search(query, limit = 10) {
    this.requireAvailable();
    const normalized = normalizeText(query);

    const ranked = this.songs
      .map((song) => ({ song, score: scoreSong(song, normalized) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.song.title.localeCompare(b.song.title);
      })
      .slice(0, limit)
      .map((item) => item.song);

    return ranked;
  }

  resolveSong(query) {
    this.requireAvailable();
    const direct = this.getByFavoriteId(query);
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
      value: song.favoriteId
    }));
  }
}
