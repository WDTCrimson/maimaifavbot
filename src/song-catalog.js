import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_PLAYLIST_ID_MAP_FILE = './data/reference/playlist-id-map.json';
const DEFAULT_SONG_ALIAS_FILE = './data/reference/song-aliases.json';
const SEARCH_CACHE_LIMIT = 200;

async function readOptionalUtf8(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function hashCatalogInputs(catalogRaw, aliasRaw) {
  return createHash('sha256')
    .update(catalogRaw, 'utf8')
    .update('\0', 'utf8')
    .update(aliasRaw || '', 'utf8')
    .digest('hex');
}

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

function stripNonAlphanumeric(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function hasCjkOrKana(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function hasHangul(value) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(String(value || ''));
}

function hasNonAscii(value) {
  return /[^\x00-\x7f]/.test(String(value || ''));
}

function isAsciiLatinTitle(value) {
  const text = String(value || '').trim();
  return /[a-z]/i.test(text) && !hasCjkOrKana(text) && !hasHangul(text) && !hasNonAscii(text);
}

function looksLikeLatinAlias(alias, song) {
  const text = String(alias || '').trim();
  if (!text) {
    return false;
  }

  if (!/[a-z]/i.test(text)) {
    return false;
  }

  if (hasCjkOrKana(text) || hasHangul(text)) {
    return false;
  }

  if (/^\[[^\]]+\]/.test(text)) {
    return false;
  }

  const normalizedAlias = normalizeText(text);
  if (!normalizedAlias || normalizedAlias === song.normTitle) {
    return false;
  }

  if (stripNonAlphanumeric(text) === stripNonAlphanumeric(song.title)) {
    return false;
  }

  return true;
}

function scoreDisplayAlias(alias) {
  const text = String(alias || '').trim();
  let score = 0;
  const vowelCount = (text.match(/[aeiou]/gi) || []).length;
  const titleishLength = text.replace(/[^a-z]/gi, '').length;

  if (/[A-Z][a-z]/.test(text)) {
    score += 80;
  }
  if (/\s/.test(text)) {
    score += 60;
  }
  if (/^[a-z][a-z0-9\s'!&+./:-]*$/i.test(text)) {
    score += 40;
  }
  if (/^[a-z0-9\s'!&+./:-]+$/i.test(text)) {
    score += 30;
  }
  if (/^[A-Z0-9]+$/.test(text) && !/\s/.test(text)) {
    score -= 30;
  }
  if (/^(.)\1{3,}$/i.test(text)) {
    score -= 250;
  }
  if (/\d/.test(text)) {
    score -= 60;
  }
  if (/[^a-z0-9\s'!&+./:-]/i.test(text)) {
    score -= 120;
  }
  if (titleishLength > 0 && vowelCount > 0 && vowelCount < titleishLength) {
    score += 25;
  }
  if (text.length >= 5) {
    score += 20;
  } else {
    score -= 20;
  }

  return score;
}

function isLikelyRomajiAlias(alias) {
  const text = String(alias || '').trim();
  if (!/^[a-z][a-z' -]*$/i.test(text)) {
    return false;
  }

  if (/\s/.test(text)) {
    return false;
  }

  const lower = text.toLowerCase();
  if (lower.length < 5) {
    return false;
  }

  if (/[0-9]/.test(lower)) {
    return false;
  }

  if (
    /(tsu|shi|chi|kyo|kyu|kya|ryo|ryu|rya|sho|shu|sha|nyo|nyu|nya|myo|myu|mya|hyo|hyu|hya|gyo|gyu|gya|pyo|pyu|pya|byo|byu|bya|ja|ju|jo|fu|pp|tt|kk|ss|nn)/.test(lower)
  ) {
    return true;
  }

  const vowelCount = (lower.match(/[aeiou]/g) || []).length;
  const consonantCount = (lower.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
  if (!vowelCount || !consonantCount) {
    return false;
  }

  if (lower.endsWith('te') || lower.endsWith('to') || lower.endsWith('na') || lower.endsWith('ne') || lower.endsWith('ka') || lower.endsWith('ki') || lower.endsWith('ru')) {
    return true;
  }

  return vowelCount >= Math.ceil(lower.length * 0.35);
}

function formatEnglishDisplayAlias(alias) {
  const text = String(alias || '').trim();
  if (!text) {
    return null;
  }

  if (text === text.toLowerCase()) {
    return text.replace(/\b([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  return text;
}

function formatRomajiDisplayAlias(alias) {
  const text = String(alias || '').trim();
  if (!text) {
    return null;
  }

  if (text === text.toLowerCase()) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  return text;
}

function pickDisplayAliases(song) {
  if (!Array.isArray(song.aliases) || !song.aliases.length || isAsciiLatinTitle(song.title)) {
    return [];
  }

  const strippedTitle = stripNonAlphanumeric(song.title);
  let bestEnglishAlias = null;
  let bestEnglishScore = Number.NEGATIVE_INFINITY;
  let bestRomajiAlias = null;
  let bestRomajiScore = Number.NEGATIVE_INFINITY;

  for (const alias of song.aliases) {
    if (!looksLikeLatinAlias(alias, song)) {
      continue;
    }

    const strippedAlias = stripNonAlphanumeric(alias);
    if (strippedTitle && strippedAlias && strippedTitle.includes(strippedAlias)) {
      continue;
    }

    const score = scoreDisplayAlias(alias);
    if (isLikelyRomajiAlias(alias)) {
      if (
        score > bestRomajiScore ||
        (score === bestRomajiScore && String(alias).length < String(bestRomajiAlias || '').length)
      ) {
        bestRomajiAlias = alias;
        bestRomajiScore = score;
      }
      continue;
    }

    if (
      score > bestEnglishScore ||
      (score === bestEnglishScore && String(alias).length < String(bestEnglishAlias || '').length)
    ) {
      bestEnglishAlias = alias;
      bestEnglishScore = score;
    }
  }

  const output = [];
  const seen = new Set();

  for (const value of [
    formatEnglishDisplayAlias(bestEnglishAlias),
    formatRomajiDisplayAlias(bestRomajiAlias)
  ]) {
    const normalized = normalizeText(value);
    if (!value || !normalized || seen.has(normalized)) {
      continue;
    }
    output.push(value);
    seen.add(normalized);
  }

  return output;
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
  if (Array.isArray(song.normAliases) && song.normAliases.includes(query)) {
    score += 1400;
  }
  if (Array.isArray(song.normAliases) && song.normAliases.some((alias) => alias.startsWith(query))) {
    score += 650;
  }
  if (Array.isArray(song.normAliases) && song.normAliases.some((alias) => alias.includes(query))) {
    score += 260;
  }

  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => song.searchBlob.includes(token))) {
    score += 300;
  }

  return score;
}

function buildSongLabel(song) {
  const prefix = song.favoriteId
    ? `[${song.favoriteId}]`
    : (song.regions?.jp && !song.regions?.intl ? '[JP]' : '[CAT]');
  const body = `${song.title} - ${song.artist}`;
  return truncate(`${prefix} ${body}`, 100);
}

function findMatchingAlias(song, query) {
  const normalized = normalizeText(query);
  if (!normalized || !Array.isArray(song.aliases) || !Array.isArray(song.normAliases)) {
    return null;
  }

  const exactIndex = song.normAliases.indexOf(normalized);
  if (exactIndex >= 0) {
    return song.aliases[exactIndex] || null;
  }

  const prefixIndex = song.normAliases.findIndex((alias) => alias.startsWith(normalized));
  if (prefixIndex >= 0) {
    return song.aliases[prefixIndex] || null;
  }

  const partialIndex = song.normAliases.findIndex((alias) => alias.includes(normalized));
  if (partialIndex >= 0) {
    return song.aliases[partialIndex] || null;
  }

  return null;
}

function buildAutocompleteLabel(song, query) {
  const base = buildSongLabel(song);
  const alias = findMatchingAlias(song, query);
  if (!alias || normalizeText(alias) === song.normTitle) {
    return base;
  }
  return truncate(`${base} (alias: ${alias})`, 100);
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

function normalizeAliasEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    return null;
  }

  const aliases = Array.isArray(rawEntry.aliases)
    ? rawEntry.aliases
    : [rawEntry.alias || rawEntry.name];
  const normalizedAliases = aliases
    .map((alias) => String(alias || '').trim())
    .filter(Boolean);

  if (!normalizedAliases.length) {
    return null;
  }

  return {
    aliases: normalizedAliases,
    songId: rawEntry.songId ? String(rawEntry.songId).trim() : null,
    favoriteId: rawEntry.favoriteId ? String(rawEntry.favoriteId).trim() : null,
    title: rawEntry.title ? String(rawEntry.title).trim() : null,
    artist: rawEntry.artist ? String(rawEntry.artist).trim() : null
  };
}

function normalizeAliasFileEntries(parsed) {
  const entries = [];

  if (Array.isArray(parsed?.entries)) {
    for (const rawEntry of parsed.entries) {
      const entry = normalizeAliasEntry(rawEntry);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (parsed?.aliases && typeof parsed.aliases === 'object' && !Array.isArray(parsed.aliases)) {
    for (const [alias, target] of Object.entries(parsed.aliases)) {
      if (typeof target === 'string') {
        const value = target.trim();
        const isId = /^(?:\d{1,8}|song:[a-f0-9]{16})$/.test(value);
        entries.push({
          aliases: [alias],
          songId: isId ? value : null,
          favoriteId: null,
          title: isId ? null : value,
          artist: null
        });
        continue;
      }

      if (target && typeof target === 'object' && !Array.isArray(target)) {
        const entry = normalizeAliasEntry({ alias, ...target });
        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  return entries;
}

function resolveAliasSong(entry, { bySongId, byFavoriteId, byLegacyFavoriteId, byNormTitle, byNormTitleArtist }) {
  const normalizedTitle = normalizeText(entry.title);
  const normalizedArtist = normalizeText(entry.artist);
  if (normalizedTitle && normalizedArtist) {
    const exact = byNormTitleArtist.get(`${normalizedTitle}::${normalizedArtist}`);
    if (exact) {
      return exact;
    }
  }

  if (normalizedTitle) {
    const matches = byNormTitle.get(normalizedTitle) || [];
    if (matches.length === 1) {
      return matches[0];
    }
  }

  if (entry.songId) {
    const song =
      bySongId.get(entry.songId) ||
      byFavoriteId.get(entry.songId) ||
      byLegacyFavoriteId.get(entry.songId);
    if (song) {
      return song;
    }
  }

  if (entry.favoriteId) {
    const song = byFavoriteId.get(entry.favoriteId) || byLegacyFavoriteId.get(entry.favoriteId);
    if (song) {
      return song;
    }
  }

  return null;
}

export class SongCatalog {
  constructor(filePath) {
    this.filePath = filePath;
    this.playlistIdMapFile = DEFAULT_PLAYLIST_ID_MAP_FILE;
    this.aliasFile = DEFAULT_SONG_ALIAS_FILE;
    this.loaded = false;
    this.available = false;
    this.error = null;
    this.songs = [];
    this.bySongId = new Map();
    this.byFavoriteId = new Map();
    this.byLegacyFavoriteId = new Map();
    this.byNormTitle = new Map();
    this.byNormTitleArtist = new Map();
    this.byAlias = new Map();
    this.searchCache = new Map();
    this.contentHash = null;
    this.generatedAt = null;
  }

  async ensureReady() {
    if (!this.loaded) {
      await this.load();
    }
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const aliasRaw = await readOptionalUtf8(this.aliasFile);
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
      const byAlias = new Map();

      for (const sourceSong of sourceSongs) {
        const playlistKey = `${normalizeText(sourceSong.title)}::${normalizeText(sourceSong.artist)}`;
        const legacyFavoriteId = normalizeFavoriteId(playlistIdMap.get(playlistKey));
        const favoriteId = resolveStableFavoriteId(sourceSong);
        const title = String(sourceSong.title || '').trim();
        const artist = String(sourceSong.artist || '').trim();
        if (!title) {
          continue;
        }

        const song = {
          songId: buildCanonicalSongId(title, artist),
          favoriteId,
          legacyFavoriteId: legacyFavoriteId && legacyFavoriteId !== favoriteId ? legacyFavoriteId : null,
          aliases: [],
          displayAlias: null,
          displayAliases: [],
          normAliases: [],
          title,
          artist: artist || 'Unknown',
          bpm: sourceSong.bpm ?? null,
          category: sourceSong.category ?? null,
          regions: {
            jp: Boolean(sourceSong.regions?.jp),
            intl: Boolean(sourceSong.regions?.intl),
            usa: Boolean(sourceSong.regions?.usa),
            cn: Boolean(sourceSong.regions?.cn)
          },
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
            if (existing.favoriteId) {
              byFavoriteId.delete(existing.favoriteId);
            }
            if (existing.legacyFavoriteId) {
              byLegacyFavoriteId.delete(existing.legacyFavoriteId);
            }
          }
          bySongId.set(song.songId, song);
          if (favoriteId) {
            byFavoriteId.set(favoriteId, song);
          }
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

      if (aliasRaw !== null) {
        const aliasParsed = JSON.parse(aliasRaw);
        const aliasEntries = normalizeAliasFileEntries(aliasParsed);

        for (const entry of aliasEntries) {
          const song = resolveAliasSong(entry, {
            bySongId,
            byFavoriteId,
            byLegacyFavoriteId,
            byNormTitle,
            byNormTitleArtist
          });
          if (!song) {
            continue;
          }

          for (const alias of entry.aliases) {
            const normalizedAlias = normalizeText(alias);
            if (!normalizedAlias || byAlias.has(normalizedAlias)) {
              continue;
            }
            byAlias.set(normalizedAlias, song);
            song.aliases.push(alias);
            song.normAliases.push(normalizedAlias);
          }
        }
      }

      for (const song of this.songs) {
        if (song.aliases.length) {
          song.searchBlob = normalizeText(`${song.searchBlob} ${song.aliases.join(' ')}`);
        }
        song.displayAliases = pickDisplayAliases(song);
        song.displayAlias = song.displayAliases[0] || null;
      }

      this.bySongId = bySongId;
      this.byFavoriteId = byFavoriteId;
      this.byLegacyFavoriteId = byLegacyFavoriteId;
      this.byNormTitle = byNormTitle;
      this.byNormTitleArtist = byNormTitleArtist;
      this.byAlias = byAlias;
      this.searchCache = new Map();
      this.contentHash = hashCatalogInputs(raw, aliasRaw);
      this.generatedAt = parsed?.generatedAt || null;
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
      this.byAlias = new Map();
      this.searchCache = new Map();
      this.songs = [];
    } finally {
      this.loaded = true;
    }
  }

  async reloadIfChanged() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const aliasRaw = await readOptionalUtf8(this.aliasFile);
      const nextHash = hashCatalogInputs(raw, aliasRaw);
      if (nextHash === this.contentHash) {
        return { changed: false, reloaded: false, count: this.count, hash: nextHash };
      }

      const candidate = new SongCatalog(this.filePath);
      candidate.playlistIdMapFile = this.playlistIdMapFile;
      candidate.aliasFile = this.aliasFile;
      await candidate.load();
      if (!candidate.available) {
        this.error = candidate.error;
        return { changed: true, reloaded: false, count: this.count, hash: this.contentHash, error: candidate.error };
      }

      const minimumCount = this.available ? Math.floor(this.count * 0.9) : 1;
      if (candidate.count < minimumCount) {
        const error = new Error(
          `Refusing catalog reload that shrinks from ${this.count} to ${candidate.count} songs.`
        );
        this.error = error;
        return { changed: true, reloaded: false, count: this.count, hash: this.contentHash, error };
      }

      this.songs = candidate.songs;
      this.bySongId = candidate.bySongId;
      this.byFavoriteId = candidate.byFavoriteId;
      this.byLegacyFavoriteId = candidate.byLegacyFavoriteId;
      this.byNormTitle = candidate.byNormTitle;
      this.byNormTitleArtist = candidate.byNormTitleArtist;
      this.byAlias = candidate.byAlias;
      this.searchCache = new Map();
      this.contentHash = candidate.contentHash;
      this.generatedAt = candidate.generatedAt;
      this.loaded = true;
      this.available = true;
      this.error = null;
      return { changed: true, reloaded: true, count: this.count, hash: this.contentHash };
    } catch (error) {
      this.error = error;
      return { changed: false, reloaded: false, count: this.count, hash: this.contentHash, error };
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

  getByAlias(alias) {
    const normalized = normalizeText(alias);
    if (!normalized) {
      return null;
    }
    return this.byAlias.get(normalized) || null;
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
      this.searchCache.delete(cacheKey);
      this.searchCache.set(cacheKey, cached);
      return cached;
    }

    const direct = this.getByStoredId(normalized) || this.getByAlias(normalized);
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
    const direct = this.getByStoredId(query) || this.getByAlias(query);
    if (direct) {
      return direct;
    }

    const results = this.search(query, 1);
    return results[0] || null;
  }

  autocomplete(query, limit = 25) {
    this.requireAvailable();
    return this.search(query, limit).map((song) => ({
      name: buildAutocompleteLabel(song, query),
      value: song.songId
    }));
  }
}
