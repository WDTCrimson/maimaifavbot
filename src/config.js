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
  graphicThemeDir: process.env.GRAPHIC_THEME_DIR?.trim() || resolveDefaultGraphicThemeDir()
};

export const limits = {
  maxSongsPerLoadout: 30,
  maxNameLength: 32
};
