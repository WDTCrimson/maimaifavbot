import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function normalizeLoadoutName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSongId(songId) {
  const value = String(songId).trim();
  if (!/^\d{1,8}$/.test(value)) {
    throw new Error('Song ID must be numeric (1-8 digits).');
  }
  return value;
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

export class LoadoutStore {
  constructor(filePath, limits) {
    this.filePath = filePath;
    this.maxSongsPerLoadout = limits.maxSongsPerLoadout;
    this.maxNameLength = limits.maxNameLength;
    this.loaded = false;
    this.state = { users: {} };
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

  getUser(userId) {
    if (!this.state.users[userId]) {
      this.state.users[userId] = { loadouts: {} };
    }
    return this.state.users[userId];
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
}
