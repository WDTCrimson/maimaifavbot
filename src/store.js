import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyPlayCollectionObservation, defaultPlayCollectionState } from './play-collection.js';

const LOADOUT_SCHEMA_VERSION = 2;
const DEFAULT_PROFILE = 'default';
const TIMED_DIFFICULTIES = new Set(['basic', 'advanced', 'expert', 'master', 'remaster']);

function normalizeLoadoutName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeProfileName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function validateProfileName(name, maxProfileNameLength) {
  const value = normalizeProfileName(name);
  if (!value) {
    throw new Error('Profile name cannot be empty.');
  }
  if (value.length > maxProfileNameLength) {
    throw new Error(`Profile name is too long (max ${maxProfileNameLength} chars).`);
  }
  if (!/^[a-z0-9 -]+$/.test(value)) {
    throw new Error('Profile name may only contain letters, numbers, spaces, and hyphens.');
  }
  return value;
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

function buildDefaultUserState() {
  return {
    loadouts: {},
    activeProfile: DEFAULT_PROFILE,
    profiles: { [DEFAULT_PROFILE]: { account: null } }
  };
}

function buildDefaultState() {
  return { users: {}, accountLinkSessions: {}, metadata: buildDefaultMetadata() };
}

function normalizeUserProfiles(user) {
  // Migrate legacy single-account shape into profiles map
  if (!user.profiles || typeof user.profiles !== 'object' || Array.isArray(user.profiles)) {
    const legacyAccount = user.account !== undefined ? user.account : null;
    user.profiles = { [DEFAULT_PROFILE]: { account: legacyAccount || null } };
    delete user.account;
  } else {
    if (!user.profiles[DEFAULT_PROFILE]) {
      user.profiles[DEFAULT_PROFILE] = { account: null };
    }
  }

  if (!user.activeProfile || typeof user.activeProfile !== 'string') {
    user.activeProfile = DEFAULT_PROFILE;
  }

  // Ensure active profile exists
  if (!user.profiles[user.activeProfile]) {
    user.profiles[user.activeProfile] = { account: null };
  }

  for (const profile of Object.values(user.profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    if (!profile.bestTimedPlays || typeof profile.bestTimedPlays !== 'object' || Array.isArray(profile.bestTimedPlays)) {
      profile.bestTimedPlays = {};
    }
    for (const rawPlay of Object.values(profile.recentHistory || {})) {
      updateBestTimedPlayMap(profile.bestTimedPlays, rawPlay);
    }
  }

  return user;
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

  // Normalize each user's profile structure
  for (const [userId, user] of Object.entries(normalized.users)) {
    if (!user || typeof user !== 'object') {
      normalized.users[userId] = buildDefaultUserState();
    } else {
      normalized.users[userId] = normalizeUserProfiles({ ...user });
    }
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

function normalizeTimedChartType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'dx' || normalized === 'deluxe') return 'dx';
  if (normalized === 'std' || normalized === 'sd' || normalized === 'standard') return 'std';
  return null;
}

function normalizeTimedDifficulty(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^re:master$/, 'remaster');
  return TIMED_DIFFICULTIES.has(normalized) ? normalized : null;
}

function normalizeNonNegativeInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizePlayedAtIso(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timedChartKey(titleKey, type, difficulty) {
  return JSON.stringify([titleKey, type, difficulty]);
}

function buildBestTimedPlay(rawPlay, playKey = null, syncedAt = new Date().toISOString()) {
  const play = normalizeAccountRecentEntry(rawPlay);
  if (!play) return null;
  const title = String(play.title || '').normalize('NFKC').trim();
  const titleKey = title;
  const type = normalizeTimedChartType(play.type);
  const difficulty = normalizeTimedDifficulty(play.difficulty);
  const achievement = normalizeNonNegativeInteger(play.achievement);
  const fastCount = normalizeNonNegativeInteger(play?.details?.fastCount);
  const lateCount = normalizeNonNegativeInteger(play?.details?.lateCount);
  const dxScore = normalizeNonNegativeInteger(play.dxScore);
  const playedAtIso = normalizePlayedAtIso(play.playedAtIso || play.playedAt);
  const resolvedPlayKey = playKey || buildRecentPlayKey(play);
  if (!titleKey || !type || !difficulty || achievement == null || fastCount == null || lateCount == null || !playedAtIso || !resolvedPlayKey) {
    return null;
  }
  const favoriteId = String(play.favoriteId || '').trim() || null;
  return {
    title,
    titleKey,
    favoriteId,
    difficulty,
    type,
    achievement,
    dxScore,
    fastCount,
    lateCount,
    playedAtIso,
    playKey: resolvedPlayKey,
    syncedAt: normalizePlayedAtIso(syncedAt) || playedAtIso
  };
}

function compareBestTimedPlays(left, right) {
  if (!right) return 1;
  if (left.achievement !== right.achievement) return left.achievement - right.achievement;
  const leftDx = left.dxScore ?? -1;
  const rightDx = right.dxScore ?? -1;
  if (leftDx !== rightDx) return leftDx - rightDx;
  const timeDifference = Date.parse(left.playedAtIso) - Date.parse(right.playedAtIso);
  if (timeDifference !== 0) return timeDifference;
  return String(left.playKey).localeCompare(String(right.playKey));
}

function updateBestTimedPlayMap(map, rawPlay, playKey = null, syncedAt = new Date().toISOString()) {
  const candidate = buildBestTimedPlay(rawPlay, playKey, syncedAt);
  if (!candidate) return false;
  const key = timedChartKey(candidate.titleKey, candidate.type, candidate.difficulty);
  if (compareBestTimedPlays(candidate, map[key]) <= 0) return false;
  map[key] = candidate;
  return true;
}

export function verifyBestTimedPlayRows(historyRows, actualRows) {
  const expected = new Map();
  let eligible = 0;
  for (const row of historyRows) {
    const candidate = buildBestTimedPlay(parseNullableJson(row.data_json), row.play_key, row.first_seen_at);
    if (!candidate) continue;
    eligible += 1;
    const key = JSON.stringify([
      row.user_id, row.profile_name, candidate.titleKey, candidate.difficulty, candidate.type
    ]);
    if (compareBestTimedPlays(candidate, expected.get(key)?.play) > 0) {
      expected.set(key, { play: candidate });
    }
  }

  const actual = new Map(actualRows.map((row) => [
    JSON.stringify([row.user_id, row.profile_name, row.title_key, row.difficulty, row.chart_type]),
    {
      title: row.title,
      titleKey: row.title_key,
      favoriteId: row.favorite_id,
      difficulty: row.difficulty,
      type: row.chart_type,
      achievement: row.achievement,
      dxScore: row.dx_score,
      fastCount: row.fast_count,
      lateCount: row.late_count,
      playedAtIso: row.played_at_iso,
      playKey: row.play_key,
      syncedAt: row.synced_at
    }
  ]));

  let missing = 0;
  let mismatched = 0;
  for (const [key, value] of expected) {
    const stored = actual.get(key);
    if (!stored) missing += 1;
    else if (JSON.stringify(stored) !== JSON.stringify(value.play)) mismatched += 1;
  }
  let extra = 0;
  for (const key of actual.keys()) {
    if (!expected.has(key)) extra += 1;
  }
  return {
    scanned: historyRows.length,
    eligible,
    expected: expected.size,
    stored: actual.size,
    missing,
    extra,
    mismatched,
    ok: missing === 0 && extra === 0 && mismatched === 0
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

function safeJsonClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildHistorySnapshot(account) {
  const snapshot = safeJsonClone(account || {});
  delete snapshot.linkedAuth;
  delete snapshot.linkSession;
  delete snapshot.allScores;
  delete snapshot.recentSessions;
  return snapshot;
}

function buildSnapshotFingerprint(account, scores) {
  const normalizedScores = (Array.isArray(scores) ? scores : [])
    .map((score) => ({
      songId: score?.songId || score?.favoriteId || null,
      title: score?.title || null,
      difficulty: score?.difficulty || null,
      type: score?.type || score?.chartType || null,
      achievement: score?.achievement ?? null,
      dxScore: score?.dxScore ?? null,
      fc: score?.fc || null,
      fs: score?.fs || null,
      playCount: score?.playCount ?? null,
      rating: score?.rating ?? null
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const payload = {
    player: account?.player?.name || null,
    rating: account?.metrics?.rating ?? null,
    playCount: account?.metrics?.playCount ?? null,
    gameVersion: account?.gameVersion ?? null,
    best50: account?.best50 || null,
    scores: normalizedScores
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildRecentPlayKey(play) {
  const playedAtIso = String(play?.playedAtIso || play?.playedAt || '').trim();
  if (!Number.isFinite(Date.parse(playedAtIso))) return null;
  const signature = {
    playedAtIso,
    title: play?.title || play?.songName || null,
    difficulty: play?.difficulty || null,
    type: play?.type || play?.chartType || null,
    track: play?.track ?? null,
    achievement: play?.achievement ?? null,
    dxScore: play?.dxScore ?? null,
    fc: play?.fc || null,
    fs: play?.fs || null
  };
  return createHash('sha256').update(JSON.stringify(signature)).digest('hex');
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
      const parsed = JSON.parse(raw);
      const normalized = normalizeLoadedState(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await this.saveState(normalized);
      }
      return normalized;
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

  async deleteUserData(_userId, state) {
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
    this.db.pragma('busy_timeout = 5000');
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

      CREATE TABLE IF NOT EXISTS account_profiles (
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        account_json TEXT,
        PRIMARY KEY (user_id, profile_name),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        active_profile TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
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
        profile_name TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_snapshots (
        snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        rating INTEGER,
        play_count INTEGER,
        total_rating INTEGER,
        snapshot_json TEXT NOT NULL,
        scores_json TEXT NOT NULL,
        UNIQUE (user_id, profile_name, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS idx_account_snapshots_user_profile_captured
        ON account_snapshots(user_id, profile_name, captured_at DESC, snapshot_id DESC);

      CREATE TABLE IF NOT EXISTS account_recent_history (
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        play_key TEXT NOT NULL,
        played_at_iso TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (user_id, profile_name, play_key)
      );
      CREATE INDEX IF NOT EXISTS idx_account_recent_history_user_profile_played
        ON account_recent_history(user_id, profile_name, played_at_iso DESC);

      CREATE TABLE IF NOT EXISTS quiet_read_state (
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        history_enabled INTEGER NOT NULL DEFAULT 0,
        quiet_read_at TEXT,
        collection_started_at TEXT,
        last_play_count INTEGER,
        continuous_plays INTEGER NOT NULL DEFAULT 0,
        total_captured_plays INTEGER NOT NULL DEFAULT 0,
        gaps_detected INTEGER NOT NULL DEFAULT 0,
        last_gap_at TEXT,
        backoff_until TEXT,
        lease_until TEXT,
        last_outcome TEXT,
        PRIMARY KEY (user_id, profile_name)
      );

      CREATE TABLE IF NOT EXISTS account_collection_gaps (
        gap_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        previous_play_count INTEGER,
        current_play_count INTEGER,
        newly_captured INTEGER NOT NULL,
        missing_plays INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_account_collection_gaps_user_profile
        ON account_collection_gaps(user_id, profile_name, detected_at DESC);

      CREATE TABLE IF NOT EXISTS account_best_timed_plays (
        user_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        title_key TEXT NOT NULL CHECK (length(title_key) > 0),
        favorite_id TEXT,
        difficulty TEXT NOT NULL
          CHECK (difficulty IN ('basic', 'advanced', 'expert', 'master', 'remaster')),
        chart_type TEXT NOT NULL CHECK (chart_type IN ('std', 'dx')),
        achievement INTEGER NOT NULL CHECK (achievement >= 0),
        dx_score INTEGER CHECK (dx_score IS NULL OR dx_score >= 0),
        fast_count INTEGER NOT NULL CHECK (fast_count >= 0),
        late_count INTEGER NOT NULL CHECK (late_count >= 0),
        played_at_iso TEXT NOT NULL CHECK (length(played_at_iso) > 0),
        play_key TEXT NOT NULL CHECK (length(play_key) = 64),
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, profile_name, title_key, difficulty, chart_type),
        FOREIGN KEY (user_id, profile_name)
          REFERENCES account_profiles(user_id, profile_name) ON DELETE CASCADE
      );
    `);
    this.migrateToProfilesSchema();
    this.backfillBestTimedPlays();
  }

  migrateToProfilesSchema() {
    const sessionColumns = new Set(
      this.db.prepare('PRAGMA table_info(account_link_sessions)').all().map((c) => c.name)
    );
    if (!sessionColumns.has('profile_name')) {
      this.db.exec(`
        ALTER TABLE account_link_sessions ADD COLUMN profile_name TEXT;
        UPDATE account_link_sessions
        SET profile_name = COALESCE(
          (SELECT active_profile FROM user_settings WHERE user_settings.user_id = account_link_sessions.user_id),
          'default'
        )
        WHERE profile_name IS NULL;
      `);
    }

    // Step 1: Rebuild account_score_charts with profile_name if needed
    const scoreColumns = new Set(
      this.db.prepare('PRAGMA table_info(account_score_charts)').all().map((c) => c.name)
    );

    if (!scoreColumns.has('profile_name')) {
      if (scoreColumns.size === 0) {
        // Table doesn't exist yet — create it fresh with profile_name
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS account_score_charts (
            user_id TEXT NOT NULL,
            profile_name TEXT NOT NULL DEFAULT 'default',
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
            PRIMARY KEY (user_id, profile_name, title, difficulty, chart_type),
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_play_count
            ON account_score_charts(user_id, profile_name, play_count DESC);
          CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_title
            ON account_score_charts(user_id, profile_name, title);
        `);
      } else {
        // Existing table without profile_name — rebuild with migration
        this.db.exec(`
          CREATE TABLE account_score_charts_new (
            user_id TEXT NOT NULL,
            profile_name TEXT NOT NULL DEFAULT 'default',
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
            PRIMARY KEY (user_id, profile_name, title, difficulty, chart_type),
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          );
          INSERT INTO account_score_charts_new
            SELECT user_id, 'default', title, difficulty, chart_type, level, achievement,
                   dx_score, max_dx_score, fc, fs, play_count, played_at, rating,
                   internal_level_value, version, favorite_id, song_id, artist,
                   score_unavailable,
                   CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('account_score_charts') WHERE name='score_order')
                        THEN score_order ELSE 0 END,
                   note_counts_json, data_json, synced_at
            FROM account_score_charts;
          DROP TABLE account_score_charts;
          ALTER TABLE account_score_charts_new RENAME TO account_score_charts;
          CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_play_count
            ON account_score_charts(user_id, profile_name, play_count DESC);
          CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_title
            ON account_score_charts(user_id, profile_name, title);
        `);
      }
    } else {
      // Table exists with profile_name — ensure indexes exist
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_play_count
          ON account_score_charts(user_id, profile_name, play_count DESC);
        CREATE INDEX IF NOT EXISTS idx_account_score_charts_user_profile_title
          ON account_score_charts(user_id, profile_name, title);
      `);
    }

    // Step 2: Rebuild account_recent_plays with profile_name if needed
    const recentColumns = new Set(
      this.db.prepare('PRAGMA table_info(account_recent_plays)').all().map((c) => c.name)
    );

    if (!recentColumns.has('profile_name')) {
      if (recentColumns.size === 0) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS account_recent_plays (
            user_id TEXT NOT NULL,
            profile_name TEXT NOT NULL DEFAULT 'default',
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
            PRIMARY KEY (user_id, profile_name, position),
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_account_recent_plays_user_profile_played_at
            ON account_recent_plays(user_id, profile_name, played_at_iso DESC, position ASC);
        `);
      } else {
        this.db.exec(`
          CREATE TABLE account_recent_plays_new (
            user_id TEXT NOT NULL,
            profile_name TEXT NOT NULL DEFAULT 'default',
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
            PRIMARY KEY (user_id, profile_name, position),
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          );
          INSERT INTO account_recent_plays_new
            SELECT user_id, 'default', position, title, difficulty, chart_type, level,
                   achievement, dx_score, max_dx_score, fc, fs, track_number, played_at,
                   played_at_iso, rating, internal_level_value, version, favorite_id,
                   song_id, artist, details_json, note_counts_json, data_json, synced_at
            FROM account_recent_plays;
          DROP TABLE account_recent_plays;
          ALTER TABLE account_recent_plays_new RENAME TO account_recent_plays;
          CREATE INDEX IF NOT EXISTS idx_account_recent_plays_user_profile_played_at
            ON account_recent_plays(user_id, profile_name, played_at_iso DESC, position ASC);
        `);
      }
    } else {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_account_recent_plays_user_profile_played_at
          ON account_recent_plays(user_id, profile_name, played_at_iso DESC, position ASC);
      `);
    }

    // Step 3: Migrate existing users.account_json → account_profiles
    const existingProfiles = this.db.prepare('SELECT COUNT(*) AS count FROM account_profiles').get();
    if (!existingProfiles || existingProfiles.count === 0) {
      const usersWithAccount = this.db
        .prepare('SELECT user_id, account_json FROM users WHERE account_json IS NOT NULL')
        .all();
      if (usersWithAccount.length > 0) {
        const insertProfile = this.db.prepare(
          `INSERT OR IGNORE INTO account_profiles (user_id, profile_name, account_json)
           VALUES (?, 'default', ?)`
        );
        const migrate = this.db.transaction((rows) => {
          for (const row of rows) {
            insertProfile.run(row.user_id, row.account_json);
          }
          this.db.prepare('UPDATE users SET account_json = NULL').run();
        });
        migrate(usersWithAccount);
      }
    }

    this.backfillAccountDataFromJson();
    this.backfillAccountHistoryFromCurrent();
  }

  backfillAccountHistoryFromCurrent() {
    const rows = this.db
      .prepare('SELECT user_id, profile_name, account_json FROM account_profiles WHERE account_json IS NOT NULL')
      .all();
    for (const row of rows) {
      const account = parseNullableJson(row.account_json);
      if (!account) continue;
      const scores = this.readAccountScores(row.user_id, row.profile_name);
      const recent = this.readAccountRecentSessions(row.user_id, row.profile_name);
      this.recordAccountSnapshot(row.user_id, row.profile_name, account, scores);
      this.recordRecentHistory(
        row.user_id,
        row.profile_name,
        recent,
        account.updatedAt || new Date().toISOString()
      );
    }
  }

  backfillAccountDataFromJson() {
    const existingScores = this.db.prepare('SELECT COUNT(*) AS count FROM account_score_charts').get();
    const existingRecent = this.db.prepare('SELECT COUNT(*) AS count FROM account_recent_plays').get();
    const shouldBackfillScores = !existingScores || existingScores.count === 0;
    const shouldBackfillRecent = !existingRecent || existingRecent.count === 0;

    if (!shouldBackfillScores && !shouldBackfillRecent) {
      return;
    }

    const rows = this.db
      .prepare('SELECT user_id, profile_name, account_json FROM account_profiles WHERE account_json IS NOT NULL')
      .all();
    if (!rows.length) {
      return;
    }

    const insertScore = this.prepareInsertAccountScore();
    const insertRecent = this.prepareInsertAccountRecent();
    const updateProfile = this.db.prepare(
      'UPDATE account_profiles SET account_json = ? WHERE user_id = ? AND profile_name = ?'
    );
    const backfill = this.db.transaction((items) => {
      for (const row of items) {
        let account = null;
        try {
          account = JSON.parse(row.account_json);
        } catch {
          continue;
        }
        if (shouldBackfillScores) {
          this.writeAccountScores(
            row.user_id,
            row.profile_name,
            account?.allScores,
            account?.updatedAt || new Date().toISOString(),
            insertScore
          );
        }
        if (shouldBackfillRecent) {
          this.writeAccountRecentSessions(
            row.user_id,
            row.profile_name,
            account?.recentSessions,
            account?.updatedAt || new Date().toISOString(),
            insertRecent
          );
        }
        if (Array.isArray(account?.allScores) || Array.isArray(account?.recentSessions)) {
          updateProfile.run(accountJsonForSqlite(account), row.user_id, row.profile_name);
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
         user_id, profile_name, title, difficulty, chart_type, level, achievement, dx_score, max_dx_score,
         fc, fs, play_count, played_at, rating, internal_level_value, version, favorite_id,
         song_id, artist, score_unavailable, score_order, note_counts_json, data_json, synced_at
       )
       VALUES (
         @userId, @profileName, @title, @difficulty, @type, @level, @achievement, @dxScore, @maxDxScore,
         @fc, @fs, @playCount, @playedAt, @rating, @internalLevelValue, @version, @favoriteId,
         @songId, @artist, @scoreUnavailable, @scoreOrder, @noteCountsJson, @dataJson, @syncedAt
       )
       ON CONFLICT(user_id, profile_name, title, difficulty, chart_type) DO UPDATE SET
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

  writeAccountScores(
    userId,
    profileName,
    scores,
    syncedAt = new Date().toISOString(),
    insertScore = this.prepareInsertAccountScore()
  ) {
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
        profileName,
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

  readAccountScores(userId, profileName) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_score_charts
         WHERE user_id = ? AND profile_name = ?
         ORDER BY score_order ASC, title COLLATE NOCASE, difficulty, chart_type`
      )
      .all(userId, profileName)
      .map(accountScoreFromRow);
  }

  listTopPlayCountScores(userId, profileName, count = 10) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_score_charts
         WHERE user_id = ?
           AND profile_name = ?
           AND play_count IS NOT NULL
           AND play_count > 0
         ORDER BY play_count DESC, title COLLATE NOCASE ASC, difficulty ASC, chart_type ASC
         LIMIT ?`
      )
      .all(userId, profileName, Math.max(1, Math.min(50, Number(count) || 10)))
      .map(accountScoreFromRow);
  }

  prepareInsertAccountRecent() {
    return this.db.prepare(
      `INSERT INTO account_recent_plays (
         user_id, profile_name, position, title, difficulty, chart_type, level, achievement, dx_score,
         max_dx_score, fc, fs, track_number, played_at, played_at_iso, rating,
         internal_level_value, version, favorite_id, song_id, artist, details_json,
         note_counts_json, data_json, synced_at
       )
       VALUES (
         @userId, @profileName, @position, @title, @difficulty, @type, @level, @achievement, @dxScore,
         @maxDxScore, @fc, @fs, @track, @playedAt, @playedAtIso, @rating,
         @internalLevelValue, @version, @favoriteId, @songId, @artist, @detailsJson,
         @noteCountsJson, @dataJson, @syncedAt
       )
       ON CONFLICT(user_id, profile_name, position) DO UPDATE SET
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
    profileName,
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
        profileName,
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

  readAccountRecentSessions(userId, profileName) {
    return this.db
      .prepare(
        `SELECT *
         FROM account_recent_plays
         WHERE user_id = ? AND profile_name = ?
         ORDER BY position ASC`
      )
      .all(userId, profileName)
      .map(accountRecentFromRow);
  }

  recordAccountSnapshot(userId, profileName, account, scores) {
    const capturedAt = account?.sourceFetchedAt || account?.updatedAt || new Date().toISOString();
    const fingerprint = buildSnapshotFingerprint(account, scores);
    const snapshot = buildHistorySnapshot(account);
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO account_snapshots (
         user_id, profile_name, fingerprint, captured_at, rating, play_count,
         total_rating, snapshot_json, scores_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      profileName,
      fingerprint,
      capturedAt,
      account?.metrics?.rating ?? null,
      account?.metrics?.playCount ?? null,
      account?.best50?.totalRating ?? null,
      JSON.stringify(snapshot),
      JSON.stringify(Array.isArray(scores) ? scores : [])
    );
    return result.changes > 0;
  }

  listAccountSnapshots(userId, profileName, limit = 20) {
    return this.db.prepare(
      `SELECT snapshot_id, fingerprint, captured_at, rating, play_count, total_rating,
              snapshot_json
       FROM account_snapshots
       WHERE user_id = ? AND profile_name = ?
       ORDER BY captured_at DESC, snapshot_id DESC
       LIMIT ?`
    ).all(userId, profileName, Math.max(1, Math.min(365, Number(limit) || 20))).map((row) => ({
      id: row.snapshot_id,
      fingerprint: row.fingerprint,
      capturedAt: row.captured_at,
      rating: row.rating,
      playCount: row.play_count,
      totalRating: row.total_rating,
      snapshot: parseNullableJson(row.snapshot_json) || {}
    }));
  }

  readBestTimedPlay(userId, profileName, candidate) {
    const row = this.db.prepare(
      `SELECT title, title_key, favorite_id, difficulty, chart_type, achievement,
              dx_score, fast_count, late_count, played_at_iso, play_key, synced_at
       FROM account_best_timed_plays
       WHERE user_id = ? AND profile_name = ? AND title_key = ?
         AND difficulty = ? AND chart_type = ?`
    ).get(userId, profileName, candidate.titleKey, candidate.difficulty, candidate.type);
    return row ? {
      title: row.title,
      titleKey: row.title_key,
      favoriteId: row.favorite_id,
      difficulty: row.difficulty,
      type: row.chart_type,
      achievement: row.achievement,
      dxScore: row.dx_score,
      fastCount: row.fast_count,
      lateCount: row.late_count,
      playedAtIso: row.played_at_iso,
      playKey: row.play_key,
      syncedAt: row.synced_at
    } : null;
  }

  upsertBestTimedPlay(userId, profileName, candidate) {
    if (!candidate || compareBestTimedPlays(candidate, this.readBestTimedPlay(userId, profileName, candidate)) <= 0) {
      return false;
    }
    this.db.prepare(
      `INSERT INTO account_best_timed_plays (
         user_id, profile_name, title, title_key, favorite_id, difficulty, chart_type,
         achievement, dx_score, fast_count, late_count, played_at_iso, play_key, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, profile_name, title_key, difficulty, chart_type) DO UPDATE SET
         title = excluded.title,
         favorite_id = excluded.favorite_id,
         achievement = excluded.achievement,
         dx_score = excluded.dx_score,
         fast_count = excluded.fast_count,
         late_count = excluded.late_count,
         played_at_iso = excluded.played_at_iso,
         play_key = excluded.play_key,
         synced_at = excluded.synced_at`
    ).run(
      userId, profileName, candidate.title, candidate.titleKey, candidate.favoriteId,
      candidate.difficulty, candidate.type, candidate.achievement, candidate.dxScore,
      candidate.fastCount, candidate.lateCount, candidate.playedAtIso,
      candidate.playKey, candidate.syncedAt
    );
    return true;
  }

  backfillBestTimedPlays() {
    const startedAt = Date.now();
    const rows = this.db.prepare(
      `SELECT h.user_id, h.profile_name, h.play_key, h.first_seen_at, h.data_json
       FROM account_recent_history h
       INNER JOIN account_profiles p
         ON p.user_id = h.user_id AND p.profile_name = h.profile_name
       ORDER BY h.played_at_iso ASC, h.play_key ASC`
    ).all();
    let eligible = 0;
    let updated = 0;
    const backfill = this.db.transaction((historyRows) => {
      for (const row of historyRows) {
        const play = parseNullableJson(row.data_json);
        const candidate = buildBestTimedPlay(play, row.play_key, row.first_seen_at);
        if (!candidate) continue;
        eligible += 1;
        if (this.upsertBestTimedPlay(row.user_id, row.profile_name, candidate)) updated += 1;
      }
    });
    backfill(rows);
    const result = {
      scanned: rows.length,
      eligible,
      updated,
      skipped: rows.length - eligible,
      durationMs: Date.now() - startedAt
    };
    if (updated > 0) console.log(`Best timed play backfill: ${JSON.stringify(result)}`);
    return result;
  }

  listBestTimedPlays(userId, profileName) {
    return this.db.prepare(
      `SELECT title, title_key, favorite_id, difficulty, chart_type, achievement,
              dx_score, fast_count, late_count, played_at_iso, play_key, synced_at
       FROM account_best_timed_plays
       WHERE user_id = ? AND profile_name = ?
       ORDER BY title COLLATE NOCASE, difficulty, chart_type`
    ).all(userId, profileName).map((row) => ({
      title: row.title,
      titleKey: row.title_key,
      favoriteId: row.favorite_id,
      difficulty: row.difficulty,
      type: row.chart_type,
      achievement: row.achievement,
      dxScore: row.dx_score,
      fastCount: row.fast_count,
      lateCount: row.late_count,
      playedAtIso: row.played_at_iso,
      playKey: row.play_key,
      syncedAt: row.synced_at
    }));
  }

  verifyBestTimedPlays() {
    const historyRows = this.db.prepare(
      `SELECT h.user_id, h.profile_name, h.play_key, h.first_seen_at, h.data_json
       FROM account_recent_history h
       INNER JOIN account_profiles p
         ON p.user_id = h.user_id AND p.profile_name = h.profile_name`
    ).all();
    const actualRows = this.db.prepare(
      `SELECT user_id, profile_name, title, title_key, favorite_id, difficulty, chart_type,
              achievement, dx_score, fast_count, late_count, played_at_iso, play_key, synced_at
       FROM account_best_timed_plays`
    ).all();
    return verifyBestTimedPlayRows(historyRows, actualRows);
  }

  recordRecentHistory(userId, profileName, recentSessions, firstSeenAt = new Date().toISOString()) {
    if (!Array.isArray(recentSessions)) return 0;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO account_recent_history (
         user_id, profile_name, play_key, played_at_iso, first_seen_at, data_json
       ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    let written = 0;
    const persist = this.db.transaction((plays) => {
      for (const rawPlay of plays) {
        const play = normalizeAccountRecentEntry(rawPlay);
        const key = buildRecentPlayKey(play);
        if (!play || !key) continue;
        const playedAtIso = String(play.playedAtIso || play.playedAt);
        written += insert.run(
          userId, profileName, key, playedAtIso, firstSeenAt, JSON.stringify(play)
        ).changes;
        const candidate = buildBestTimedPlay(play, key, firstSeenAt);
        if (candidate) this.upsertBestTimedPlay(userId, profileName, candidate);
      }
    });
    persist(recentSessions);
    return written;
  }

  readPlayCollectionState(userId, profileName) {
    const row = this.db.prepare(
      `SELECT history_enabled, quiet_read_at, collection_started_at, last_play_count,
              continuous_plays, total_captured_plays, gaps_detected, last_gap_at,
              backoff_until, lease_until, last_outcome
       FROM quiet_read_state WHERE user_id = ? AND profile_name = ?`
    ).get(userId, profileName);
    if (!row) return defaultPlayCollectionState();
    return {
      historyEnabled: Boolean(row.history_enabled),
      quietReadAt: row.quiet_read_at,
      collectionStartedAt: row.collection_started_at,
      lastPlayCount: row.last_play_count,
      continuousPlays: row.continuous_plays,
      totalCapturedPlays: row.total_captured_plays,
      gapsDetected: row.gaps_detected,
      lastGapAt: row.last_gap_at,
      backoffUntil: row.backoff_until,
      leaseUntil: row.lease_until,
      lastOutcome: row.last_outcome
    };
  }

  writePlayCollectionState(userId, profileName, state) {
    const value = { ...defaultPlayCollectionState(), ...(state || {}) };
    this.db.prepare(
      `INSERT INTO quiet_read_state (
         user_id, profile_name, history_enabled, quiet_read_at, collection_started_at,
         last_play_count, continuous_plays, total_captured_plays, gaps_detected,
         last_gap_at, backoff_until, lease_until, last_outcome
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, profile_name) DO UPDATE SET
         history_enabled = excluded.history_enabled,
         quiet_read_at = excluded.quiet_read_at,
         collection_started_at = excluded.collection_started_at,
         last_play_count = excluded.last_play_count,
         continuous_plays = excluded.continuous_plays,
         total_captured_plays = excluded.total_captured_plays,
         gaps_detected = excluded.gaps_detected,
         last_gap_at = excluded.last_gap_at,
         backoff_until = excluded.backoff_until,
         lease_until = excluded.lease_until,
         last_outcome = excluded.last_outcome`
    ).run(
      userId, profileName, value.historyEnabled ? 1 : 0, value.quietReadAt,
      value.collectionStartedAt, value.lastPlayCount, value.continuousPlays,
      value.totalCapturedPlays, value.gapsDetected, value.lastGapAt,
      value.backoffUntil, value.leaseUntil, value.lastOutcome
    );
    return this.readPlayCollectionState(userId, profileName);
  }

  recordPlayCollectionObservation(userId, profileName, observation) {
    const result = applyPlayCollectionObservation(
      this.readPlayCollectionState(userId, profileName),
      observation
    );
    const persist = this.db.transaction(() => {
      this.writePlayCollectionState(userId, profileName, result.state);
      if (result.gap) {
        this.db.prepare(
          `INSERT INTO account_collection_gaps (
             user_id, profile_name, detected_at, reason, previous_play_count,
             current_play_count, newly_captured, missing_plays
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userId, profileName, result.gap.detectedAt, result.gap.reason,
          result.gap.previousPlayCount, result.gap.currentPlayCount,
          result.gap.newlyCaptured, result.gap.missingPlays
        );
      }
    });
    persist();
    return { ...result, state: this.readPlayCollectionState(userId, profileName) };
  }

  tryAcquireQuietReadLease(userId, profileName, nowIso, leaseUntilIso) {
    const current = this.readPlayCollectionState(userId, profileName);
    this.writePlayCollectionState(userId, profileName, current);
    return this.db.prepare(
      `UPDATE quiet_read_state SET lease_until = ?
       WHERE user_id = ? AND profile_name = ?
         AND (lease_until IS NULL OR lease_until <= ?)`
    ).run(leaseUntilIso, userId, profileName, nowIso).changes === 1;
  }

  recordCollectionGapBackoff(userId, profileName, backoffUntil, outcome) {
    const current = this.readPlayCollectionState(userId, profileName);
    return this.writePlayCollectionState(userId, profileName, {
      ...current,
      backoffUntil,
      leaseUntil: null,
      lastOutcome: outcome
    });
  }

  listRecentHistory(userId, profileName, { date = null, limit = 500 } = {}) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
    const rows = date
      ? this.db.prepare(
          `SELECT data_json FROM account_recent_history
           WHERE user_id = ? AND profile_name = ? AND substr(played_at_iso, 1, 10) = ?
           ORDER BY played_at_iso ASC LIMIT ?`
        ).all(userId, profileName, date, safeLimit)
      : this.db.prepare(
          `SELECT data_json FROM account_recent_history
           WHERE user_id = ? AND profile_name = ?
           ORDER BY played_at_iso DESC LIMIT ?`
        ).all(userId, profileName, safeLimit);
    return rows.map((row) => parseNullableJson(row.data_json)).filter(Boolean);
  }

  listRecentHistoryDates(userId, profileName, limit = 25) {
    return this.db.prepare(
      `SELECT substr(played_at_iso, 1, 10) AS play_date, COUNT(*) AS play_count
       FROM account_recent_history
       WHERE user_id = ? AND profile_name = ?
       GROUP BY play_date
       ORDER BY play_date DESC
       LIMIT ?`
    ).all(userId, profileName, Math.max(1, Math.min(100, Number(limit) || 25))).map((row) => ({
      date: row.play_date,
      playCount: row.play_count
    }));
  }

  deleteAccountHistory(userId, profileName) {
    this.db.prepare('DELETE FROM account_snapshots WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
    this.db.prepare('DELETE FROM account_recent_history WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
    this.db.prepare('DELETE FROM account_best_timed_plays WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
    this.db.prepare('DELETE FROM quiet_read_state WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
    this.db.prepare('DELETE FROM account_collection_gaps WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
  }

  readActiveProfileName(userId) {
    const row = this.db
      .prepare('SELECT active_profile FROM user_settings WHERE user_id = ?')
      .get(userId);
    return row?.active_profile || DEFAULT_PROFILE;
  }

  saveActiveProfileName(userId, profileName) {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, active_profile) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET active_profile = excluded.active_profile`
      )
      .run(userId, profileName);
  }

  readProfileAccount(userId, profileName) {
    const row = this.db
      .prepare('SELECT account_json FROM account_profiles WHERE user_id = ? AND profile_name = ?')
      .get(userId, profileName);
    if (!row) return null;
    return row.account_json ? JSON.parse(row.account_json) : null;
  }

  upsertProfileAccount(userId, profileName, account) {
    // Ensure user row exists first
    this.db
      .prepare('INSERT OR IGNORE INTO users (user_id, account_json) VALUES (?, NULL)')
      .run(userId);
    this.db
      .prepare(
        `INSERT INTO account_profiles (user_id, profile_name, account_json)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, profile_name) DO UPDATE SET account_json = excluded.account_json`
      )
      .run(userId, profileName, accountJsonForSqlite(account));
  }

  listProfiles(userId) {
    return this.db
      .prepare('SELECT profile_name, account_json FROM account_profiles WHERE user_id = ? ORDER BY profile_name')
      .all(userId);
  }

  deleteProfileData(userId, profileName) {
    const deleteScores = this.db.prepare(
      'DELETE FROM account_score_charts WHERE user_id = ? AND profile_name = ?'
    );
    const deleteRecent = this.db.prepare(
      'DELETE FROM account_recent_plays WHERE user_id = ? AND profile_name = ?'
    );
    const deleteProfile = this.db.prepare(
      'DELETE FROM account_profiles WHERE user_id = ? AND profile_name = ?'
    );
    this.db.transaction(() => {
      deleteScores.run(userId, profileName);
      deleteRecent.run(userId, profileName);
      this.deleteAccountHistory(userId, profileName);
      deleteProfile.run(userId, profileName);
    })();
  }

  async maybeImportLegacyJson() {
    if (!this.legacyJsonPath || !this.isEmpty()) {
      return;
    }

    try {
      const raw = await readFile(this.legacyJsonPath, 'utf8');
      const parsed = normalizeLoadedState(JSON.parse(raw));
      await this.saveState(parsed);
      this.backfillAccountHistoryFromCurrent();
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

    const users = this.db.prepare('SELECT user_id FROM users').all();
    for (const row of users) {
      state.users[row.user_id] = {
        loadouts: {},
        activeProfile: this.readActiveProfileName(row.user_id),
        profiles: {}
      };
      for (const profileRow of this.listProfiles(row.user_id)) {
        state.users[row.user_id].profiles[profileRow.profile_name] = {
          account: profileRow.account_json ? JSON.parse(profileRow.account_json) : null
        };
      }
      if (!state.users[row.user_id].profiles[DEFAULT_PROFILE]) {
        state.users[row.user_id].profiles[DEFAULT_PROFILE] = { account: null };
      }
    }

    const loadouts = this.db
      .prepare('SELECT user_id, loadout_key, name, created_at, updated_at FROM loadouts ORDER BY user_id, loadout_key')
      .all();
    for (const row of loadouts) {
      if (!state.users[row.user_id]) {
        state.users[row.user_id] = buildDefaultUserState();
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
      .prepare('SELECT token, user_id, profile_name, status, created_at, expires_at FROM account_link_sessions ORDER BY created_at')
      .all();
    for (const row of sessions) {
      state.accountLinkSessions[row.token] = {
        token: row.token,
        userId: row.user_id,
        profileName: row.profile_name || DEFAULT_PROFILE,
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

    // Collect score/recent data keyed by (userId, profileName) before clearing
    const accountScoresByProfile = new Map();
    const accountRecentByProfile = new Map();

    for (const [userId, user] of Object.entries(normalized.users || {})) {
      const profiles = user?.profiles || {};
      for (const [profileName, profile] of Object.entries(profiles)) {
        const key = `${userId}\0${profileName}`;
        if (!profile?.account) {
          accountScoresByProfile.set(key, []);
          accountRecentByProfile.set(key, []);
        } else if (Object.prototype.hasOwnProperty.call(profile.account, 'allScores')) {
          accountScoresByProfile.set(key, profile.account.allScores);
        } else {
          accountScoresByProfile.set(key, this.readAccountScores(userId, profileName));
        }

        if (profile?.account && Object.prototype.hasOwnProperty.call(profile.account, 'recentSessions')) {
          accountRecentByProfile.set(key, profile.account.recentSessions);
        } else if (profile?.account) {
          accountRecentByProfile.set(key, this.readAccountRecentSessions(userId, profileName));
        }
      }
    }

    const insertMetadata = this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    const insertUser = this.db.prepare('INSERT INTO users (user_id, account_json) VALUES (?, NULL)');
    const insertProfile = this.db.prepare(
      'INSERT INTO account_profiles (user_id, profile_name, account_json) VALUES (?, ?, ?)'
    );
    const insertSettings = this.db.prepare(
      'INSERT INTO user_settings (user_id, active_profile) VALUES (?, ?)'
    );
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
      `INSERT INTO account_link_sessions (
        token, user_id, profile_name, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    );

    const persist = this.db.transaction((snapshot) => {
      this.db.exec(`
        DELETE FROM playlist_targets;
        DELETE FROM playlist_songs;
        DELETE FROM loadouts;
        DELETE FROM account_score_charts;
        DELETE FROM account_recent_plays;
        DELETE FROM account_best_timed_plays;
        DELETE FROM account_profiles;
        DELETE FROM user_settings;
        DELETE FROM users;
        DELETE FROM account_link_sessions;
        DELETE FROM metadata;
      `);

      for (const [key, value] of Object.entries(snapshot.metadata || {})) {
        insertMetadata.run(key, JSON.stringify(value));
      }

      for (const [userId, user] of Object.entries(snapshot.users || {})) {
        insertUser.run(userId);
        const activeProfile = user?.activeProfile || DEFAULT_PROFILE;
        insertSettings.run(userId, activeProfile);

        const profiles = user?.profiles || {};
        for (const [profileName, profile] of Object.entries(profiles)) {
          insertProfile.run(userId, profileName, accountJsonForSqlite(profile?.account));
          const profileKey = `${userId}\0${profileName}`;
          const scores = accountScoresByProfile.get(profileKey) ?? [];
          const recent = accountRecentByProfile.get(profileKey) ?? [];
          const syncedAt = profile?.account?.updatedAt;
          this.writeAccountScores(userId, profileName, scores, syncedAt, insertScore);
          this.writeAccountRecentSessions(userId, profileName, recent, syncedAt, insertRecent);
        }

        const loadouts = user?.loadouts || {};
        for (const [loadoutKey, loadout] of Object.entries(loadouts)) {
          insertLoadout.run(userId, loadoutKey, loadout.name, loadout.createdAt, loadout.updatedAt);

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
          session.profileName || DEFAULT_PROFILE,
          session.status,
          session.createdAt,
          session.expiresAt
        );
      }
    });

    persist(normalized);
    this.backfillBestTimedPlays();
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
    this.db.prepare('INSERT OR IGNORE INTO users (user_id, account_json) VALUES (?, NULL)').run(userId);

    const activeProfile = user?.activeProfile || DEFAULT_PROFILE;
    this.saveActiveProfileName(userId, activeProfile);

    const profiles = user?.profiles || {};
    for (const [profileName, profile] of Object.entries(profiles)) {
      const account = profile?.account || null;
      this.upsertProfileAccount(userId, profileName, account);
      if (!account) {
        this.db.prepare('DELETE FROM account_score_charts WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
        this.db.prepare('DELETE FROM account_recent_plays WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
        this.deleteAccountHistory(userId, profileName);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(account, 'allScores')) {
        this.db.prepare('DELETE FROM account_score_charts WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
        this.writeAccountScores(userId, profileName, account.allScores, account.updatedAt);
      }
      if (Object.prototype.hasOwnProperty.call(account, 'recentSessions')) {
        this.db.prepare('DELETE FROM account_recent_plays WHERE user_id = ? AND profile_name = ?').run(userId, profileName);
        this.writeAccountRecentSessions(userId, profileName, account.recentSessions, account.updatedAt);
      }
    }
  }

  async saveLoadout(userId, loadoutKey, loadout, user) {
    await this.ensureReady();
    const persist = this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO users (user_id, account_json) VALUES (?, NULL)').run(userId);

      this.db
        .prepare(
          `INSERT INTO loadouts (user_id, loadout_key, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, loadout_key) DO UPDATE SET
             name = excluded.name,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`
        )
        .run(userId, loadoutKey, loadout.name, loadout.createdAt, loadout.updatedAt);

      this.db
        .prepare('DELETE FROM playlist_songs WHERE user_id = ? AND loadout_key = ?')
        .run(userId, loadoutKey);
      this.db
        .prepare('DELETE FROM playlist_targets WHERE user_id = ? AND loadout_key = ?')
        .run(userId, loadoutKey);

      const insertSong = this.db.prepare(
        'INSERT INTO playlist_songs (user_id, loadout_key, position, song_id) VALUES (?, ?, ?, ?)'
      );
      for (const [position, songId] of (loadout.songs || []).entries()) {
        insertSong.run(userId, loadoutKey, position, songId);
      }

      const insertTarget = this.db.prepare(
        'INSERT INTO playlist_targets (user_id, loadout_key, song_id, achievement_rate, difficulty, chart_type, combo_flag) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
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
    });

    persist();
  }

  async deleteLoadout(userId, loadoutKey) {
    await this.ensureReady();
    this.db
      .prepare('DELETE FROM loadouts WHERE user_id = ? AND loadout_key = ?')
      .run(userId, loadoutKey);
  }

  async saveSession(token, session) {
    await this.ensureReady();
    this.db
      .prepare(
        `INSERT INTO account_link_sessions (token, user_id, profile_name, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET
           user_id = excluded.user_id,
           profile_name = excluded.profile_name,
           status = excluded.status,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(token, session.userId, session.profileName || DEFAULT_PROFILE, session.status, session.createdAt, session.expiresAt);
  }

  async deleteSession(token) {
    await this.ensureReady();
    this.db.prepare('DELETE FROM account_link_sessions WHERE token = ?').run(token);
  }

  async deleteUserData(userId) {
    await this.ensureReady();
    const tables = [
      'account_link_sessions',
      'account_snapshots',
      'account_recent_history',
      'quiet_read_state',
      'account_collection_gaps',
      'account_best_timed_plays',
      'account_score_charts',
      'account_recent_plays',
      'account_profiles',
      'user_settings',
      'loadouts',
      'users'
    ];
    const remove = this.db.transaction(() => {
      for (const table of tables) {
        this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      }
    });
    remove();
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
    this.maxProfilesPerUser = limits.maxProfilesPerUser ?? 5;
    this.maxProfileNameLength = limits.maxProfileNameLength ?? 16;
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

  async deleteUserData(userId) {
    const target = String(userId);
    const existed = Object.prototype.hasOwnProperty.call(this.state.users || {}, target);
    delete this.state.users[target];

    const sessions = this.getAccountLinkSessions();
    let deletedSessions = 0;
    for (const [token, session] of Object.entries(sessions)) {
      if (String(session?.userId ?? '') !== target) continue;
      delete sessions[token];
      deletedSessions += 1;
    }

    await this.backend.deleteUserData(target, this.state);
    return { existed, deletedSessions };
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
        const migratedSongIds = new Map();

        for (const rawId of loadout.songs) {
          const normalized = normalizeSongId(rawId);
          totalSongs += 1;
          if (/^song:[a-f0-9]{16}$/.test(normalized)) {
            canonicalSongs += 1;
            migratedSongIds.set(normalized, normalized);
            if (!seen.has(normalized)) {
              seen.add(normalized);
              nextSongs.push(normalized);
            }
            continue;
          }

          legacySongs += 1;
          const song = typeof resolveSongByStoredId === 'function' ? resolveSongByStoredId(normalized) : null;
          const migratedId = song?.songId || normalized;
          migratedSongIds.set(normalized, migratedId);
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

        const remappedTargets = Object.fromEntries(
          Object.entries(loadout.targets).map(([songId, target]) => [migratedSongIds.get(songId) || songId, target])
        );
        const normalizedTargets = normalizeLoadoutTargets(remappedTargets, nextSongs);
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
      if (!user || typeof user !== 'object') {
        continue;
      }
      const profiles = user.profiles || {};
      let userModified = false;
      for (const profile of Object.values(profiles)) {
        if (!profile?.account || typeof profile.account !== 'object') {
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(profile.account, 'linkSession')) {
          delete profile.account.linkSession;
          userModified = true;
          accountsScrubbed += 1;
        }
      }
      if (userModified) {
        modifiedUserIds.push(userId);
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
      this.state.users[userId] = buildDefaultUserState();
    } else {
      this.state.users[userId] = normalizeUserProfiles({ ...this.state.users[userId] });
    }
    return this.state.users[userId];
  }

  getAccountLinkSessions() {
    if (!this.state.accountLinkSessions || typeof this.state.accountLinkSessions !== 'object') {
      this.state.accountLinkSessions = {};
    }
    return this.state.accountLinkSessions;
  }

  // ── Profile management ────────────────────────────────────────────────────

  getActiveProfileName(userId) {
    if (this.backendName === 'sqlite') {
      return this.backend.readActiveProfileName(userId);
    }
    const user = this.getUser(userId);
    return user.activeProfile || DEFAULT_PROFILE;
  }

  listUserProfiles(userId) {
    if (this.backendName === 'sqlite') {
      const activeProfile = this.backend.readActiveProfileName(userId);
      const rows = this.backend.listProfiles(userId);
      if (rows.length === 0) {
        return [{ name: DEFAULT_PROFILE, hasAccount: false, playerName: null, linkedAt: null, updatedAt: null, isActive: true }];
      }
      return rows.map((row) => {
        const account = row.account_json ? JSON.parse(row.account_json) : null;
        return {
          name: row.profile_name,
          hasAccount: Boolean(account),
          playerName: account?.player?.name || null,
          linkedAt: account?.linkedAt || null,
          updatedAt: account?.updatedAt || null,
          isActive: row.profile_name === activeProfile
        };
      });
    }

    const user = this.getUser(userId);
    const activeProfile = user.activeProfile || DEFAULT_PROFILE;
    const profiles = user.profiles || {};
    if (Object.keys(profiles).length === 0) {
      return [{ name: DEFAULT_PROFILE, hasAccount: false, playerName: null, linkedAt: null, updatedAt: null, isActive: true }];
    }
    return Object.entries(profiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, profile]) => {
        const account = profile?.account || null;
        return {
          name,
          hasAccount: Boolean(account),
          playerName: account?.player?.name || null,
          linkedAt: account?.linkedAt || null,
          updatedAt: account?.updatedAt || null,
          isActive: name === activeProfile
        };
      });
  }

  async switchActiveProfile(userId, profileName) {
    const normalized = validateProfileName(profileName, this.maxProfileNameLength);
    const user = this.getUser(userId);

    let created = false;
    if (!user.profiles[normalized]) {
      const currentCount = Object.keys(user.profiles).length;
      if (currentCount >= this.maxProfilesPerUser) {
        throw new Error(`You can have at most ${this.maxProfilesPerUser} profiles.`);
      }
      user.profiles[normalized] = { account: null };
      created = true;
    }

    user.activeProfile = normalized;

    if (this.backendName === 'sqlite') {
      this.backend.saveActiveProfileName(userId, normalized);
      if (created) {
        this.backend.upsertProfileAccount(userId, normalized, null);
      }
    } else {
      await this.saveUser(userId);
    }

    return { created };
  }

  async deleteProfile(userId, profileName) {
    const normalized = validateProfileName(profileName, this.maxProfileNameLength);
    const user = this.getUser(userId);
    const profiles = user.profiles || {};
    const allProfileNames = Object.keys(profiles);

    if (allProfileNames.length <= 1) {
      // Only one profile — just clear account data, don't delete slot
      const existing = profiles[normalized]?.account || null;
      if (profiles[normalized]) {
        profiles[normalized].account = null;
        delete profiles[normalized].accountHistory;
        delete profiles[normalized].recentHistory;
        delete profiles[normalized].bestTimedPlays;
      }
      await this.saveUser(userId);

      if (this.backendName === 'sqlite') {
        this.backend.upsertProfileAccount(userId, normalized, null);
        this.backend.db.prepare('DELETE FROM account_score_charts WHERE user_id = ? AND profile_name = ?').run(userId, normalized);
        this.backend.db.prepare('DELETE FROM account_recent_plays WHERE user_id = ? AND profile_name = ?').run(userId, normalized);
      }

      return { deletedSlot: false, wasActive: true, clearedAccount: existing };
    }

    if (!profiles[normalized]) {
      throw new Error(`Profile "${normalized}" was not found.`);
    }

    const wasActive = (user.activeProfile || DEFAULT_PROFILE) === normalized;
    const clearedAccount = profiles[normalized]?.account || null;

    delete profiles[normalized];

    if (wasActive) {
      user.activeProfile = DEFAULT_PROFILE;
    }

    if (this.backendName === 'sqlite') {
      if (wasActive) {
        this.backend.saveActiveProfileName(userId, DEFAULT_PROFILE);
      }
      this.backend.deleteProfileData(userId, normalized);
    } else {
      await this.saveUser(userId);
    }

    return { deletedSlot: true, wasActive, clearedAccount };
  }

  // ── Account access (profile-aware) ───────────────────────────────────────

  getAccount(userId, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite') {
      return this.backend.readProfileAccount(userId, profileName);
    }
    const user = this.getUser(userId);
    return user.profiles?.[profileName]?.account || null;
  }

  getAccountScores(userId, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite' && typeof this.backend.readAccountScores === 'function') {
      return this.backend.readAccountScores(userId, profileName);
    }
    const user = this.getUser(userId);
    const account = user.profiles?.[profileName]?.account;
    return Array.isArray(account?.allScores) ? account.allScores : [];
  }

  getAccountRecentSessions(userId, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite' && typeof this.backend.readAccountRecentSessions === 'function') {
      return this.backend.readAccountRecentSessions(userId, profileName);
    }
    const user = this.getUser(userId);
    const account = user.profiles?.[profileName]?.account;
    return Array.isArray(account?.recentSessions) ? account.recentSessions : [];
  }

  getAccountHistory(userId, limit = 20, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite') {
      return this.backend.listAccountSnapshots(userId, profileName, limit);
    }
    const profile = this.getUser(userId).profiles?.[profileName];
    return (Array.isArray(profile?.accountHistory) ? profile.accountHistory : [])
      .slice()
      .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
      .slice(0, Math.max(1, Math.min(365, Number(limit) || 20)))
      .map(({ scores: _scores, ...entry }) => entry);
  }

  getAccountRecentHistory(userId, options = {}, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite') {
      return this.backend.listRecentHistory(userId, profileName, options);
    }
    const profile = this.getUser(userId).profiles?.[profileName];
    const values = Object.values(profile?.recentHistory || {});
    const filtered = options.date
      ? values.filter((play) => String(play.playedAtIso || play.playedAt || '').slice(0, 10) === options.date)
      : values;
    return filtered
      .sort((a, b) => String(options.date ? a.playedAtIso : b.playedAtIso).localeCompare(String(options.date ? b.playedAtIso : a.playedAtIso)))
      .slice(0, Math.max(1, Math.min(5000, Number(options.limit) || 500)));
  }

  getPlayCollectionStatus(userId, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName !== 'sqlite') {
      return { ...defaultPlayCollectionState(), available: false };
    }
    return {
      ...this.backend.readPlayCollectionState(userId, profileName),
      available: true
    };
  }

  getQuietReadGlobalBackoff() {
    if (this.backendName !== 'sqlite') return null;
    const row = this.backend.db.prepare(
      "SELECT value FROM metadata WHERE key = 'quietReadBackoffUntil'"
    ).get();
    return parseNullableJson(row?.value);
  }

  setQuietReadGlobalBackoff(value) {
    if (this.backendName !== 'sqlite') return;
    this.backend.db.prepare(
      `INSERT INTO metadata (key, value) VALUES ('quietReadBackoffUntil', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(JSON.stringify(value || null));
    this.state.metadata.quietReadBackoffUntil = value || null;
  }

  async setPlayHistoryEnabled(userId, enabled, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName !== 'sqlite') {
      throw new Error('Automatic play-history collection requires DATA_BACKEND=sqlite.');
    }
    const account = this.getAccount(userId, profileName);
    if (!account) throw new Error('Link an account before changing play-history collection.');
    if (enabled && !account.linkedAuth) {
      throw new Error('Re-link this profile with the International web flow before enabling collection.');
    }
    const current = this.backend.readPlayCollectionState(userId, profileName);
    const now = new Date().toISOString();
    return this.backend.writePlayCollectionState(userId, profileName, {
      ...current,
      historyEnabled: Boolean(enabled),
      collectionStartedAt: enabled ? (current.collectionStartedAt || now) : current.collectionStartedAt,
      lastPlayCount: enabled && current.lastPlayCount == null
        ? account?.metrics?.playCount ?? null
        : current.lastPlayCount,
      leaseUntil: enabled ? current.leaseUntil : null,
      lastOutcome: enabled ? current.lastOutcome : 'disabled'
    });
  }

  tryAcquireQuietReadLease(userId, profileName, now = new Date()) {
    if (this.backendName !== 'sqlite') return false;
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    return this.backend.tryAcquireQuietReadLease(userId, profileName, nowIso, leaseUntil);
  }

  recordQuietReadFailure(userId, profileName, outcome, backoffUntil = null) {
    if (this.backendName !== 'sqlite') return null;
    return this.backend.recordCollectionGapBackoff(userId, profileName, backoffUntil, outcome);
  }

  recordQuietPlayCollection(userId, profileName, {
    playCount,
    recentSessions,
    collectedAt = new Date().toISOString()
  }) {
    if (this.backendName !== 'sqlite') {
      throw new Error('Automatic play-history collection requires DATA_BACKEND=sqlite.');
    }
    const written = this.backend.recordRecentHistory(
      userId,
      profileName,
      Array.isArray(recentSessions) ? recentSessions : [],
      collectedAt
    );
    const result = this.backend.recordPlayCollectionObservation(userId, profileName, {
      playCount,
      newlyCaptured: written,
      observedAt: collectedAt,
      quiet: true
    });
    return { written, ...result };
  }

  getAccountBestTimedPlays(userId, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite') {
      return this.backend.listBestTimedPlays(userId, profileName);
    }
    const profile = this.getUser(userId).profiles?.[profileName];
    return Object.values(profile?.bestTimedPlays || {}).map((play) => safeJsonClone(play));
  }

  verifyBestTimedPlays() {
    if (this.backendName !== 'sqlite') {
      throw new Error('Best timed play verification currently requires the SQLite backend.');
    }
    return this.backend.verifyBestTimedPlays();
  }

  getAccountRecentHistoryDates(userId, limit = 25, profileName = this.getActiveProfileName(userId)) {
    if (this.backendName === 'sqlite') {
      return this.backend.listRecentHistoryDates(userId, profileName, limit);
    }
    const counts = new Map();
    for (const play of this.getAccountRecentHistory(userId, { limit: 5000 }, profileName)) {
      const date = String(play.playedAtIso || play.playedAt || '').slice(0, 10);
      if (date) counts.set(date, (counts.get(date) || 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)))
      .map(([date, playCount]) => ({ date, playCount }));
  }

  recordJsonAccountHistory(userId, profileName, account, scores, recentSessions) {
    const profile = this.getUser(userId).profiles[profileName];
    if (!Array.isArray(profile.accountHistory)) profile.accountHistory = [];
    if (!profile.recentHistory || typeof profile.recentHistory !== 'object' || Array.isArray(profile.recentHistory)) {
      profile.recentHistory = {};
    }
    if (!profile.bestTimedPlays || typeof profile.bestTimedPlays !== 'object' || Array.isArray(profile.bestTimedPlays)) {
      profile.bestTimedPlays = {};
    }
    const fingerprint = buildSnapshotFingerprint(account, scores);
    if (!profile.accountHistory.some((entry) => entry.fingerprint === fingerprint)) {
      profile.accountHistory.push({
        id: fingerprint.slice(0, 16),
        fingerprint,
        capturedAt: account?.sourceFetchedAt || account?.updatedAt || new Date().toISOString(),
        rating: account?.metrics?.rating ?? null,
        playCount: account?.metrics?.playCount ?? null,
        totalRating: account?.best50?.totalRating ?? null,
        snapshot: buildHistorySnapshot(account),
        scores: safeJsonClone(Array.isArray(scores) ? scores : [])
      });
    }
    for (const rawPlay of Array.isArray(recentSessions) ? recentSessions : []) {
      const play = normalizeAccountRecentEntry(rawPlay);
      const key = buildRecentPlayKey(play);
      if (play && key && !profile.recentHistory[key]) {
        profile.recentHistory[key] = safeJsonClone(play);
      }
      if (play && key) {
        updateBestTimedPlayMap(profile.bestTimedPlays, play, key, account?.updatedAt);
      }
    }
  }

  getExportState() {
    const snapshot = JSON.parse(JSON.stringify(this.state));
    for (const [userId, user] of Object.entries(snapshot.users || {})) {
      const profiles = user?.profiles || {};
      for (const [profileName, profile] of Object.entries(profiles)) {
        if (!profile?.account) continue;

        const scores = this.getAccountScores(userId, profileName);
        if (scores.length) {
          profile.account.allScores = scores;
        }

        const recentSessions = this.getAccountRecentSessions(userId, profileName);
        if (recentSessions.length) {
          profile.account.recentSessions = recentSessions;
        }
      }
    }
    return snapshot;
  }

  getTopPlayCountScores(userId, count = 10) {
    const profileName = this.getActiveProfileName(userId);
    if (this.backendName === 'sqlite' && typeof this.backend.listTopPlayCountScores === 'function') {
      return this.backend.listTopPlayCountScores(userId, profileName, count);
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

  async setAccountScores(userId, scores) {
    const profileName = this.getActiveProfileName(userId);
    const user = this.getUser(userId);
    const profile = user.profiles?.[profileName];
    if (!profile?.account) {
      return [];
    }
    profile.account.allScores = Array.isArray(scores) ? scores : [];
    await this.saveUser(userId);
    if (this.backendName === 'sqlite' && profile.account) {
      delete profile.account.allScores;
    }
    return this.getAccountScores(userId);
  }

  hasAccount(userId) {
    return Boolean(this.getAccount(userId));
  }

  async setAccount(userId, account, profileName = this.getActiveProfileName(userId)) {
    const user = this.getUser(userId);

    if (!user.profiles[profileName]) {
      user.profiles[profileName] = { account: null };
    }

    const now = new Date().toISOString();
    const previous = user.profiles[profileName].account || null;
    const nextAccount = {
      ...account,
      publicProfile: previous?.publicProfile || null,
      linkedAt: previous?.linkedAt || account.linkedAt || now,
      updatedAt: now
    };
    delete nextAccount.linkSession;

    const historyScores = Array.isArray(account?.allScores)
      ? safeJsonClone(account.allScores)
      : safeJsonClone(this.getAccountScores(userId, profileName));
    const historyRecent = Array.isArray(account?.recentSessions)
      ? safeJsonClone(account.recentSessions)
      : [];

    user.profiles[profileName].account = nextAccount;

    if (this.backendName === 'json') {
      this.recordJsonAccountHistory(userId, profileName, nextAccount, historyScores, historyRecent);
    }

    await this.saveUser(userId);
    if (this.backendName === 'sqlite') {
      this.backend.recordAccountSnapshot(userId, profileName, nextAccount, historyScores);
      const written = this.backend.recordRecentHistory(userId, profileName, historyRecent, nextAccount.updatedAt);
      this.backend.recordPlayCollectionObservation(userId, profileName, {
        playCount: nextAccount?.metrics?.playCount,
        newlyCaptured: written,
        observedAt: nextAccount.sourceFetchedAt || nextAccount.updatedAt,
        quiet: false
      });
    }
    if (this.backendName === 'sqlite' && user.profiles[profileName].account) {
      delete user.profiles[profileName].account.allScores;
      delete user.profiles[profileName].account.recentSessions;
    }
    return user.profiles[profileName].account;
  }

  async enablePublicProfile(userId, profileName = this.getActiveProfileName(userId)) {
    const account = this.getAccount(userId, profileName);
    if (!account) {
      throw new Error('Link an account before enabling a public profile.');
    }
    const now = new Date().toISOString();
    account.publicProfile = {
      id: account.publicProfile?.enabled && account.publicProfile?.id
        ? account.publicProfile.id
        : randomBytes(18).toString('base64url'),
      enabled: true,
      createdAt: account.publicProfile?.createdAt || now,
      updatedAt: now
    };
    const user = this.getUser(userId);
    user.profiles[profileName].account = account;
    await this.saveUser(userId);
    return { ...account.publicProfile };
  }

  async disablePublicProfile(userId, profileName = this.getActiveProfileName(userId)) {
    const account = this.getAccount(userId, profileName);
    if (!account?.publicProfile?.enabled) return false;
    account.publicProfile = null;
    const user = this.getUser(userId);
    user.profiles[profileName].account = account;
    await this.saveUser(userId);
    return true;
  }

  getPublicProfileSettings(userId, profileName = this.getActiveProfileName(userId)) {
    const value = this.getAccount(userId, profileName)?.publicProfile;
    return value?.enabled && value?.id ? { ...value } : null;
  }

  findPublicProfile(publicId) {
    const id = String(publicId || '').trim();
    if (!/^[A-Za-z0-9_-]{24}$/.test(id)) return null;

    if (this.backendName === 'sqlite') {
      const rows = this.backend.db
        .prepare('SELECT user_id, profile_name, account_json FROM account_profiles WHERE account_json IS NOT NULL')
        .all();
      for (const row of rows) {
        const account = JSON.parse(row.account_json);
        if (account?.publicProfile?.enabled && account.publicProfile.id === id) {
          return { userId: row.user_id, profileName: row.profile_name, account };
        }
      }
      return null;
    }

    for (const [userId, user] of Object.entries(this.state.users || {})) {
      for (const [profileName, profile] of Object.entries(user?.profiles || {})) {
        const account = profile?.account;
        if (account?.publicProfile?.enabled && account.publicProfile.id === id) {
          return { userId, profileName, account };
        }
      }
    }
    return null;
  }

  async clearAccount(userId) {
    const profileName = this.getActiveProfileName(userId);
    const user = this.getUser(userId);
    const profile = user.profiles?.[profileName];
    const previous = profile?.account || null;
    if (profile) {
      profile.account = null;
      delete profile.accountHistory;
      delete profile.recentHistory;
      delete profile.bestTimedPlays;
    }
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
      profileName: session.profileName || this.getActiveProfileName(userId),
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
      profileName: session.profileName || DEFAULT_PROFILE,
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
      throw new Error(`Loadout "${name}" was not found.`);
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
      throw new Error(`Loadout "${displayName}" already exists.`);
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
      throw new Error(`Loadout "${name}" was not found.`);
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
      throw new Error(`Song ID ${id} is already in "${loadout.name}".`);
    }
    if (loadout.songs.length >= this.maxSongsPerLoadout) {
      throw new Error(`"${loadout.name}" is full (${this.maxSongsPerLoadout} songs max).`);
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
      throw new Error(`Song ID ${id} is not in "${loadout.name}".`);
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
      throw new Error(`Song ID ${id} is not in "${loadout.name}".`);
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
      throw new Error(`Song ID ${id} has no target in "${loadout.name}".`);
    }

    delete loadout.targets[id];
    loadout.updatedAt = new Date().toISOString();
    await this.saveLoadout(userId, key);
    return loadout;
  }
}
