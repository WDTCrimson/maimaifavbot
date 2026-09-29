import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateMissingAliases, sanitizeAliases } from '../src/alias-generator.js';
import { SongCatalog } from '../src/song-catalog.js';

async function withCatalog(run) {
  const directory = await mkdtemp(join(tmpdir(), 'alias-generator-test-'));
  try {
    const songsFile = join(directory, 'songs.json');
    await writeFile(songsFile, JSON.stringify({ songs: [
      { title: '雑魚', artist: 'A', difficultyLevels: [] },
      { title: 'ツムギボシ', artist: 'B', difficultyLevels: [] },
      { title: 'アンビバレンス', artist: 'C', difficultyLevels: [] },
      { title: '[奏]雑魚', artist: 'A', difficultyLevels: [] },
      { title: 'KING', artist: 'D', difficultyLevels: [] }
    ] }));
    await writeFile(join(directory, 'aliases.json'), JSON.stringify({ entries: [
      { title: 'アンビバレンス', aliases: ['ambivalence'] }
    ] }));
    const catalog = new SongCatalog(songsFile);
    catalog.aliasFile = join(directory, 'aliases.json');
    catalog.curatedAliasFile = join(directory, 'curated.json');
    catalog.generatedAliasFile = join(directory, 'generated.json');
    await catalog.load();
    await run(catalog, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fakeQwen(calls, reply) {
  return async (url, options) => {
    const prompt = JSON.parse(options.body).messages[1].content;
    calls.push(prompt);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply(prompt)) } }] }) };
  };
}

test('sanitizeAliases keeps short lowercase ASCII aliases only', () => {
  const song = { normTitle: 'zako' };
  assert.deepEqual(sanitizeAliases(['Zako', 'zako', '雑魚', 'small fry', '', 'x'.repeat(81), 'a', 'b'], song), ['small fry', 'a', 'b']);
});

test('generator asks Qwen once per song missing aliases and the catalog picks them up', async () => {
  await withCatalog(async (catalog, directory) => {
    const config = { dashscopeApiKey: 'test', qwenBaseUrl: 'https://qwen.test/v1', qwenModel: 'm', outputFile: join(directory, 'generated.json'), maxCalls: 3, timeoutMs: 1000 };
    const calls = [];
    const fetchImpl = fakeQwen(calls, () => ({ songs: [
      { id: 0, aliases: ['tsumugiboshi'] },
      { id: 1, aliases: ['Zako', 'small fry'] }
    ] }));

    const summary = await generateMissingAliases({ songCatalog: catalog, config, fetchImpl, now: () => new Date('2026-09-29T00:00:00Z') });
    assert.deepEqual(summary, { pending: 2, checked: 2, aliased: 2, calls: 1, skipped: null });
    assert.match(calls[0], /ツムギボシ/);
    assert.match(calls[0], /雑魚/);
    assert.doesNotMatch(calls[0], /アンビバレンス|KING|\[奏\]/);

    const written = JSON.parse(await readFile(config.outputFile, 'utf8'));
    assert.deepEqual(written.entries.map((entry) => entry.aliases), [['tsumugiboshi'], ['zako', 'small fry']]);

    await catalog.load();
    assert.equal(catalog.search('small fry', 1)[0].title, '雑魚');

    const again = await generateMissingAliases({ songCatalog: catalog, config, fetchImpl });
    assert.equal(again.pending, 0);
    assert.equal(calls.length, 1);
  });
});

test('generator records empty answers as checked and skips without an API key', async () => {
  await withCatalog(async (catalog, directory) => {
    const outputFile = join(directory, 'generated.json');
    const noKey = await generateMissingAliases({ songCatalog: catalog, config: { dashscopeApiKey: '', outputFile, maxCalls: 3 } });
    assert.equal(noKey.skipped, 'DASHSCOPE_API_KEY is not set');

    const calls = [];
    const config = { dashscopeApiKey: 'test', qwenBaseUrl: 'https://qwen.test/v1', qwenModel: 'm', outputFile, maxCalls: 3, timeoutMs: 1000 };
    await generateMissingAliases({ songCatalog: catalog, config, fetchImpl: fakeQwen(calls, () => ({ songs: [] })) });
    const second = await generateMissingAliases({ songCatalog: catalog, config, fetchImpl: fakeQwen(calls, () => ({ songs: [] })) });
    assert.equal(second.pending, 0);
    assert.equal(calls.length, 1);
  });
});

test('generator surfaces Qwen HTTP failures without writing a file', async () => {
  await withCatalog(async (catalog, directory) => {
    const config = { dashscopeApiKey: 'test', qwenBaseUrl: 'https://qwen.test/v1', qwenModel: 'm', outputFile: join(directory, 'generated.json'), maxCalls: 3, timeoutMs: 1000 };
    await assert.rejects(
      generateMissingAliases({ songCatalog: catalog, config, fetchImpl: async () => ({ ok: false, status: 503 }) }),
      /HTTP 503/
    );
    await assert.rejects(readFile(config.outputFile, 'utf8'), { code: 'ENOENT' });
  });
});
