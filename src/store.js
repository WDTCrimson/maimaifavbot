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

function serializeNullableJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseNullableJson(value) {
  if (value == null || value === '') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeAccountScoreEntry(score) {
  if (!score || typeof score !== 'object') {
    return null;
  }

  const title = String(score.title || '').trim();
  const difficulty = String(score.difficulty || '').trim().toLowerCase();
  const type = String(score.type || score.chartType || 'std').trim().toLowerCase();
  if (!title || !difficulty || !type) {
    return null;
  }

  return {
    ...score,
    title,
    difficulty,
    type
  };
}

function normalizeAccountRecentEntry(play) {
  if (!play || typeof play !== 'object') {
    return null;
  }

  return {
    ...play,
    title: String(play.title || play.songName || 'Unknown Song').trim(),
    difficulty: play.difficulty == null ? null : String(play.difficulty).trim().toLowerCase(),
    type: play.type == null ? null : String(play.type).trim().toLowerCase()
  };
}

function accountJsonForSqlite(account) {
  if (!account || typeof account !== 'object') {
    return null;
  }
  const stored = { ...account };
  delete stored.allScores;
  delete stored.recentSessions;
  return JSON.stringify(stored);
}

function accountScoreFromRow(row) {
  const data = parseNullableJson(row.data_json) || {};
  const noteCounts = parseNullableJson(row.note_counts_json);
  const score = {
    ...data,
    title: row.title,
    difficulty: row.difficulty,
    type: row.chart_type,
    level: row.level ?? data.level,
    achievement: row.achievement ?? data.achievement,
    dxScore: row.dx_score ?? data.dxScore,
    maxDxScore: row.max_dx_score ?? data.maxDxScore,
    fc: row.fc ?? data.fc,
    fs: row.fs ?? data.fs,
    playCount: row.play_count ?? data.playCount,
    playedAt: row.played_at ?? data.playedAt,
    rating: row.rating ?? data.rating,
    internalLevelValue: row.internal_level_value ?? data.internalLevelValue,
    version: row.version ?? data.version,
    favoriteId: row.favorite_id ?? data.favoriteId,
    songId: row.song_id ?? data.songId,
    artist: row.artist ?? data.artist,
    scoreUnavailable: Boolean(row.score_unavailable),
    syncedAt: row.synced_at ?? data.syncedAt
  };
  if (noteCounts != null) {
    score.noteCounts = noteCounts;
  }
  return score;
}

function accountRecentFromRow(row) {
  const data = parseNullableJson(row.data_json) || {};
  const details = parseNullableJson(row.details_json);
  const noteCounts = parseNullableJson(row.note_counts_json);
  const play = {
    ...data,
    title: row.title ?? data.title,
    difficulty: row.difficulty ?? data.difficulty,
    type: row.chart_type ?? data.type,
    level: row.level ?? data.level,
    achievement: row.achievement ?? data.achievement,
    dxScore: row.dx_score ?? data.dxScore,
    maxDxScore: row.max_dx_score ?? data.maxDxScore,
    fc: row.fc ?? data.fc,
    fs: row.fs ?? data.fs,
    track: row.track_number ?? data.track,
    playedAt: row.played_at ?? data.playedAt,
    playedAtIso: row.played_at_iso ?? data.playedAtIso,
    rating: row.rating ?? data.rating,
    internalLevelValue: row.internal_level_value ?? data.internalLevelValue,
    version: row.version ?? data.version,
    favoriteId: row.favorite_id ?? data.favoriteId,
    songId: row.song_id ?? data.songId,
    artist: row.artist ?? data.artist,
    syncedAt: row.synced_at ?? data.syncedAt
  };
  if (details != null) {
    play.details = details;
  }
  if (noteCounts != null) {
    play.noteCounts = noteCounts;
  }
  return play;
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

  async saveMetadata(_metadata, state) {
    await this.saveState(state);
  }

  async saveUser(_userId, _user, state) {
    await this.saveState(state);
  }

  async saveLoadout(_userId, _loadoutKey, _loadout, _user, state) {
    await this.saveState(state);
  }

  async deleteLoadout(_userId, _loadoutKey, _user, state) {
    await this.saveState(state);
  }

  async saveSession(_token, _session, state) {
    await this.saveState(state);
  }

  async deleteSession(_token, state) {
    await this.saveState(state);
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

      CREATE TABLE IF NOT EXISTS account_score_charts (
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        chart_type TEXT NOT NULL,
        level TEXT,
        achievement INTEGER,
        dx_score INTEGER,
        max_dx_score INTEGER,
        fc TEXT,
        fs TEXT,
        play_count INTEGER,
        played_at TEXT,
        rating INTEGER,
        internal_level_value REAL,
        version TEXT,
        favorite_id TEXT,
        song_id TEXT,
        artist TEXT,
        score_unavailable INTEGER NOT NULL DEFAULT 0,
        score_order INTEGER NOT NULL DEFAULT 0,
        note_counts_json TEXT,
        data_json TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, title, difficulty, chart_type),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_play_count
        ON account_score_charts(user_id, play_count DESC);

      CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_title
        ON account_score_charts(user_id, title);

      CREATE TABLE IF NOT EXISTS account_recent_plays (
        user_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT,
        difficulty TEXT,
        chart_type TEXT,
        level TEXT,
        achievement INTEGER,
        dx_score INTEGER,
        max_dx_score INTEGER,
        fc TEXT,
        fs TEXT,
        track_number INTEGER,
        played_at TEXT,
        played_at_iso TEXT,
        rating INTEGER,
        internal_level_value REAL,
        version TEXT,
        favorite_id TEXT,
        song_id TEXT,
        artist TEXT,
        details_json TEXT,
        note_counts_json TEXT,
        data_json TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, position),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_account_recent_plays_user_played_at
        ON account_recent_plays(user_id, played_at_iso DESC, position ASC);

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
    this.ensureAccountScoreSchema();
    this.backfillAccountDataFromJson();
  }

  ensureAccountScoreSchema() {
    const columns = new Set(
      this.db.prepare('PRAGMA table_info(account_score_charts)').all().map((column) => column.name)
    );
    if (!columns.has('score_order')) {
      this.db.exec('ALTER TABLE account_score_charts ADD COLUMN score_order INTEGER NOT NULL DEFAULT 0');
    }
  }

  backfillAccountDataFromJson() {
    const existingScores = this.db.prepare('SELECT COUNT(*) AS count FROM account_score_charts').get();
    const existingRecent = this.db.prepare('SELECT COUNT(*) AS count FROM account_recent_plays').get();
    const shouldBackfillScores = !existingScores || existingScores.count === 0;
    const shouldBackfillRecent = !existingRecent || existingRecent.count === 0;

    const rows = this.db.prepare('SELECT user_id, account_json FROM users WHERE account_json IS NOT NULL').all();
    if (!rows.length) {
      return;
    }

    const insertScore = this.prepareInsertAccountScore();
    const insertRecent = this.prepareInsertAccountRecent();
    const updateUser = this.db.prepare('UPDATE users SET account_json = ? WHERE user_id = ?');
    const backfill = this.db.transaction((items) => {
      for (const row of items) {
        let account = null;
        try {
          account = JSON.parse(row.account_json);
        } catch {
          continue;
        }
        if (shouldBackfillScores) {
          this.writeAccountScores(row.user_id, account?.allScores, account?.updatedAt || new Date().toISOString(), insertScore);
        }
        if (shouldBackfillRecent) {
          this.writeAccountRecentSessions(row.user_id, account?.recentSessions, account?.updatedAt || new Date().toISOString(), insertRecent);
        }
        if (Array.isArray(account?.allScores) || Array.isArray(account?.recentSessions)) {
          updateUser.run(accountJsonForSqlite(account), row.user_id);
        }
      }
    });
    backfill(rows);
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

  prepareInsertAccountScore() {
    return this.db.prepare(
      `INSERT INTO account_score_charts (
         user_id, title, difficulty, chart_type, level, achievement, dx_score, max_dx_score,
         fc, fs, play_count, played_at, rating, internal_level_value, version, favorite_id,
         song_id, artist, score_unavailable, score_order, note_counts_json, data_json, synced_at
       )
       VALUES (
         @userId, @title, @difficulty, @type, @level, @achievement, @dxScore, @maxDxScore,
         @fc, @fs, @playCount, @playedAt, @rating, @internalLevelValue, @version, @favoriteId,
         @songId, @artist, @scoreUnavailable, @scoreOrder, @noteCountsJson, @dataJson, @syncedAt
       )
       ON CONFLICT(user_id, title, difficulty, chart_type) DO UPDATE SET
         level = excluded.level,
         achievement = excluded.achievement,
         dx_score = excluded.dx_score,
         max_dx_score = excluded.max_dx_score,
         fc = excluded.fc,
         fs = excluded.fs,
         play_count = excluded.play_count,
         played_at = excluded.played_at,
         rating = excluded.rating,
         internal_level_value = excluded.internal_level_value,
         version = excluded.version,
         favorite_id = excluded.favorite_id,
         song_id = excluded.song_id,
         artist = excluded.artist,
         score_unavailable = excluded.score_unavailable,
         score_order = excluded.score_order,
         note_counts_json = excluded.note_counts_json,
         data_json = excluded.data_json,
         synced_at = excluded.synced_at`
    );
  }

  writeAccountScores(userId, scores, syncedAt = new Date().toISOString(), insertScore = this.prepareInsertAccountScore()) {
    if (!Array.isArray(scores)) {
      return 0;
    }

    let written = 0;
    for (const [scoreOrder, rawScore] of scores.entries()) {
      const score = normalizeAccountScoreEntry(rawScore);
      if (!score) {
        continue;
      }

      insertScore.run({
        userId,
        title: score.title,
        difficulty: score.difficulty,
        type: score.type,
        level: score.level ?? null,
        achievement: score.achievement ?? null,
        dxScore: score.dxScore ?? null,
        maxDxScore: score.maxDxScore ?? null,
        fc: score.fc ?? null,
        fs: score.fs ?? null,
        playCount: score.playCount ?? null,
        playedAt: score.playedAt ?? null,
        rating: score.rating ?? null,
        internalLevelValue: score.internalLevelValue ?? null,
        version: score.version ?? null,
        favoriteId: score.favoriteId ?? null,
        songId: score.songId ?? null,
        artist: score.artist ?? null,
        scoreUnavailable: score.scoreUnavailable ? 1 : 0,
        scoreOrder,
        noteCountsJson: serializeNullableJson(score.noteCounts),
        dataJson: JSON.stringify(score),
        syncedAt
      });
      written += 1;
    }

    return written;
  }

  readAccountScores(userId) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_score_charts
         WHERE user_id = ?
         ORDER BY score_order ASC, title COLLATE NOCASE, difficulty, chart_type`
      )
      .all(userId)
      .map(accountScoreFromRow);
  }

  listTopPlayCountScores(userId, count = 10) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_score_charts
         WHERE user_id = ?
           AND play_count IS NOT NULL
           AND play_count > 0
         ORDER BY play_count DESC, title COLLATE NOCASE ASC, difficulty ASC, chart_type ASC
         LIMIT ?`
      )
      .all(userId, Math.max(1, Math.min(50, Number(count) || 10)))
      .map(accountScoreFromRow);
  }

  prepareInsertAccountRecent() {
    return this.db.prepare(
      `INSERT INTO account_recent_plays (
         user_id, position, title, difficulty, chart_type, level, achievement, dx_score,
         max_dx_score, fc, fs, track_number, played_at, played_at_iso, rating,
         internal_level_value, version, favorite_id, song_id, artist, details_json,
         note_counts_json, data_json, synced_at
       )
       VALUES (
         @userId, @position, @title, @difficulty, @type, @level, @achievement, @dxScore,
         @maxDxScore, @fc, @fs, @track, @playedAt, @playedAtIso, @rating,
         @internalLevelValue, @version, @favoriteId, @songId, @artist, @detailsJson,
         @noteCountsJson, @dataJson, @syncedAt
       )
       ON CONFLICT(user_id, position) DO UPDATE SET
         title = excluded.title,
         difficulty = excluded.difficulty,
         chart_type = excluded.chart_type,
         level = excluded.level,
         achievement = excluded.achievement,
         dx_score = excluded.dx_score,
         max_dx_score = excluded.max_dx_score,
         fc = excluded.fc,
         fs = excluded.fs,
         track_number = excluded.track_number,
         played_at = excluded.played_at,
         played_at_iso = excluded.played_at_iso,
         rating = excluded.rating,
         internal_level_value = excluded.internal_level_value,
         version = excluded.version,
         favorite_id = excluded.favorite_id,
         song_id = excluded.song_id,
         artist = excluded.artist,
         details_json = excluded.details_json,
         note_counts_json = excluded.note_counts_json,
         data_json = excluded.data_json,
         synced_at = excluded.synced_at`
    );
  }

  writeAccountRecentSessions(
    userId,
    recentSessions,
    syncedAt = new Date().toISOString(),
    insertRecent = this.prepareInsertAccountRecent()
  ) {
    if (!Array.isArray(recentSessions)) {
      return 0;
    }

    let written = 0;
    for (const [position, rawPlay] of recentSessions.entries()) {
      const play = normalizeAccountRecentEntry(rawPlay);
      if (!play) {
        continue;
      }

      insertRecent.run({
        userId,
        position,
        title: play.title ?? null,
        difficulty: play.difficulty ?? null,
        type: play.type ?? null,
        level: play.level ?? null,
        achievement: play.achievement ?? null,
        dxScore: play.dxScore ?? null,
        maxDxScore: play.maxDxScore ?? null,
        fc: play.fc ?? null,
        fs: play.fs ?? null,
        track: play.track ?? null,
        playedAt: play.playedAt ?? null,
        playedAtIso: play.playedAtIso ?? null,
        rating: play.rating ?? null,
        internalLevelValue: play.internalLevelValue ?? null,
        version: play.version ?? null,
        favoriteId: play.favoriteId ?? null,
        songId: play.songId ?? null,
        artist: play.artist ?? null,
        detailsJson: serializeNullableJson(play.details),
        noteCountsJson: serializeNullableJson(play.noteCounts),
        dataJson: JSON.stringify(play),
        syncedAt
      });
      written += 1;
    }

    return written;
  }

  readAccountRecentSessions(userId) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_recent_plays
         WHERE user_id = ?
         ORDER BY position ASC`
      )
      .all(userId)
      .map(accountRecentFromRow);
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
    const accountScoresByUser = new Map();
    const accountRecentByUser = new Map();
    for (const [userId, user] of Object.entries(normalized.users || {})) {
      if (!user?.account) {
        accountScoresByUser.set(userId, []);
        accountRecentByUser.set(userId, []);
      } else if (Object.prototype.hasOwnProperty.call(user.account, 'allScores')) {
        accountScoresByUser.set(userId, user.account.allScores);
      } else {
        accountScoresByUser.set(userId, this.readAccountScores(userId));
      }

      if (user?.account && Object.prototype.hasOwnProperty.call(user.account, 'recentSessions')) {
        accountRecentByUser.set(userId, user.account.recentSessions);
      } else if (user?.account) {
        accountRecentByUser.set(userId, this.readAccountRecentSessions(userId));
      }
    }

    const insertMetadata = this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    const insertUser = this.db.prepare('INSERT INTO users (user_id, account_json) VALUES (?, ?)');
    const insertScore = this.prepareInsertAccountScore();
    const insertRecent = this.prepareInsertAccountRecent();
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
        DELETE FROM account_score_charts;
        DELETE FROM account_recent_plays;
        DELETE FROM users;
        DELETE FROM account_link_sessions;
        DELETE FROM metadata;
      `);

      for (const [key, value] of Object.entries(snapshot.metadata || {})) {
        insertMetadata.run(key, JSON.stringify(value));
      }

      for (const [userId, user] of Object.entries(snapshot.users || {})) {
        insertUser.run(userId, accountJsonForSqlite(user?.account));
        this.writeAccountScores(userId, accountScoresByUser.get(userId), user?.account?.updatedAt, insertScore);
        this.writeAccountRecentSessions(userId, accountRecentByUser.get(userId), user?.account?.updatedAt, insertRecent);

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

  async saveMetadata(metadata) {
    await this.ensureReady();
    const normalized = {
      ...buildDefaultMetadata(),
      ...(metadata || {})
    };

    const persist = this.db.transaction((snapshot) => {
      this.db.prepare('DELETE FROM metadata').run();
      const insertMetadata = this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(snapshot)) {
        insertMetadata.run(key, JSON.stringify(value));
      }
    });

    persist(normalized);
  }

  async saveUser(userId, user) {
    await this.ensureReady();
    const persist = this.db.transaction((account) => {
      this.db
        .prepare(
          `INSERT INTO users (user_id, account_json)
           VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET account_json = excluded.account_json`
        )
        .run(userId, accountJsonForSqlite(account));
      if (!account) {
        this.db.prepare('DELETE FROM account_score_charts WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM account_recent_plays WHERE user_id = ?').run(userId);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(account, 'allScores')) {
        this.db.prepare('DELETE FROM account_score_charts WHERE user_id = ?').run(userId);
        this.writeAccountScores(userId, account.allScores, account.updatedAt);
      }
      if (Object.prototype.hasOwnProperty.call(account, 'recentSessions')) {
        this.db.prepare('DELETE FROM account_recent_plays WHERE user_id = ?').run(userId);
        this.writeAccountRecentSessions(userId, account.recentSessions, account.updatedAt);
      }
    });
    persist(user?.account || null);
  }

  async saveLoadout(userId, loadoutKey, loadout, user) {
    await this.ensureReady();
    const persist = this.db.transaction((account, payload) => {
      this.db
        .prepare(
          `INSERT INTO users (user_id, account_json)
           VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET account_json = excluded.account_json`
        )
        .run(userId, accountJsonForSqlite(account));

      this.db
        .prepare(
          `INSERT INTO loadouts (user_id, loadout_key, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, loadout_key) DO UPDATE SET
             name = excluded.name,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`
        )
        .run(userId, loadoutKey, payload.name, payload.createdAt, payload.updatedAt);

      this.db
        .prepare('DELETE FROM playlist_songs WHERE user_id = ? AND loadout_key = ?')
        .run(userId, loadoutKey);
      this.db
        .prepare('DELETE FROM playlist_targets WHERE user_id = ? AND loadout_key = ?')
        .run(userId, loadoutKey);

      const insertSong = this.db.prepare(
        'INSERT INTO playlist_songs (user_id, loadout_key, position, song_id) VALUES (?, ?, ?, ?)'
      );
      for (const [position, songId] of (payload.songs || []).entries()) {
        insertSong.run(userId, loadoutKey, position, songId);
      }

      const insertTarget = this.db.prepare(
        'INSERT INTO playlist_targets (user_id, loadout_key, song_id, achievement_rate, difficulty, chart_type, combo_flag) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const [songId, target] of Object.entries(payload.targets || {})) {
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
    });

    persist(user?.account || null, loadout);
  }

  async deleteLoadout(userId, loadoutKey, user) {
    await this.ensureReady();
    const persist = this.db.transaction((account) => {
      this.db
        .prepare(
          `INSERT INTO users (user_id, account_json)
           VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET account_json = excluded.account_json`
        )
        .run(userId, accountJsonForSqlite(account));
      this.db
        .prepare('DELETE FROM loadouts WHERE user_id = ? AND loadout_key = ?')
        .run(userId, loadoutKey);
    });

    persist(user?.account || null);
  }

  async saveSession(token, session) {
    await this.ensureReady();
    this.db
      .prepare(
        `INSERT INTO account_link_sessions (token, user_id, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           user_id = excluded.user_id,
           status = excluded.status,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(token, session.userId, session.status, session.createdAt, session.expiresAt);
  }

  async deleteSession(token) {
    await this.ensureReady();
    this.db.prepare('DELETE FROM account_link_sessions WHERE token = ?').run(token);
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

  async saveMetadata() {
    await this.backend.saveMetadata(this.state.metadata, this.state);
  }

  async saveUser(userId) {
    const user = this.getUser(userId);
    await this.backend.saveUser(userId, user, this.state);
  }

  async saveLoadout(userId, loadoutKey) {
    const user = this.getUser(userId);
    const loadout = user.loadouts[loadoutKey];
    await this.backend.saveLoadout(userId, loadoutKey, loadout, user, this.state);
  }

  async deletePersistedLoadout(userId, loadoutKey) {
    const user = this.getUser(userId);
    await this.backend.deleteLoadout(userId, loadoutKey, user, this.state);
  }

  async saveSession(token) {
    const session = this.getAccountLinkSession(token);
    await this.backend.saveSession(token, session, this.state);
  }

  async deleteSession(token) {
    await this.backend.deleteSession(token, this.state);
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
    let accountsScrubbed = 0;
    let sessionsDeleted = 0;
    let sessionFieldsRemoved = 0;
    const modifiedUserIds = [];
    const tokensToDelete = [];

    for (const [userId, user] of Object.entries(this.state.users || {})) {
      if (!user || typeof user !== 'object' || !user.account || typeof user.account !== 'object') {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(user.account, 'linkSession')) {
        delete user.account.linkSession;
        modifiedUserIds.push(userId);
        accountsScrubbed += 1;
      }
    }

    const sessions = this.getAccountLinkSessions();
    for (const [token, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') {
        delete sessions[token];
        tokensToDelete.push(token);
        sessionsDeleted += 1;
        continue;
      }

      if (session.status !== 'pending') {
        delete sessions[token];
        tokensToDelete.push(token);
        sessionsDeleted += 1;
        continue;
      }

      for (const field of ['linkUrl', 'callbackUrl', 'provider', 'playerName', 'accountUpdatedAt', 'completedAt']) {
        if (Object.prototype.hasOwnProperty.call(session, field)) {
          delete session[field];
          sessionFieldsRemoved += 1;
        }
      }

      const expiresAt = Date.parse(session.expiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        delete sessions[token];
        tokensToDelete.push(token);
        sessionsDeleted += 1;
      }
    }

    for (const userId of modifiedUserIds) {
      await this.saveUser(userId);
    }
    for (const token of tokensToDelete) {
      await this.deleteSession(token);
    }

    // Session extra fields are not stored in SQLite; flush for JSON backend if that's all that changed.
    if (sessionFieldsRemoved > 0 && modifiedUserIds.length === 0 && tokensToDelete.length === 0) {
      await this.save();
    }

    const changed = accountsScrubbed > 0 || sessionsDeleted > 0 || sessionFieldsRemoved > 0;
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

  getAccountScores(userId) {
    if (this.backendName === 'sqlite' && typeof this.backend.readAccountScores === 'function') {
      return this.backend.readAccountScores(userId);
    }
    const account = this.getAccount(userId);
    return Array.isArray(account?.allScores) ? account.allScores : [];
  }

  getAccountRecentSessions(userId) {
    if (this.backendName === 'sqlite' && typeof this.backend.readAccountRecentSessions === 'function') {
      return this.backend.readAccountRecentSessions(userId);
    }
    const account = this.getAccount(userId);
    return Array.isArray(account?.recentSessions) ? account.recentSessions : [];
  }

  getExportState() {
    const snapshot = JSON.parse(JSON.stringify(this.state));
    for (const [userId, user] of Object.entries(snapshot.users || {})) {
      if (!user?.account) {
        continue;
      }

      const scores = this.getAccountScores(userId);
      if (scores.length) {
        user.account.allScores = scores;
      }

      const recentSessions = this.getAccountRecentSessions(userId);
      if (recentSessions.length) {
        user.account.recentSessions = recentSessions;
      }
    }
    return snapshot;
  }

  getTopPlayCountScores(userId, count = 10) {
    if (this.backendName === 'sqlite' && typeof this.backend.listTopPlayCountScores === 'function') {
      return this.backend.listTopPlayCountScores(userId, count);
    }
    return this.getAccountScores(userId)
      .filter((score) => score?.playCount != null && Number(score.playCount) > 0)
      .sort((a, b) => {
        const playDelta = Number(b.playCount) - Number(a.playCount);
        if (playDelta !== 0) {
          return playDelta;
        }
        return String(a.title || '').localeCompare(String(b.title || ''));
      })
      .slice(0, Math.max(1, Math.min(50, Number(count) || 10)));
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

    await this.saveUser(userId);
    if (this.backendName === 'sqlite' && user.account) {
      delete user.account.allScores;
      delete user.account.recentSessions;
    }
    return user.account;
  }

  async clearAccount(userId) {
    const user = this.getUser(userId);
    const previous = user.account || null;
    user.account = null;
    await this.saveUser(userId);
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
    const tokensToDelete = [];
    let fieldChanges = false;

    for (const [token, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') {
        delete sessions[token];
        tokensToDelete.push(token);
        continue;
      }

      if (session.status !== 'pending') {
        delete sessions[token];
        tokensToDelete.push(token);
        continue;
      }

      for (const field of ['linkUrl', 'callbackUrl', 'provider', 'playerName', 'accountUpdatedAt', 'completedAt']) {
        if (Object.prototype.hasOwnProperty.call(session, field)) {
          delete session[field];
          fieldChanges = true;
        }
      }

      const expiresAt = Date.parse(session.expiresAt || '');
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        delete sessions[token];
        tokensToDelete.push(token);
      }
    }

    for (const token of tokensToDelete) {
      await this.deleteSession(token);
    }

    // Field-only changes affect in-memory state but have no SQLite representation;
    // for the JSON backend we still need to flush the full state.
    if (fieldChanges && tokensToDelete.length === 0) {
      await this.save();
    }
  }

  async createAccountLinkSession(userId, session) {
    const sessions = this.getAccountLinkSessions();
    const now = Date.now();
    const deletedTokens = [];

    for (const [token, existing] of Object.entries(sessions)) {
      if (
        existing &&
        existing.userId === userId &&
        existing.status === 'pending' &&
        Date.parse(existing.expiresAt || '') > now
      ) {
        delete sessions[token];
        deletedTokens.push(token);
      }
    }

    sessions[session.token] = {
      token: session.token,
      userId,
      status: 'pending',
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };

    for (const token of deletedTokens) {
      await this.deleteSession(token);
    }
    await this.saveSession(session.token);
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
    await this.deleteSession(token);
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

    await this.saveLoadout(userId, key);
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
    await this.deletePersistedLoadout(userId, key);
    return removed;
  }

  async addSong(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    const key = normalizeLoadoutName(name);

    if (loadout.songs.includes(id)) {
      throw new Error(`Song ID ${id} is already in \"${loadout.name}\".`);
    }
    if (loadout.songs.length >= this.maxSongsPerLoadout) {
      throw new Error(`\"${loadout.name}\" is full (${this.maxSongsPerLoadout} songs max).`);
    }

    loadout.songs.push(id);
    loadout.updatedAt = new Date().toISOString();
    await this.saveLoadout(userId, key);
    return loadout;
  }

  async removeSong(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    const key = normalizeLoadoutName(name);

    const nextSongs = loadout.songs.filter((value) => value !== id);
    if (nextSongs.length === loadout.songs.length) {
      throw new Error(`Song ID ${id} is not in \"${loadout.name}\".`);
    }

    loadout.songs = nextSongs;
    if (loadout.targets && typeof loadout.targets === 'object') {
      delete loadout.targets[id];
    }
    loadout.updatedAt = new Date().toISOString();
    await this.saveLoadout(userId, key);
    return loadout;
  }

  async setSongs(userId, name, songIds, options = {}) {
    const { createIfMissing = false } = options;
    const normalizedSongs = normalizeSongIds(songIds, this.maxSongsPerLoadout);
    const key = normalizeLoadoutName(name);
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
    await this.saveLoadout(userId, key);
    return loadout;
  }

  async setTargets(userId, name, targets) {
    const loadout = this.getLoadout(userId, name);
    const key = normalizeLoadoutName(name);
    loadout.targets = normalizeLoadoutTargets(targets, loadout.songs);
    loadout.updatedAt = new Date().toISOString();
    await this.saveLoadout(userId, key);
    return loadout;
  }

  async setSongTarget(userId, name, songId, target) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    const key = normalizeLoadoutName(name);
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
    await this.saveLoadout(userId, key);
    return loadout;
  }

  async clearSongTarget(userId, name, songId) {
    const loadout = this.getLoadout(userId, name);
    const id = normalizeSongId(songId);
    const key = normalizeLoadoutName(name);
    if (!loadout.targets || typeof loadout.targets !== 'object' || !loadout.targets[id]) {
      throw new Error(`Song ID ${id} has no target in \"${loadout.name}\".`);
    }

    delete loadout.targets[id];
    loadout.updatedAt = new Date().toISOString();
    await this.saveLoadout(userId, key);
    return loadout;
  }
}
