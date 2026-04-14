import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OTOGE_MUSIC_EX_URL =
  'https://raw.githubusercontent.com/zvuc/otoge-db/master/maimai/data/music-ex.json';
const OTOGE_MAIMAI_SONGS_URL =
  'https://raw.githubusercontent.com/zvuc/otoge-db/master/maimai/data/maimai_songs.json';
const DXRATING_DATA_URL =
  'https://raw.githubusercontent.com/gekichumai/dxrating/main/packages/dxdata/dxdata.json';
const OTOGE_IMG_LIST_URL =
  'https://api.github.com/repos/zvuc/otoge-db/contents/maimai/img?ref=master';

const OTOGE_JACKET_BASE_URL = 'https://raw.githubusercontent.com/zvuc/otoge-db/master/maimai/jacket';
const DXRATING_COVER_BASE_URL = 'https://shama.dxrating.net/images/cover/v2';

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_RETRIES = 3;

function parseArgs(argv) {
  const args = {
    concurrency: DEFAULT_CONCURRENCY,
    retries: DEFAULT_RETRIES,
    force: false,
    skipJackets: false,
    skipLogos: false,
    skipData: false
  };

  for (const arg of argv) {
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    if (arg === '--skip-jackets') {
      args.skipJackets = true;
      continue;
    }
    if (arg === '--skip-logos') {
      args.skipLogos = true;
      continue;
    }
    if (arg === '--skip-data') {
      args.skipData = true;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        throw new Error('Invalid --concurrency value (must be integer 1-64).');
      }
      args.concurrency = value;
      continue;
    }
    if (arg.startsWith('--retries=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isInteger(value) || value < 0 || value > 10) {
        throw new Error('Invalid --retries value (must be integer 0-10).');
      }
      args.retries = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function fetchWithRetry(url, retries) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'maimai-fav-bot-importer/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const waitMs = 500 * (attempt + 1);
        await wait(waitMs);
      }
    }
  }

  throw lastError;
}

async function fetchJson(url, retries) {
  const response = await fetchWithRetry(url, retries);
  return response.json();
}

async function existsNonEmpty(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
  await rename(tempFile, filePath);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function songMatchKey(title, artist) {
  return `${normalizeText(title)}::${normalizeText(artist)}`;
}

function sanitizeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseInternalLevelValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function getOtogeDifficultySuffix(difficulty) {
  switch (String(difficulty || '').toLowerCase()) {
    case 'basic':
      return 'bas';
    case 'advanced':
      return 'adv';
    case 'expert':
      return 'exp';
    case 'master':
      return 'mas';
    case 'remaster':
      return 'rem';
    default:
      return null;
  }
}

function getOtogeInternalLevelValue(song, type, difficulty) {
  const suffix = getOtogeDifficultySuffix(difficulty);
  if (!suffix) {
    return null;
  }

  const normalizedType = String(type || '').toLowerCase();
  const prefix = normalizedType === 'dx' ? 'dx_' : '';
  return parseInternalLevelValue(song?.[`${prefix}lev_${suffix}_i`]);
}

async function downloadBinary(url, destPath, { force, retries }) {
  if (!force && (await existsNonEmpty(destPath))) {
    return { status: 'skipped', error: null };
  }

  await mkdir(dirname(destPath), { recursive: true });

  try {
    const response = await fetchWithRetry(url, retries);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destPath, buffer);
    return { status: 'downloaded', error: null };
  } catch (error) {
    return { status: 'failed', error: error.message || String(error) };
  }
}

async function processPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index, items.length);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(runner());
  }
  await Promise.all(workers);
  return results;
}

async function downloadAssets({ list, kind, concurrency, force, retries }) {
  const counters = {
    downloaded: 0,
    skipped: 0,
    failed: 0
  };
  const failures = [];

  const startedAt = Date.now();

  await processPool(
    list,
    async (item, index, total) => {
      const result = await downloadBinary(item.url, item.path, { force, retries });
      counters[result.status] += 1;
      if (result.status === 'failed') {
        failures.push({ name: item.name, url: item.url, error: result.error });
      }

      if ((index + 1) % 50 === 0 || index + 1 === total) {
        console.log(
          `[${kind}] ${index + 1}/${total} | downloaded=${counters.downloaded} skipped=${counters.skipped} failed=${counters.failed}`
        );
      }

      return result;
    },
    concurrency
  );

  return {
    ...counters,
    total: list.length,
    failures,
    durationMs: Date.now() - startedAt
  };
}

function buildNormalizedDataset({ otogeMusicEx, dxratingData }) {
  const otogeByKey = new Map();

  for (const song of otogeMusicEx) {
    const key = songMatchKey(song.title, song.artist);
    if (!otogeByKey.has(key)) {
      otogeByKey.set(key, []);
    }
    otogeByKey.get(key).push(song);
  }

  const mergedSongs = [];
  const usedOtogeSortIds = new Set();

  for (const dxSong of dxratingData.songs || []) {
    const key = songMatchKey(dxSong.title, dxSong.artist);
    const matchedOtoge = (otogeByKey.get(key) || []).find((song) => {
      const identifier = String(song.sort || '').trim();
      return identifier && !usedOtogeSortIds.has(identifier);
    });

    if (matchedOtoge?.sort) {
      usedOtogeSortIds.add(String(matchedOtoge.sort));
    }

    mergedSongs.push({
      id: `dx:${dxSong.songId}`,
      sourceSongId: dxSong.songId,
      title: dxSong.title,
      artist: dxSong.artist,
      bpm: dxSong.bpm,
      category: dxSong.category,
      jacket: {
        dxratingFile: `${dxSong.imageName}.jpg`,
        otogeFile: matchedOtoge?.image_url || null
      },
      difficultyLevels: (dxSong.sheets || []).map((sheet) => {
        const otogeInternalLevelValue = matchedOtoge
          ? getOtogeInternalLevelValue(matchedOtoge, sheet.type, sheet.difficulty)
          : null;

        return {
          type: sheet.type,
          difficulty: sheet.difficulty,
          level: sheet.level,
          internalLevelValue: otogeInternalLevelValue ?? sheet.internalLevelValue,
          version: sheet.version,
          releaseDate: sheet.releaseDate || null
        };
      }),
      regions: {
        jp: (dxSong.sheets || []).some((sheet) => Boolean(sheet.regions?.jp)),
        intl: (dxSong.sheets || []).some((sheet) => Boolean(sheet.regions?.intl)),
        usa: (dxSong.sheets || []).some((sheet) => Boolean(sheet.regions?.usa)),
        cn: (dxSong.sheets || []).some((sheet) => Boolean(sheet.regions?.cn))
      },
      linkedOtogeSort: matchedOtoge?.sort || null
    });
  }

  for (const otogeSong of otogeMusicEx) {
    const sortId = String(otogeSong.sort || '').trim();
    if (sortId && usedOtogeSortIds.has(sortId)) {
      continue;
    }

    mergedSongs.push({
      id: `otoge:${sortId || sanitizeFileName(`${otogeSong.title}-${otogeSong.artist}`)}`,
      sourceSongId: sortId || null,
      title: otogeSong.title,
      artist: otogeSong.artist,
      bpm: Number(otogeSong.bpm) || null,
      category: otogeSong.catcode || null,
      jacket: {
        dxratingFile: null,
        otogeFile: otogeSong.image_url || null
      },
      difficultyLevels: [
        {
          type: 'unknown',
          difficulty: 'basic',
          level: otogeSong.lev_bas || null,
          internalLevelValue: parseInternalLevelValue(otogeSong.lev_bas_i)
        },
        {
          type: 'unknown',
          difficulty: 'advanced',
          level: otogeSong.lev_adv || null,
          internalLevelValue: parseInternalLevelValue(otogeSong.lev_adv_i)
        },
        {
          type: 'unknown',
          difficulty: 'expert',
          level: otogeSong.lev_exp || null,
          internalLevelValue: parseInternalLevelValue(otogeSong.lev_exp_i)
        },
        {
          type: 'unknown',
          difficulty: 'master',
          level: otogeSong.lev_mas || null,
          internalLevelValue: parseInternalLevelValue(otogeSong.lev_mas_i)
        },
        {
          type: 'unknown',
          difficulty: 'remaster',
          level: otogeSong.lev_rem || null,
          internalLevelValue: parseInternalLevelValue(otogeSong.lev_rem_i)
        }
      ].filter((item) => item.level),
      regions: {
        jp: true,
        intl: String(otogeSong.intl || '') === '1',
        usa: false,
        cn: false
      },
      linkedOtogeSort: sortId || null
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalSongs: mergedSongs.length,
    songs: mergedSongs
  };
}

function toHumanDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();

  const importDir = join(projectRoot, 'data', 'import');
  const sourceDir = join(importDir, 'sources');
  const normalizedFile = join(importDir, 'songs.normalized.json');
  const reportFile = join(importDir, 'import-report.json');

  const assetDir = join(projectRoot, 'data', 'assets');
  const otogeJacketDir = join(assetDir, 'jacket', 'otoge-db');
  const dxratingJacketDir = join(assetDir, 'jacket', 'dxrating');
  const logoDir = join(assetDir, 'logo', 'otoge-db');

  await mkdir(sourceDir, { recursive: true });
  await mkdir(otogeJacketDir, { recursive: true });
  await mkdir(dxratingJacketDir, { recursive: true });
  await mkdir(logoDir, { recursive: true });

  const startTime = Date.now();

  let otogeMusicEx = null;
  let otogeMaimaiSongs = null;
  let dxratingData = null;

  if (!args.skipData) {
    console.log('Fetching dataset JSON files...');
    [otogeMusicEx, otogeMaimaiSongs, dxratingData] = await Promise.all([
      fetchJson(OTOGE_MUSIC_EX_URL, args.retries),
      fetchJson(OTOGE_MAIMAI_SONGS_URL, args.retries),
      fetchJson(DXRATING_DATA_URL, args.retries)
    ]);

    await Promise.all([
      writeJson(join(sourceDir, 'otoge-music-ex.json'), otogeMusicEx),
      writeJson(join(sourceDir, 'otoge-maimai-songs.json'), otogeMaimaiSongs),
      writeJson(join(sourceDir, 'dxrating-dxdata.json'), dxratingData)
    ]);

    console.log(
      `Saved source datasets: otoge_music_ex=${otogeMusicEx.length}, otoge_maimai_songs=${otogeMaimaiSongs.length}, dxrating_songs=${dxratingData.songs.length}`
    );

    const normalized = buildNormalizedDataset({ otogeMusicEx, dxratingData });
    await writeJson(normalizedFile, normalized);
    console.log(`Saved normalized dataset: ${normalized.totalSongs} songs`);
  } else {
    const [otogeMusicExRaw, dxratingDataRaw] = await Promise.all([
      readFile(join(sourceDir, 'otoge-music-ex.json'), 'utf8'),
      readFile(join(sourceDir, 'dxrating-dxdata.json'), 'utf8')
    ]);
    otogeMusicEx = JSON.parse(otogeMusicExRaw);
    dxratingData = JSON.parse(dxratingDataRaw);
    const normalized = buildNormalizedDataset({ otogeMusicEx, dxratingData });
    await writeJson(normalizedFile, normalized);
    console.log(`Skipped data fetch. Rebuilt normalized dataset from existing source JSON files: ${normalized.totalSongs} songs`);
  }

  let logoReport = { total: 0, downloaded: 0, skipped: 0, failed: 0, failures: [], durationMs: 0 };
  if (!args.skipLogos) {
    console.log('Downloading otoge-db logo/image assets...');
    const logoListResponse = await fetchJson(OTOGE_IMG_LIST_URL, args.retries);
    const logoItems = logoListResponse
      .filter((item) => item.type === 'file' && item.download_url)
      .map((item) => ({
        name: item.name,
        url: item.download_url,
        path: join(logoDir, item.name)
      }));

    logoReport = await downloadAssets({
      list: logoItems,
      kind: 'logos',
      concurrency: args.concurrency,
      force: args.force,
      retries: args.retries
    });
  }

  let jacketReport = {
    otoge: { total: 0, downloaded: 0, skipped: 0, failed: 0, failures: [], durationMs: 0 },
    dxrating: { total: 0, downloaded: 0, skipped: 0, failed: 0, failures: [], durationMs: 0 }
  };

  if (!args.skipJackets) {
    console.log('Downloading otoge-db jackets...');
    const otogeJackets = [...new Set(otogeMusicEx.map((song) => song.image_url).filter(Boolean))].map(
      (fileName) => ({
        name: fileName,
        url: `${OTOGE_JACKET_BASE_URL}/${fileName}`,
        path: join(otogeJacketDir, fileName)
      })
    );

    jacketReport.otoge = await downloadAssets({
      list: otogeJackets,
      kind: 'otoge-jackets',
      concurrency: args.concurrency,
      force: args.force,
      retries: args.retries
    });

    console.log('Downloading dxrating cover jackets...');
    const dxratingJackets = [...new Set((dxratingData.songs || []).map((song) => song.imageName).filter(Boolean))].map(
      (imageName) => ({
        name: `${imageName}.jpg`,
        url: `${DXRATING_COVER_BASE_URL}/${imageName}.jpg`,
        path: join(dxratingJacketDir, `${imageName}.jpg`)
      })
    );

    jacketReport.dxrating = await downloadAssets({
      list: dxratingJackets,
      kind: 'dxrating-covers',
      concurrency: args.concurrency,
      force: args.force,
      retries: args.retries
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    options: args,
    sources: {
      otogeMusicExUrl: OTOGE_MUSIC_EX_URL,
      otogeMaimaiSongsUrl: OTOGE_MAIMAI_SONGS_URL,
      dxratingDataUrl: DXRATING_DATA_URL,
      otogeJacketBaseUrl: OTOGE_JACKET_BASE_URL,
      dxratingCoverBaseUrl: DXRATING_COVER_BASE_URL
    },
    counts: {
      otogeMusicEx: otogeMusicEx.length,
      dxratingSongs: dxratingData.songs?.length || 0,
      dxratingUpdateTime: dxratingData.updateTime || null
    },
    assets: {
      logos: logoReport,
      jackets: jacketReport
    },
    totalDurationMs: Date.now() - startTime
  };

  await writeJson(reportFile, summary);

  console.log('\nImport complete.');
  console.log(`Duration: ${toHumanDuration(summary.totalDurationMs)}`);
  console.log(
    `Logos: downloaded=${logoReport.downloaded}, skipped=${logoReport.skipped}, failed=${logoReport.failed}`
  );
  console.log(
    `Otoge jackets: downloaded=${jacketReport.otoge.downloaded}, skipped=${jacketReport.otoge.skipped}, failed=${jacketReport.otoge.failed}`
  );
  console.log(
    `DXRating covers: downloaded=${jacketReport.dxrating.downloaded}, skipped=${jacketReport.dxrating.skipped}, failed=${jacketReport.dxrating.failed}`
  );
  console.log(`Report: ${reportFile}`);
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exitCode = 1;
});
