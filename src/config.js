import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

dotenv.config();

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
  dataFile: process.env.DATA_FILE?.trim() || './data/loadouts.json',
  songCatalogFile: process.env.SONG_CATALOG_FILE?.trim() || './data/import/songs.normalized.json',
  recommendationFile:
    process.env.RECOMMENDATION_FILE?.trim() || './data/recommendations/community.json',
  graphicThemeDir: process.env.GRAPHIC_THEME_DIR?.trim() || resolveDefaultGraphicThemeDir(),
  accountLinkBaseUrl: optionalEnv('ACCOUNT_LINK_BASE_URL'),
  accountLinkCallbackPublicUrl: optionalEnv('ACCOUNT_LINK_CALLBACK_PUBLIC_URL'),
  accountLinkCallbackBind: optionalEnv('ACCOUNT_LINK_CALLBACK_BIND') || '127.0.0.1',
  accountLinkCallbackPort: parseOptionalInteger('ACCOUNT_LINK_CALLBACK_PORT'),
  accountLinkSharedSecret: optionalEnv('ACCOUNT_LINK_SHARED_SECRET'),
  accountLinkTtlMinutes: parseOptionalInteger('ACCOUNT_LINK_TTL_MINUTES', 15)
};

export const limits = {
  maxSongsPerLoadout: 30,
  maxNameLength: 32
};
