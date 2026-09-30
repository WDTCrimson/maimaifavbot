import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function value(name) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
}

function positiveInteger(name, fallback) {
  const raw = value(name);
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }
  return parsed;
}

function booleanValue(name, fallback = false) {
  const raw = value(name);
  if (raw == null) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`Environment variable ${name} must be true or false.`);
}

const dataBackend = value('DATA_BACKEND')?.toLowerCase() || 'json';
if (!['json', 'sqlite'].includes(dataBackend)) {
  throw new Error('Environment variable DATA_BACKEND must be either "json" or "sqlite".');
}
const sharedSecret = value('ACCOUNT_LINK_SHARED_SECRET');
const signingSecret = value('ACCOUNT_LINK_SIGNING_SECRET') || sharedSecret;
const explicitDataSecret = value('ACCOUNT_LINK_DATA_SECRET');

export const accountSyncConfig = {
  dataBackend,
  dataFile: value('DATA_FILE') || './data/loadouts.json',
  sqliteFile: value('SQLITE_FILE') || './data/loadouts.sqlite',
  songCatalogFile: value('SONG_CATALOG_FILE') || './data/import/songs.normalized.json',
  songAliasFile: value('SONG_ALIAS_FILE') || './data/reference/song-aliases.json',
  accountLinkDataSecret: explicitDataSecret || sharedSecret,
  accountLinkDataSecretDedicated: Boolean(
    explicitDataSecret && explicitDataSecret !== signingSecret && explicitDataSecret !== sharedSecret
  ),
  quietReadsEnabled: booleanValue('QUIET_READS_ENABLED', false),
  quietReadMinIntervalHours: Math.max(20, positiveInteger('QUIET_READ_MIN_INTERVAL_H', 20)),
  quietReadMaxAccountsPerRun: Math.min(2, positiveInteger('QUIET_READ_MAX_ACCOUNTS', 2))
};

export const accountSyncLimits = {
  maxSongsPerLoadout: 30,
  maxNameLength: 32,
  maxProfilesPerUser: 5,
  maxProfileNameLength: 16
};
