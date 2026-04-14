import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const LOADOUT_SCHEMA_VERSION = 2;

function normalizeLoadoutName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSongId(songId) {
  const value = String(songId).trim();
  if (!/^(?:\d{1,8}|song:[a-f0-9]{16})$/.test(value)) {
    throw new Error('Song ID must be a numeric legacy ID or canonical song ID.');
  }
  return value;
}

function normalizeSongIds(songIds, maxSongsPerLoadout) {
  if (!Array.isArray(songIds)) {
    throw new Error('Song IDs must be an array.');
  }

  const unique = [];
  const seen = new Set();

  for (const songId of songIds) {
    const normalized = normalizeSongId(songId);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  if (unique.length > maxSongsPerLoadout) {
    throw new Error(`Loadout cannot exceed ${maxSongsPerLoadout} songs.`);
  }

  return unique;
}

function validateLoadoutName(name, maxNameLength) {
  const value = name.trim().replace(/\s+/g, ' ');
  if (!value) {
    throw new Error('Loadout name cannot be empty.');
  }
  if (value.length > maxNameLength) {
    throw new Error(`Loadout name is too long (max ${maxNameLength} chars).`);
  }
  return value;
}

function buildDefaultMetadata() {
  return {
    loadoutSchemaVersion: 1,
    loadoutSchemaMigratedAt: null,
    legacySongIdsRemaining: null
  };
}

export class LoadoutStore {
  constructor(filePath, limits) {
    this.filePath = filePath;
    this.maxSongsPerLoadout = limits.maxSongsPerLoadout;
    this.maxNameLength = limits.maxNameLength;
    this.loaded = false;
    this.state = { users: {}, accountLinkSessions: {}, metadata: buildDefaultMetadata() };
  }

  async load() {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object') {
        this.state = parsed;
        if (
          !this.state.accountLinkSessions ||
          typeof this.state.accountLinkSessions !== 'object'
        ) {
          this.state.accountLinkSessions = {};
        }
        if (!this.state.metadata || typeof this.state.metadata !== 'object') {
          this.state.metadata = buildDefaultMetadata();
        } else {
          this.state.metadata = {
            ...buildDefaultMetadata(),
            ...this.state.metadata
          };
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await this.save();
    }

    this.loaded = true;
  }

  async save() {
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }

  async ensureReady() {
    await this.load();
  }

  async migrateLoadouts(resolveSongByStoredId) {
    let changed = false;
    const unresolved = [];
    let totalSongs = 0;
    let canonicalSongs = 0;
    let legacySongs = 0;

    for (const [userId, user] of Object.entries(this.state.users || {})) {
      const loadouts = user?.loadouts;
      if (!loadouts || typeof loadouts !== 'object') {
        continue;
      }

      for (const loadout of Object.values(loadouts)) {
        if (!loadout || !Array.isArray(loadout.songs)) {
          continue;
        }

        let loadoutChanged = false;
        const nextSongs = [];
        const seen = new Set();

        for (const rawId of loadout.songs) {
          const normalized = normalizeSongId(rawId);
          totalSongs += 1;
          if (/^song:[a-f0-9]{16}$/.test(normalized)) {
            canonicalSongs += 1;
            if (!seen.has(normalized)) {
              seen.add(normalized);
              nextSongs.push(normalized);
            }
            continue;
          }

          legacySongs += 1;
          const song = typeof resolveSongByStoredId === 'function' ? resolveSongByStoredId(normalized) : null;
          const migratedId = song?.songId || normalized;
          if (!song) {
            unresolved.push({
              userId,
              loadout: loadout.name,
              songId: normalized
            });
          }

          if (!seen.has(migratedId)) {
            seen.add(migratedId);
            nextSongs.push(migratedId);
          }
          if (migratedId !== normalized) {
            loadoutChanged = true;
          }
        }

        if (nextSongs.length !== loadout.songs.length) {
          loadoutChanged = true;
        }

        if (loadoutChanged) {
          changed = true;
          loadout.songs = nextSongs;
          loadout.updatedAt = new Date().toISOString();
        }
      }
    }

    const remainingLegacySongs = Object.values(this.state.users || {}).reduce((sum, user) => {
      const loadouts = user?.loadouts;
      if (!loadouts || typeof loadouts !== 'object') {
        return sum;
      }

      return (
        sum +
        Object.values(loadouts).reduce((loadoutSum, loadout) => {
          if (!loadout || !Array.isArray(loadout.songs)) {
            return loadoutSum;
          }
          return (
            loadoutSum +
            loadout.songs.filter((songId) => /^\d{1,8}$/.test(String(songId || '').trim())).length
          );
        }, 0)
      );
    }, 0);

    const metadata = this.state.metadata || buildDefaultMetadata();
    const previousSchemaVersion = Number(metadata.loadoutSchemaVersion) || 1;
    const previousMigratedAt = metadata.loadoutSchemaMigratedAt || null;
    const previousLegacySongIdsRemaining =
      typeof metadata.legacySongIdsRemaining === 'number' ? metadata.legacySongIdsRemaining : null;
    metadata.loadoutSchemaVersion = LOADOUT_SCHEMA_VERSION;
    metadata.loadoutSchemaMigratedAt = changed
      ? new Date().toISOString()
      : metadata.loadoutSchemaMigratedAt || new Date().toISOString();
    metadata.legacySongIdsRemaining = remainingLegacySongs;
    this.state.metadata = metadata;

    if (
      changed ||
      previousSchemaVersion !== metadata.loadoutSchemaVersion ||
      previousMigratedAt !== metadata.loadoutSchemaMigratedAt ||
      previousLegacySongIdsRemaining !== metadata.legacySongIdsRemaining
    ) {
      await this.save();
    }

    return {
      changed,
      unresolved,
      totalSongs,
      canonicalSongs,
      legacySongs,
      remainingLegacySongs,
      schemaVersion: LOADOUT_SCHEMA_VERSION
    };
  }

  getLoadoutStorageStatus() {
    const metadata = this.state.metadata || buildDefaultMetadata();
    return {
      schemaVersion: Number(metadata.loadoutSchemaVersion) || 1,
      migratedAt: metadata.loadoutSchemaMigratedAt || null,
      legacySongIdsRemaining:
        typeof metadata.legacySongIdsRemaining === 'number' ? metadata.legacySongIdsRemaining : null
    };
  }

  getUser(userId) {
    if (!this.state.users[userId]) {
      this.state.users[userId] = { loadouts: {}, account: null };
    } else {
      if (!this.state.users[userId].loadouts || typeof this.state.users[userId].loadouts !== 'object') {
        this.state.users[userId].loadouts = {};
      }
      if (!Object.prototype.hasOwnProperty.call(this.state.users[userId], 'account')) {
        this.state.users[userId].account = null;
      }
    }
    return this.state.users[userId];
  }

  getAccountLinkSessions() {
    if (!this.state.accountLinkSessions || typeof this.state.accountLinkSessions !== 'object') {
      this.state.accountLinkSessions = {};
    }
    return this.state.accountLinkSessions;
  }

  getAccount(userId) {
    const user = this.getUser(userId);
    return user.account || null;
  }

  hasAccount(userId) {
    return Boolean(this.getAccount(userId));
  }

  async setAccount(userId, account) {
    const user = this.getUser(userId);
    const now = new Date().toISOString();
    const previous = user.account || null;

    user.account = {
      ...account,
      linkedAt: previous?.linkedAt || account.linkedAt || now,
      updatedAt: now
    };

    await this.save();
    return user.account;
  }

  async clearAccount(userId) {
    const user = this.getUser(userId);
    const previous = user.account || null;
    user.account = null;
    await this.save();
    return previous;
  }

  getAccountLinkSession(token) {
    const key = String(token || '').trim();
    if (!key) {
      return null;
    }

    const sessions = this.getAccountLinkSessions();
    return sessions[key] || null;
  }

  getPendingAccountLinkSessionForUser(userId, now = Date.now()) {
    const sessions = this.getAccountLinkSessions();
    for (const session of Object.values(sessions)) {
      if (
        session &&
        session.userId === userId &&
        session.status === 'pending' &&
        Date.parse(session.expiresAt) > now
      ) {
        return session;
      }
    }
    return null;
  }

  async cleanupExpiredAccountLinkSessions(now = Date.now()) {
    const sessions = this.getAccountLinkSessions();
    let changed = false;

    for (const [token, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') {
        delete sessions[token];
        changed = true;
        continue;
      }

      const expiresAt = Date.parse(session.expiresAt || '');
      if (session.status === 'pending' && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
        delete sessions[token];
        changed = true;
      }
    }

    if (changed) {
      await this.save();
    }
  }

  async createAccountLinkSession(userId, session) {
    const sessions = this.getAccountLinkSessions();
    const now = Date.now();

    for (const [token, existing] of Object.entries(sessions)) {
      if (
        existing &&
        existing.userId === userId &&
        existing.status === 'pending' &&
        Date.parse(existing.expiresAt || '') > now
      ) {
        delete sessions[token];
      }
    }

    sessions[session.token] = {
      token: session.token,
      userId,
      status: 'pending',
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      linkUrl: session.linkUrl || null,
      callbackUrl: session.callbackUrl || null
    };

    await this.save();
    return sessions[session.token];
  }

  async completeAccountLinkSession(token, details = {}) {
    const session = this.getAccountLinkSession(token);
    if (!session) {
      return null;
    }

    session.status = 'completed';
    session.completedAt = details.completedAt || new Date().toISOString();
    session.provider = details.provider || session.provider || null;
    session.playerName = details.playerName || session.playerName || null;
    session.accountUpdatedAt = details.accountUpdatedAt || null;

    await this.save();
    return session;
  }

  listLoadouts(userId) {
    const user = this.getUser(userId);
    return Object.values(user.loadouts).sort((a, b) => a.name.localeCompare(b.name));
  }

  getLoadout(userId, name) {
    const key = normalizeLoadoutName(name);
    const user = this.getUser(userId);
    const loadout = user.loadouts[key];
    if (!loadout) {
      throw new Error(`Loadout \"${name}\" was not found.`);
    }
    return loadout;
  }

  hasLoadout(userId, name) {
    const key = normalizeLoadoutName(name);
    const user = this.getUser(userId);
    return Boolean(user.loadouts[key]);
  }

  async createLoadout(userId, name) {
    const displayName = validateLoadoutName(name, this.maxNameLength);
    const key = normalizeLoadoutName(displayName);
    const user = this.getUser(userId);

    if (user.loadouts[key]) {
      throw new Error(`Loadout \"${displayName}\" already exists.`);
    }

    user.loadouts[key] = {
      name: displayName,
      songs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.save();
    return user.loadouts[key];
  }

  async deleteLoadout(userId, name) {
    const key = normalizeLoadoutName(name);
    const user = this.getUser(userId);
    if (!user.loadouts[key]) {
      throw new Error(`Loadout \"${name}\" was not found.`);
    }

    const removed = user.loadouts[key];
    delete user.loadouts[key];
    await this.save();
    return removed;
  }

  async addSong(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);

    if (loadout.songs.includes(id)) {
      throw new Error(`Song ID ${id} is already in \"${loadout.name}\".`);
    }
    if (loadout.songs.length >= this.maxSongsPerLoadout) {
      throw new Error(`\"${loadout.name}\" is full (${this.maxSongsPerLoadout} songs max).`);
    }

    loadout.songs.push(id);
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }

  async removeSong(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);

    const nextSongs = loadout.songs.filter((value) => value !== id);
    if (nextSongs.length === loadout.songs.length) {
      throw new Error(`Song ID ${id} is not in \"${loadout.name}\".`);
    }

    loadout.songs = nextSongs;
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }

  async setSongs(userId, name, songIds, options = {}) {
    const { createIfMissing = false } = options;
    const normalizedSongs = normalizeSongIds(songIds, this.maxSongsPerLoadout);
    let loadout = null;

    try {
      loadout = this.getLoadout(userId, name);
    } catch (error) {
      if (!createIfMissing) {
        throw error;
      }
      loadout = await this.createLoadout(userId, name);
    }

    loadout.songs = normalizedSongs;
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }
}
