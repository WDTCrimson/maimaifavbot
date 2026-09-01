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
      { playlistId: '101', title: 'KING', artist: 'Kanaria', difficultyLevels: [{ type: 'dx', difficulty: 'master', internalLevelValue: 12.7 }] },
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
    assert.equal(catalog.count, 3);
    const king = catalog.getByFavoriteId('101');
    assert.match(king.songId, /^song:[a-f0-9]{16}$/);
    assert.equal(catalog.getByLegacyFavoriteId('999'), king);
    assert.equal(catalog.getByStoredId(king.songId), king);
    assert.equal(catalog.getByAlias(' KING SONG '), king);
    assert.equal(catalog.getByAlias('ambiguous'), null);
    assert.equal(catalog.getUniqueByNormalizedTitle('king'), null);
    assert.equal(catalog.getByNormalizedTitleArtist('king', 'kanaria'), king);
  });
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
