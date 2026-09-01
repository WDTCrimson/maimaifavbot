import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecommendationCatalog } from '../src/recommendation-catalog.js';
import { canonicalChartKey, sha256, stableJson, validateCandidateV1, validateCatalogV2 } from '../src/recommendation-schema.js';

const song = {
  songId: 'song:0000000000000001', title: 'Test', artist: 'Artist',
  difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '12+', internalLevelValue: 12.7 }]
};
const songCatalog = { available: true, getBySongId(id) { return id === song.songId ? song : null; } };

function document(summary = 'A useful technical chart.') {
  const timestamp = '2026-08-27T00:00:00.000Z';
  return {
    schemaVersion: 2, generatedAt: timestamp,
    entries: [{
      key: canonicalChartKey(song.songId, 'dx', 'master'), songId: song.songId,
      chart: { type: 'dx', difficulty: 'master' }, summary, tags: ['tech'], evidenceWeight: 0.8,
      firstSeenAt: timestamp, lastSeenAt: timestamp,
      evidence: [{ source: 'manual', sourceId: 'manual:test', candidateId: null, threadId: null, url: null, createdAt: null, observedScore: null, status: 'active', lastCheckedAt: timestamp }]
    }]
  };
}

test('catalog v2 rejects unknown properties and invalid canonical keys', () => {
  assert.throws(() => validateCatalogV2({ ...document(), surprise: true }), /not allowed/);
  const invalid = document();
  invalid.entries[0].key = 'wrong';
  assert.throws(() => validateCatalogV2(invalid), /must equal/);
});

test('hash reload swaps valid data and preserves last good data after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recommendation-catalog-'));
  const file = join(directory, 'catalog.json');
  try {
    await writeFile(file, JSON.stringify(document('First')));
    const catalog = new RecommendationCatalog(file, songCatalog);
    assert.equal(await catalog.load(), true);
    const firstHash = catalog.contentHash;
    assert.equal(catalog.entries[0].summary, 'First');
    await writeFile(file, JSON.stringify(document('Second')));
    const changed = await catalog.reloadIfChanged();
    assert.equal(changed.reloaded, true);
    assert.notEqual(catalog.contentHash, firstHash);
    assert.equal(catalog.entries[0].summary, 'Second');
    const goodHash = catalog.contentHash;
    await writeFile(file, '{bad json');
    const failed = await catalog.reloadIfChanged();
    assert.equal(failed.reloaded, false);
    assert.equal(catalog.available, true);
    assert.equal(catalog.contentHash, goodHash);
    assert.equal(catalog.entries[0].summary, 'Second');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stable JSON and SHA helpers are deterministic across object key order', () => {
  assert.equal(stableJson({ b: 2, a: [1, { d: 4, c: 3 }] }), stableJson({ a: [1, { c: 3, d: 4 }], b: 2 }));
  assert.equal(sha256('same'), sha256('same'));
  assert.notEqual(sha256('same'), sha256('different'));
});

test('candidate v1 validates strict Reddit provenance and rejects unsafe variants', () => {
  const hash = sha256('fixture');
  const candidate = {
    schemaVersion: 1, candidateId: hash, supersedes: null, source: 'reddit', sourceId: 't3_test',
    threadId: 't3_test', url: 'https://www.reddit.com/r/maimai/comments/test/example/',
    titleHint: 'KING', artistHint: null, chartType: 'dx', difficulty: 'master', stance: 'positive',
    rationale: 'A technical recommendation.', tags: ['tech'], confidence: 0.9,
    promptVersion: 'v1', model: 'qwen', contentHash: hash
  };
  assert.equal(validateCandidateV1(candidate).candidateId, hash);
  assert.throws(() => validateCandidateV1({ ...candidate, extra: true }), /not allowed/);
  assert.throws(() => validateCandidateV1({ ...candidate, url: 'https://evil.example/r/maimai/' }), /must belong/);
  assert.throws(() => validateCandidateV1({ ...candidate, confidence: Number.NaN }), /finite number/);
  assert.throws(() => validateCandidateV1({ ...candidate, tags: ['tech', 'tech'] }), /unique/);
});
