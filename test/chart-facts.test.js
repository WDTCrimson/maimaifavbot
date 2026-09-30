import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChartFacts } from '../src/chart-facts.js';

test('missing chart-tag file produces empty results and an honest availability message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maideck-facts-missing-'));
  const reportFile = join(directory, 'report.json');
  await writeFile(reportFile, JSON.stringify({ generatedAt: '2026-09-29T12:00:00.000Z' }));
  const facts = new ChartFacts({ tagsFile: join(directory, 'missing.json'), labelsFile: join(directory, 'labels.json'), reportFile });
  await facts.ensureReady();
  assert.equal(facts.available, false);
  assert.deepEqual(facts.tagsFor({ songId: 'song:none', type: 'dx', difficulty: 'master' }), []);
  assert.deepEqual(facts.chartsWithTag('トリル'), []);
  assert.match(facts.unavailableMessage(), /last import: 2026-09-29/);
});

test('tag autocomplete deduplicates results and matches English, Japanese, and romaji', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maideck-facts-'));
  const tagsFile = join(directory, 'tags.json');
  const labelsFile = join(directory, 'labels.json');
  await writeFile(tagsFile, JSON.stringify({ entries: [
    { songId: 'song:0000000000000001', type: 'dx', difficulty: 'master', tags: ['トリル'] },
    { songId: 'song:0000000000000002', type: 'dx', difficulty: 'master', tags: ['トリル'] }
  ] }));
  await writeFile(labelsFile, JSON.stringify({ 'トリル': { en: 'Trill', group: 'tap' } }));
  const facts = new ChartFacts({ tagsFile, labelsFile, reportFile: join(directory, 'report.json') });
  await facts.ensureReady();
  for (const query of ['trill', 'トリル', 'toriru']) {
    assert.deepEqual(facts.autocomplete(query), [{ name: 'Trill (トリル)', value: 'トリル' }]);
  }
  const songs = new Map([1, 2].map((number) => {
    const songId = `song:${String(number).padStart(16, '0')}`;
    return [songId, {
      songId,
      title: `Song ${number}`,
      difficultyLevels: [{ type: 'dx', difficulty: 'master', level: '13', internalLevelValue: 13 + number / 10 }]
    }];
  }));
  const charts = facts.chartsWithTag('トリル', { songCatalog: { getBySongId: (songId) => songs.get(songId) || null } });
  assert.deepEqual(charts.map((entry) => entry.song.title), ['Song 1', 'Song 2']);
});
