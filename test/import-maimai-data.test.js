import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNormalizedDataset } from '../scripts/import-maimai-data.js';

test('maimai importer truncates shared constant history at the current International release', () => {
  const dataset = buildNormalizedDataset({
    otogeMusicEx: [],
    dxratingData: {
      versions: [
        { version: 'maimaiでらっくす PLUS' },
        { version: 'Splash' },
        { version: 'CiRCLE PLUS' },
        { version: 'MAGiCAL' }
      ],
      songs: [{
        songId: 'MYTHOS', title: 'MYTHOS', artist: 'Cranky', sheets: [{
          type: 'std', difficulty: 'master', level: '14', internalLevelValue: 14.4,
          regions: { jp: true, intl: true },
          regionOverrides: { intl: { level: '14', levelValue: 14.1 } },
          multiverInternalLevelValue: {
            Splash: 14.1,
            'maimaiでらっくす PLUS': 13.9,
            'CiRCLE PLUS': 14.2,
            MAGiCAL: 14.4
          }
        }]
      }]
    },
    currentIntlVersionId: 13
  });

  const chart = dataset.songs[0].difficultyLevels[0];
  assert.deepEqual(chart.regionalLevels, {
    jp: { level: '14', internalLevelValue: 14.4 },
    intl: { level: '14', internalLevelValue: 14.1 }
  });
  assert.deepEqual(chart.internalLevelHistory, {
    region: 'intl',
    entries: [
      { version: 'maimaiでらっくす PLUS', internalLevelValue: 13.9 },
      { version: 'Splash', internalLevelValue: 14.1 },
      { version: 'CiRCLE PLUS', internalLevelValue: 14.1 }
    ]
  });
});
