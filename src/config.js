import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export const config = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  dataFile: process.env.DATA_FILE?.trim() || './data/loadouts.json',
  songCatalogFile: process.env.SONG_CATALOG_FILE?.trim() || './data/import/songs.normalized.json',
  graphicThemeDir: process.env.GRAPHIC_THEME_DIR?.trim() || './data/theme'
};

export const limits = {
  maxSongsPerLoadout: 30,
  maxNameLength: 32
};
