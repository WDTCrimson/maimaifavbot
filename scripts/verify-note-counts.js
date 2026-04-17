import { readFile } from 'node:fs/promises';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim();
}

function songKey(title, artist) {
  return `${normalizeText(title)}::${normalizeText(artist)}`;
}

function sameCount(expected, actual) {
  return (expected ?? null) === (actual ?? null);
}

function isExpectedTouchNormalizationMismatch(expected, actual) {
  return expected == null && actual === 0;
}

async function main() {
  const [normalizedRaw, dxRaw] = await Promise.all([
    readFile('./data/import/songs.normalized.json', 'utf8'),
    readFile('./data/import/sources/dxrating-dxdata.json', 'utf8')
  ]);

  const normalized = JSON.parse(normalizedRaw);
  const dx = JSON.parse(dxRaw);

  const dxByKey = new Map((dx.songs || []).map((song) => [songKey(song.title, song.artist), song]));

  let compared = 0;
  let exactMatches = 0;
  let expectedTouchNormalizations = 0;
  let mismatches = 0;
  const mismatchSamples = [];

  for (const song of normalized.songs || []) {
    const sourceSong = dxByKey.get(songKey(song.title, song.artist));
    if (!sourceSong) {
      continue;
    }

    for (const chart of song.difficultyLevels || []) {
      const sourceSheet = (sourceSong.sheets || []).find(
        (sheet) =>
          normalizeText(sheet.type) === normalizeText(chart.type) &&
          normalizeText(sheet.difficulty) === normalizeText(chart.difficulty) &&
          String(sheet.level || '') === String(chart.level || '')
      );

      if (!sourceSheet?.noteCounts || !chart.noteCounts) {
        continue;
      }

      compared += 1;

      const fields = ['tap', 'hold', 'slide', 'touch', 'break', 'total'];
      const differingFields = fields.filter((field) => !sameCount(sourceSheet.noteCounts[field], chart.noteCounts[field]));

      if (!differingFields.length) {
        exactMatches += 1;
        continue;
      }

      const onlyTouchNormalization =
        differingFields.length === 1 &&
        differingFields[0] === 'touch' &&
        isExpectedTouchNormalizationMismatch(sourceSheet.noteCounts.touch, chart.noteCounts.touch);

      if (onlyTouchNormalization) {
        expectedTouchNormalizations += 1;
        continue;
      }

      mismatches += 1;
      if (mismatchSamples.length < 20) {
        mismatchSamples.push({
          title: song.title,
          artist: song.artist,
          type: chart.type,
          difficulty: chart.difficulty,
          level: chart.level,
          expected: sourceSheet.noteCounts,
          actual: chart.noteCounts,
          differingFields
        });
      }
    }
  }

  const summary = {
    comparedCharts: compared,
    exactMatches,
    expectedTouchNormalizations,
    unexpectedMismatches: mismatches
  };

  console.log(JSON.stringify(summary, null, 2));

  if (mismatchSamples.length) {
    console.log(JSON.stringify({ mismatchSamples }, null, 2));
  }

  if (mismatches > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
