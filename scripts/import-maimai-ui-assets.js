import { mkdir, access, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname } from 'node:path';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const GITHUB_RAW = 'https://raw.githubusercontent.com';

const VERSION_NAMES = [
  'buddies', 'buddies_plus',
  'circle', 'circle_plus',
  'festival', 'festival_plus',
  'finale',
  'green', 'green_plus',
  'maimai', 'maimai_plus',
  'maimai_deluxe', 'maimai_deluxe_plus',
  'milk', 'milk_plus',
  'murasaki', 'murasaki_plus',
  'orange', 'orange_plus',
  'pink', 'pink_plus',
  'prism', 'prism_plus',
  'splash', 'splash_plus',
  'universe', 'universe_plus',
];

const VERSION_URL_MAP = {
  maimai_deluxe: 'maimai%E3%81%A7%E3%82%89%E3%81%A3%E3%81%8F%E3%81%99',
  maimai_deluxe_plus: 'maimai%E3%81%A7%E3%82%89%E3%81%A3%E3%81%8F%E3%81%99_plus',
};

const DANI_COUNT = 24;
const CATEGORY_NAMES = ['chugeki', 'niconico', 'original', 'popsanime', 'touhou', 'variety'];

const PORTRAIT_SPLASH_BASE =
  `${GITHUB_RAW}/Matsuk1/JiETNG-maimai-dx-bot/main/assets/versions`;

const MAIMAI_BOT_BASE =
  `${GITHUB_RAW}/xszqxszq/maimai-bot/master/src/main/resources/config/portrait_splash`;

const ASSETS = [
  {
    url: 'https://maimaidx-eng.com/maimai-mobile/img/music_dx.png',
    output: './data/assets/maimai-ui/music_dx.png'
  },
  {
    url: 'https://maimaidx-eng.com/maimai-mobile/img/music_standard.png',
    output: './data/assets/maimai-ui/music_standard.png'
  },
  ...VERSION_NAMES.map((name) => ({
    url: `${PORTRAIT_SPLASH_BASE}/${VERSION_URL_MAP[name] ?? name}.png`,
    output: `./data/assets/maimai-ui/version/${name}.png`,
  })),
  ...Array.from({ length: DANI_COUNT }, (_, i) => ({
    url: `${MAIMAI_BOT_BASE}/dani_${String(i).padStart(2, '0')}.png`,
    output: `./data/assets/maimai-ui/dani/dani_${String(i).padStart(2, '0')}.png`,
  })),
  ...CATEGORY_NAMES.map((name) => ({
    url: `${MAIMAI_BOT_BASE}/category_${name}.png`,
    output: `./data/assets/maimai-ui/category/category_${name}.png`,
  })),
];

function parseArgs(argv) {
  return {
    force: argv.includes('--force')
  };
}

async function fileExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadAsset({ url, output }, { force }) {
  if (!force && (await fileExists(output))) {
    return { output, status: 'skipped' };
  }

  await mkdir(dirname(output), { recursive: true });
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(output, buffer);
  return { output, status: 'downloaded', size: buffer.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  for (const asset of ASSETS) {
    results.push(await downloadAsset(asset, options));
  }

  for (const result of results) {
    if (result.status === 'downloaded') {
      console.log(`downloaded ${result.output} (${result.size} bytes)`);
    } else {
      console.log(`skipped ${result.output}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
