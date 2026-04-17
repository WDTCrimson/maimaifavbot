import Database from 'better-sqlite3';
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

function isCanonicalSongId(value) {
  return /^song:[a-f0-9]{16}$/.test(String(value || '').trim());
}

function normalizeAchievementTarget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100.5) {
    throw new Error('Target achievement must be between 0 and 100.5.');
  }
  return Number(parsed.toFixed(4));
}

function normalizeTargetDifficulty(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = new Map([
    ['basic', 'basic'],
    ['bsc', 'basic'],
    ['advanced', 'advanced'],
    ['adv', 'advanced'],
    ['expert', 'expert'],
    ['exp', 'expert'],
    ['master', 'master'],
    ['mas', 'master'],
    ['remaster', 'remaster'],
    ['re:master', 'remaster'],
    ['re:mas', 'remaster'],
    ['remas', 'remaster']
  ]);
  if (!aliases.has(normalized)) {
    throw new Error('Target difficulty must be BASIC, ADVANCED, EXPERT, MASTER, or Re:MASTER.');
  }
  return aliases.get(normalized);
}

function normalizeTargetChartType(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'dx') {
    return 'dx';
  }
  if (normalized === 'std' || normalized === 'sd') {
    return 'std';
  }
  throw new Error('Target chart type must be DX or STD.');
}

function normalizeTargetComboFlag(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const aliases = new Map([
    ['fc', 'fc'],
    ['fc+', 'fc+'],
    ['fcp', 'fc+'],
    ['ap', 'ap'],
    ['ap+', 'ap+'],
    ['app', 'ap+']
  ]);
  if (!aliases.has(normalized)) {
    throw new Error('Target combo must be FC, FC+, AP, or AP+.');
  }
  return aliases.get(normalized);
}

function normalizeLoadoutTargets(targets, validSongIds = null) {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    return {};
  }

  const allowed = validSongIds ? new Set(validSongIds.map((songId) => String(songId).trim())) : null;
  const normalized = {};

  for (const [rawSongId, rawTarget] of Object.entries(targets)) {
    const songId = normalizeSongId(rawSongId);
    if (allowed && !allowed.has(songId)) {
      continue;
    }

    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      continue;
    }

    if (rawTarget.achievementRate == null) {
      continue;
    }

    normalized[songId] = {
      achievementRate: normalizeAchievementTarget(rawTarget.achievementRate),
      difficulty: normalizeTargetDifficulty(rawTarget.difficulty),
      chartType: normalizeTargetChartType(rawTarget.chartType),
      comboFlag: normalizeTargetComboFlag(rawTarget.comboFlag)
    };
  }

  return normalized;
}

function buildDefaultLoadoutState(name) {
  const now = new Date().toISOString();
  return {
    name,
    songs: [],
    targets: {},
    createdAt: now,
    updatedAt: now
  };
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

function buildDefaultState() {
  return { users: {}, accountLinkSessions: {}, metadata: buildDefaultMetadata() };
}

function normalizeLoadedState(state) {
  const normalized = state && typeof state === 'object' ? { ...state } : buildDefaultState();
  if (!normalized.users || typeof normalized.users !== 'object' || Array.isArray(normalized.users)) {
    normalized.users = {};
  }
  if (
    !normalized.accountLinkSessions ||
    typeof normalized.accountLinkSessions !== 'object' ||
    Array.isArray(normalized.accountLinkSessions)
  ) {
    normalized.accountLinkSessions = {};
  }
  if (!normalized.metadata || typeof normalized.metadata !== 'object' || Array.isArray(normalized.metadata)) {
    normalized.metadata = buildDefaultMetadata();
  } else {
    normalized.metadata = {
      ...buildDefaultMetadata(),
      ...normalized.metadata
    };
  }
  return normalized;
}

class JsonStoreBackend {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async loadState() {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      return normalizeLoadedState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      const state = buildDefaultState();
      await this.saveState(state);
      return state;
    }
  }

  async saveState(state) {
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}

class SqliteStoreBackend {
  constructor(filePath, legacyJsonPath = null) {
    this.filePath = filePath;
    this.legacyJsonPath = legacyJsonPath;
    this.db = null;
  }

  async ensureReady() {
    if (this.db) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    this.db = new Database(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        account_json TEXT
      );

      CREATE TABLE IF NOT EXISTS loadouts (
        user_id TEXT NOT NULL,
        loadout_key TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, loadout_key),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playlist_songs (
        user_id TEXT NOT NULL,
        loadout_key TEXT NOT NULL,
        position INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        PRIMARY KEY (user_id, loadout_key, position),
        FOREIGN KEY (user_id, loadout_key) REFERENCES loadouts(user_id, loadout_key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playlist_targets (
        user_id TEXT NOT NULL,
        loadout_key TEXT NOT NULL,
        song_id TEXT NOT NULL,
        achievement_rate REAL NOT NULL,
        difficulty TEXT,
        chart_type TEXT,
        combo_flag TEXT,
        PRIMARY KEY (user_id, loadout_key, song_id),
        FOREIGN KEY (user_id, loadout_key) REFERENCES loadouts(user_id, loadout_key) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS account_link_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  isEmpty() {
    const tables = ['users', 'loadouts', 'account_link_sessions', 'metadata'];
    for (const table of tables) {
      const row = this.db.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get();
      if (row) {
        return false;
      }
    }
    return true;
  }

  async maybeImportLegacyJson() {
    if (!this.legacyJsonPath || !this.isEmpty()) {
      return;
    }

    try {
      const raw = await readFile(this.legacyJsonPath, 'utf8');
      const parsed = normalizeLoadedState(JSON.parse(raw));
      await this.saveState(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  readState() {
    const state = buildDefaultState();

    const metadataRows = this.db.prepare('SELECT key, value FROM metadata').all();
    if (metadataRows.length) {
      for (const row of metadataRows) {
        try {
          state.metadata[row.key] = JSON.parse(row.value);
        } catch {
          state.metadata[row.key] = row.value;
        }
      }
      state.metadata = {
        ...buildDefaultMetadata(),
        ...state.metadata
      };
    }

    const users = this.db.prepare('SELECT user_id, account_json FROM users').all();
    for (const row of users) {
      let account = null;
      if (row.account_json) {
        account = JSON.parse(row.account_json);
      }
      state.users[row.user_id] = {
        loadouts: {},
        account
      };
    }

    const loadouts = this.db
      .prepare('SELECT user_id, loadout_key, name, created_at, updated_at FROM loadouts ORDER BY user_id, loadout_key')
      .all();
    for (const row of loadouts) {
      if (!state.users[row.user_id]) {
        state.users[row.user_id] = { loadouts: {}, account: null };
      }
      state.users[row.user_id].loadouts[row.loadout_key] = {
        name: row.name,
        songs: [],
        targets: {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }

    const songs = this.db
      .prepare(
        'SELECT user_id, loadout_key, position, song_id FROM playlist_songs ORDER BY user_id, loadout_key, position'
      )
      .all();
    for (const row of songs) {
      const loadout = state.users[row.user_id]?.loadouts?.[row.loadout_key];
      if (loadout) {
        loadout.songs.push(row.song_id);
      }
    }

    const targets = this.db
      .prepare(
        'SELECT user_id, loadout_key, song_id, achievement_rate, difficulty, chart_type, combo_flag FROM playlist_targets ORDER BY user_id, loadout_key, song_id'
      )
      .all();
    for (const row of targets) {
      const loadout = state.users[row.user_id]?.loadouts?.[row.loadout_key];
      if (loadout) {
        loadout.targets[row.song_id] = {
          achievementRate: row.achievement_rate,
          difficulty: row.difficulty,
          chartType: row.chart_type,
          comboFlag: row.combo_flag
        };
      }
    }

    const sessions = this.db
      .prepare('SELECT token, user_id, status, created_at, expires_at FROM account_link_sessions ORDER BY created_at')
      .all();
    for (const row of sessions) {
      state.accountLinkSessions[row.token] = {
        token: row.token,
        userId: row.user_id,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    }

    return normalizeLoadedState(state);
  }

  async loadState() {
    await this.ensureReady();
    await this.maybeImportLegacyJson();
    if (this.isEmpty()) {
      const state = buildDefaultState();
      await this.saveState(state);
      return state;
    }
    return this.readState();
  }

  async saveState(state) {
    await this.ensureReady();
    const normalized = normalizeLoadedState(state);

    const insertMetadata = this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    const insertUser = this.db.prepare('INSERT INTO users (user_id, account_json) VALUES (?, ?)');
    const insertLoadout = this.db.prepare(
      'INSERT INTO loadouts (user_id, loadout_key, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertSong = this.db.prepare(
      'INSERT INTO playlist_songs (user_id, loadout_key, position, song_id) VALUES (?, ?, ?, ?)'
    );
    const insertTarget = this.db.prepare(
      'INSERT INTO playlist_targets (user_id, loadout_key, song_id, achievement_rate, difficulty, chart_type, combo_flag) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSession = this.db.prepare(
      'INSERT INTO account_link_sessions (token, user_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    );

    const persist = this.db.transaction((snapshot) => {
      this.db.exec(`
        DELETE FROM playlist_targets;
        DELETE FROM playlist_songs;
        DELETE FROM loadouts;
        DELETE FROM users;
        DELETE FROM account_link_sessions;
        DELETE FROM metadata;
      `);

      for (const [key, value] of Object.entries(snapshot.metadata || {})) {
        insertMetadata.run(key, JSON.stringify(value));
      }

      for (const [userId, user] of Object.entries(snapshot.users || {})) {
        insertUser.run(userId, user?.account ? JSON.stringify(user.account) : null);

        const loadouts = user?.loadouts || {};
        for (const [loadoutKey, loadout] of Object.entries(loadouts)) {
          insertLoadout.run(
            userId,
            loadoutKey,
            loadout.name,
            loadout.createdAt,
            loadout.updatedAt
          );

          for (const [position, songId] of (loadout.songs || []).entries()) {
            insertSong.run(userId, loadoutKey, position, songId);
          }

          for (const [songId, target] of Object.entries(loadout.targets || {})) {
            insertTarget.run(
              userId,
              loadoutKey,
              songId,
              target.achievementRate,
              target.difficulty ?? null,
              target.chartType ?? null,
              target.comboFlag ?? null
            );
          }
        }
      }

      for (const session of Object.values(snapshot.accountLinkSessions || {})) {
        insertSession.run(
          session.token,
          session.userId,
          session.status,
          session.createdAt,
          session.expiresAt
        );
      }
    });

    persist(normalized);
  }
}

export class LoadoutStore {
  constructor(options, limits) {
    const normalizedOptions =
      typeof options === 'string'
        ? { jsonFile: options, backend: 'json', sqliteFile: null }
        : {
            jsonFile: options?.jsonFile || './data/loadouts.json',
            backend: String(options?.backend || 'json').trim().toLowerCase(),
            sqliteFile: options?.sqliteFile || './data/loadouts.sqlite'
          };

    this.filePath = normalizedOptions.jsonFile;
    this.backendName = normalizedOptions.backend === 'sqlite' ? 'sqlite' : 'json';
    this.sqliteFile = normalizedOptions.sqliteFile;
    this.maxSongsPerLoadout = limits.maxSongsPerLoadout;
    this.maxNameLength = limits.maxNameLength;
    this.loaded = false;
    this.state = buildDefaultState();
    this.backend =
      this.backendName === 'sqlite'
        ? new SqliteStoreBackend(this.sqliteFile, this.filePath)
        : new JsonStoreBackend(this.filePath);
  }

  async load() {
    if (this.loaded) {
      return;
    }
    this.state = normalizeLoadedState(await this.backend.loadState());
    this.loaded = true;
  }

  async save() {
    await this.backend.saveState(this.state);
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

        if (!loadout.targets || typeof loadout.targets !== 'object' || Array.isArray(loadout.targets)) {
          loadout.targets = {};
          changed = true;
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

        const normalizedTargets = normalizeLoadoutTargets(loadout.targets, nextSongs);
        if (JSON.stringify(normalizedTargets) !== JSON.stringify(loadout.targets)) {
          loadout.targets = normalizedTargets;
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
      backend: this.backendName,
      sqliteFile: this.backendName === 'sqlite' ? this.sqliteFile : null,
      jsonFile: this.filePath,
      schemaVersion: Number(metadata.loadoutSchemaVersion) || 1,
      migratedAt: metadata.loadoutSchemaMigratedAt || null,
      legacySongIdsRemaining:
        typeof metadata.legacySongIdsRemaining === 'number' ? metadata.legacySongIdsRemaining : null
    };
  }

  async scrubAccountLinkState(now = Date.now()) {
    let changed = false;
    let accountsScrubbed = 0;
    let sessionsDeleted = 0;
    let sessionFieldsRemoved = 0;

    for (const user of Object.values(this.state.users || {})) {
      if (!user || typeof user !== 'object' || !user.account || typeof user.account !== 'object') {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(user.account, 'linkSession')) {
        delete user.account.linkSession;
        changed = true;
        accountsScrubbed += 1;
      }
    }

    const sessions = this.getAccountLinkSessions();
    for (const [token, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') {
        delete sessions[token];
        changed = true;
        sessionsDeleted += 1;
        continue;
      }

      if (session.status !== 'pending') {
        delete sessions[token];
        changed = true;
        sessionsDeleted += 1;
        continue;
      }

      for (const field of ['linkUrl', 'callbackUrl', 'provider', 'playerName', 'accountUpdatedAt', 'completedAt']) {
        if (Object.prototype.hasOwnProperty.call(session, field)) {
          delete session[field];
          changed = true;
          sessionFieldsRemoved += 1;
        }
      }

      const expiresAt = Date.parse(session.expiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        delete sessions[token];
        changed = true;
        sessionsDeleted += 1;
      }
    }

    if (changed) {
      await this.save();
    }

    return {
      changed,
      accountsScrubbed,
      sessionsDeleted,
      sessionFieldsRemoved
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
    const nextAccount = {
      ...account,
      linkedAt: previous?.linkedAt || account.linkedAt || now,
      updatedAt: now
    };
    delete nextAccount.linkSession;

    user.account = nextAccount;

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

      if (session.status !== 'pending') {
        delete sessions[token];
        changed = true;
        continue;
      }

      for (const field of ['linkUrl', 'callbackUrl', 'provider', 'playerName', 'accountUpdatedAt', 'completedAt']) {
        if (Object.prototype.hasOwnProperty.call(session, field)) {
          delete session[field];
          changed = true;
        }
      }

      const expiresAt = Date.parse(session.expiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
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
      expiresAt: session.expiresAt
    };

    await this.save();
    return sessions[session.token];
  }

  async completeAccountLinkSession(token, details = {}) {
    const session = this.getAccountLinkSession(token);
    if (!session) {
      return null;
    }

    const completedSession = {
      token: session.token,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      completedAt: details.completedAt || new Date().toISOString()
    };

    delete this.getAccountLinkSessions()[token];
    await this.save();
    return completedSession;
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
      ...buildDefaultLoadoutState(displayName)
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
    if (loadout.targets && typeof loadout.targets === 'object') {
      delete loadout.targets[id];
    }
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
    loadout.targets = normalizeLoadoutTargets(loadout.targets, normalizedSongs);
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }

  async setTargets(userId, name, targets) {
    const loadout = this.getLoadout(userId, name);
    loadout.targets = normalizeLoadoutTargets(targets, loadout.songs);
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }

  async setSongTarget(userId, name, songId, target) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    if (!loadout.songs.includes(id)) {
      throw new Error(`Song ID ${id} is not in \"${loadout.name}\".`);
    }

    loadout.targets = normalizeLoadoutTargets(loadout.targets, loadout.songs);
    loadout.targets[id] = {
      achievementRate: normalizeAchievementTarget(target.achievementRate),
      difficulty: normalizeTargetDifficulty(target.difficulty),
      chartType: normalizeTargetChartType(target.chartType),
      comboFlag: normalizeTargetComboFlag(target.comboFlag)
    };
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }

  async clearSongTarget(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    if (!loadout.targets || typeof loadout.targets !== 'object' || !loadout.targets[id]) {
      throw new Error(`Song ID ${id} has no target in \"${loadout.name}\".`);
    }

    delete loadout.targets[id];
    loadout.updatedAt = new Date().toISOString();
    await this.save();
    return loadout;
  }
}
