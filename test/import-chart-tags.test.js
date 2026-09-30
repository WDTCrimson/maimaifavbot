import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { matchManifest, parseArgs, runImport } from '../scripts/import-chart-tags.js';

const catalog = {
  songs: [
    {
      id: 'external-1', title: 'Unique Song', artist: 'Artist',
      difficultyLevels: [{ type: 'dx', difficulty: 'master', internalLevelValue: 13.4 }]
    },
    {
      id: 'duplicate-a', title: 'Duplicate', artist: 'One',
      difficultyLevels: [{ type: 'dx', difficulty: 'master', internalLevelValue: 12.0 }]
    },
    {
      id: 'duplicate-b', title: 'Duplicate', artist: 'Two',
      difficultyLevels: [{ type: 'dx', difficulty: 'master', internalLevelValue: 12.1 }]
    }
  ]
};

test('chart-tag manifest matches by song ID and refuses to guess duplicate titles', () => {
  const manifest = {
    songs: [
      { id: 'external-1', title: 'A different title', charts: [{ type: 'DX', difficulty: 'MASTER', tags: ['トリル'] }] },
      { title: 'Duplicate', charts: [{ type: 'dx', difficulty: 'master', tags: ['乱打'] }] }
    ]
  };
  const result = matchManifest(manifest, catalog);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].tags, ['トリル']);
  assert.equal(result.entries[0].matchedBy, 'song-id');
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].reason, 'ambiguous-song');
});

test('live mai-notes manifest shape resolves song records and numeric tag references', () => {
  const manifest = {
    songs: {
      'mai-notes-song': {
        id: 'mai-notes-song', title: 'Unique Song', artist: 'Artist', type: 'deluxe'
      }
    },
    charts: [{
      id: 'mai-notes-chart', song_id: 'mai-notes-song', difficulty: 'MASTER', tags: [7]
    }],
    tags: [{ id: 7, name: 'トリル' }]
  };
  const result = matchManifest(manifest, catalog);
  assert.equal(result.sourceCharts.length, 1);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].tags, ['トリル']);
  assert.equal(result.entries[0].type, 'dx');
});

test('HTTP 304 keeps the current chart-tag output byte-for-byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maideck-tags-'));
  const catalogFile = join(directory, 'catalog.json');
  const outputFile = join(directory, 'tags.json');
  const reportFile = join(directory, 'report.json');
  const previous = '{"sourceEtag":"etag-1","entries":[{"songId":"song:x"}]}\n';
  await writeFile(catalogFile, JSON.stringify(catalog));
  await writeFile(outputFile, previous);
  const args = { ...parseArgs([]), catalogFile, outputFile, reportFile };
  let requestHeaders;
  const result = await runImport(args, {
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return new Response(null, { status: 304 });
    }
  });
  assert.equal(result.status, 'not-modified');
  assert.equal(requestHeaders['if-none-match'], 'etag-1');
  assert.equal(await readFile(outputFile, 'utf8'), previous);
});

test('an empty prior import bypasses its ETag so it can self-heal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maideck-tags-empty-'));
  const catalogFile = join(directory, 'catalog.json');
  const outputFile = join(directory, 'tags.json');
  const reportFile = join(directory, 'report.json');
  await writeFile(catalogFile, JSON.stringify(catalog));
  await writeFile(outputFile, JSON.stringify({ sourceEtag: 'bad-etag', entries: [] }));
  let requestHeaders;
  await runImport({ ...parseArgs([]), catalogFile, outputFile, reportFile, dryRun: true }, {
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return new Response(JSON.stringify({ charts: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(requestHeaders['if-none-match'], undefined);
});

test('fixture import writes mapped output and an unmatched report without network access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maideck-tags-fixture-'));
  const catalogFile = join(directory, 'catalog.json');
  const sourceFile = join(directory, 'manifest.json');
  const outputFile = join(directory, 'tags.json');
  const reportFile = join(directory, 'report.json');
  await writeFile(catalogFile, JSON.stringify(catalog));
  await writeFile(sourceFile, JSON.stringify({ charts: [
    { songId: 'external-1', type: 'dx', difficulty: 'master', tags: ['トリル'] },
    { title: 'Missing', type: 'dx', difficulty: 'master', tags: ['乱打'] }
  ] }));
  const result = await runImport({ ...parseArgs([]), sourceFile, catalogFile, outputFile, reportFile }, {
    now: () => new Date('2026-09-30T00:00:00.000Z')
  });
  assert.equal(result.mappedCharts, 1);
  assert.equal(result.unmatchedCharts, 1);
  assert.equal(JSON.parse(await readFile(outputFile, 'utf8')).entries[0].tags[0], 'トリル');
  assert.equal(JSON.parse(await readFile(reportFile, 'utf8')).unmatched[0].reason, 'song-not-found');
});
