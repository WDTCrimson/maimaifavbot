import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SongCatalog } from '../src/song-catalog.js';

async function fixtureCatalog(run) {
  const directory = await mkdtemp(join(tmpdir(), 'song-catalog-test-'));
  try {
    const songsFile = join(directory, 'songs.json');
    const aliasesFile = join(directory, 'aliases.json');
    const mapFile = join(directory, 'playlist-map.json');
    await writeFile(songsFile, JSON.stringify({ songs: [
      { playlistId: '101', title: 'KING', artist: 'Kanaria', regions: { jp: true, intl: false }, difficultyLevels: [{ type: 'dx', difficulty: 'master', internalLevelValue: 12.7 }] },
      { playlistId: '102', title: 'KING', artist: 'Other', difficultyLevels: [] },
      { playlistId: '103', title: 'World’s End Loneliness', artist: 'xi', difficultyLevels: [] },
      { title: 'Missing ID', artist: 'Nobody', difficultyLevels: [] },
      { playlistId: '104', title: '', artist: 'Nobody', difficultyLevels: [] }
    ] }));
    await writeFile(aliasesFile, JSON.stringify({ entries: [
      { aliases: ['king song'], title: 'KING', artist: 'Kanaria' },
      { alias: 'wel', favoriteId: '103' },
      { alias: 'ambiguous', title: 'KING' }
    ], aliases: { worldend: 'World’s End Loneliness' } }));
    await writeFile(mapFile, JSON.stringify({ entries: { 'king::kanaria': '999' } }));
    const catalog = new SongCatalog(songsFile);
    catalog.aliasFile = aliasesFile;
    catalog.playlistIdMapFile = mapFile;
    await catalog.load();
    await run(catalog);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('catalog loads canonical songs, stable and legacy IDs, and unambiguous aliases', async () => {
  await fixtureCatalog(async (catalog) => {
    assert.equal(catalog.available, true);
    assert.equal(catalog.count, 4);
    const king = catalog.getByFavoriteId('101');
    assert.match(king.songId, /^song:[a-f0-9]{16}$/);
    assert.equal(catalog.getByLegacyFavoriteId('999'), king);
    assert.equal(catalog.getByStoredId(king.songId), king);
    assert.equal(catalog.getByAlias(' KING SONG '), king);
    assert.equal(catalog.getByAlias('ambiguous'), null);
    assert.equal(catalog.getUniqueByNormalizedTitle('king'), null);
    assert.equal(catalog.getByNormalizedTitleArtist('king', 'kanaria'), king);
    assert.deepEqual(king.regions, { jp: true, intl: false, usa: false, cn: false });
    const catalogOnly = catalog.getUniqueByNormalizedTitle('missing id');
    assert.equal(catalogOnly.favoriteId, null);
    assert.match(catalog.autocomplete('missing id', 1)[0].name, /^\[CAT\]/);
  });
});

test('catalog hot reload installs valid changes and keeps the last good catalog on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'song-catalog-reload-'));
  try {
    const songsFile = join(directory, 'songs.json');
    const aliasesFile = join(directory, 'aliases.json');
    const mapFile = join(directory, 'playlist-map.json');
    const song = (id, title) => ({ playlistId: id, title, artist: 'Artist', difficultyLevels: [] });
    await writeFile(songsFile, JSON.stringify({ generatedAt: 'first', songs: [song('1', 'One')] }));
    await writeFile(aliasesFile, JSON.stringify({ entries: [] }));
    await writeFile(mapFile, JSON.stringify({ entries: {} }));

    const catalog = new SongCatalog(songsFile);
    catalog.aliasFile = aliasesFile;
    catalog.playlistIdMapFile = mapFile;
    await catalog.load();
    assert.equal(catalog.count, 1);

    await writeFile(songsFile, JSON.stringify({ generatedAt: 'second', songs: [song('1', 'One'), song('2', 'Two')] }));
    const updated = await catalog.reloadIfChanged();
    assert.equal(updated.reloaded, true);
    assert.equal(catalog.count, 2);
    assert.equal(catalog.generatedAt, 'second');

    await writeFile(aliasesFile, JSON.stringify({ entries: [{ alias: 'deux', title: 'Two' }] }));
    const aliasUpdated = await catalog.reloadIfChanged();
    assert.equal(aliasUpdated.reloaded, true);
    assert.equal(catalog.getByAlias('deux')?.title, 'Two');

    await writeFile(aliasesFile, '{');
    const badAliases = await catalog.reloadIfChanged();
    assert.equal(badAliases.reloaded, false);
    assert.equal(catalog.available, true);
    assert.equal(catalog.getByAlias('deux')?.title, 'Two');

    await writeFile(aliasesFile, JSON.stringify({ entries: [{ alias: 'deux', title: 'Two' }] }));
    await writeFile(songsFile, '{');
    const failed = await catalog.reloadIfChanged();
    assert.equal(failed.reloaded, false);
    assert.equal(catalog.available, true);
    assert.equal(catalog.count, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('catalog search, resolution, autocomplete, caching, and empty queries are deterministic', async () => {
  await fixtureCatalog(async (catalog) => {
    assert.equal(catalog.search('', 2).length, 2);
    assert.equal(catalog.resolveSong('wel').favoriteId, '103');
    assert.equal(catalog.search('worldend', 1)[0].favoriteId, '103');
    const first = catalog.search('kanaria', 10);
    const second = catalog.search('kanaria', 10);
    assert.equal(first, second);
    assert.equal(first[0].favoriteId, '101');
    assert.equal(catalog.autocomplete('king song', 1)[0].value, catalog.getByFavoriteId('101').songId);
  });
});

test('catalog fails closed for malformed or missing source data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'song-catalog-bad-'));
  try {
    const file = join(directory, 'bad.json');
    await writeFile(file, '{');
    const malformed = new SongCatalog(file);
    await malformed.load();
    assert.equal(malformed.available, false);
    assert.throws(() => malformed.search('x'), /unavailable/);

    const missing = new SongCatalog(join(directory, 'missing.json'));
    await missing.ensureReady();
    assert.equal(missing.loaded, true);
    assert.equal(missing.available, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
