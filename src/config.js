import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

dotenv.config({ quiet: true });

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    return null;
  }
  return value.trim();
}

function parseOptionalInteger(name, fallback = null) {
  const value = optionalEnv(name);
  if (value == null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }

  return parsed;
}

function parseDataBackend() {
  const value = process.env.DATA_BACKEND?.trim().toLowerCase() || 'json';
  if (value !== 'json' && value !== 'sqlite') {
    throw new Error('Environment variable DATA_BACKEND must be either "json" or "sqlite".');
  }
  return value;
}

function resolveDefaultGraphicThemeDir() {
  const tomomaiThemeDir = './data/theme/tomomai';
  if (existsSync(tomomaiThemeDir)) {
    return tomomaiThemeDir;
  }
  return './data/theme';
}

export const config = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  dataBackend: parseDataBackend(),
  dataFile: process.env.DATA_FILE?.trim() || './data/loadouts.json',
  sqliteFile: process.env.SQLITE_FILE?.trim() || './data/loadouts.sqlite',
  usageLogDir: process.env.USAGE_LOG_DIR?.trim() || './logs',
  songCatalogFile: process.env.SONG_CATALOG_FILE?.trim() || './data/import/songs.normalized.json',
  songAliasFile: process.env.SONG_ALIAS_FILE?.trim() || './data/reference/song-aliases.json',
  recommendationFile:
    process.env.RECOMMENDATION_FILE?.trim() || './data/recommendations/community.json',
  graphicThemeDir: process.env.GRAPHIC_THEME_DIR?.trim() || resolveDefaultGraphicThemeDir(),
  accountLinkBaseUrl: optionalEnv('ACCOUNT_LINK_BASE_URL'),
  accountLinkClientId: optionalEnv('ACCOUNT_LINK_CLIENT_ID'),
  accountLinkCallbackPublicUrl: optionalEnv('ACCOUNT_LINK_CALLBACK_PUBLIC_URL'),
  accountLinkCallbackBind: optionalEnv('ACCOUNT_LINK_CALLBACK_BIND') || '127.0.0.1',
  accountLinkCallbackPort: parseOptionalInteger('ACCOUNT_LINK_CALLBACK_PORT'),
  accountLinkSharedSecret: optionalEnv('ACCOUNT_LINK_SHARED_SECRET'),
  accountLinkSigningSecret:
    optionalEnv('ACCOUNT_LINK_SIGNING_SECRET') || optionalEnv('ACCOUNT_LINK_SHARED_SECRET'),
  accountLinkDataSecret:
    optionalEnv('ACCOUNT_LINK_DATA_SECRET') || optionalEnv('ACCOUNT_LINK_SHARED_SECRET'),
  accountLinkTtlMinutes: parseOptionalInteger('ACCOUNT_LINK_TTL_MINUTES', 15),
  accountPublicBaseUrl: optionalEnv('ACCOUNT_PUBLIC_BASE_URL')
};

export const limits = {
  maxSongsPerLoadout: 30,
  maxNameLength: 32,
  maxProfilesPerUser: 5,
  maxProfileNameLength: 16
};
