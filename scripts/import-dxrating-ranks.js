import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE_URL = 'https://shama.dxrating.net/images/rank';
const OUTPUT_DIR = './data/assets/dxrating/rank';
const VERSION_SLUGS = ['festival-plus', 'buddies', 'buddies-plus', 'prism', 'prism-plus', 'circle', 'circle-plus'];
const RANK_KEYS = ['d', 'c', 'b', 'bb', 'bbb', 'a', 'aa', 'aaa', 's', 'sp', 'ss', 'ssp', 'sss', 'sssp'];

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'image/png,image/*,*/*',
      'user-agent': 'maimaifavbot-rank-importer/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed ${response.status} for ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  let downloaded = 0;
  let failed = 0;
  for (const slug of VERSION_SLUGS) {
    for (const rank of RANK_KEYS) {
      const url = `${BASE_URL}/${slug}/${rank}.png`;
      const output = join(OUTPUT_DIR, slug, `${rank}.png`);
      try {
        const buffer = await fetchBuffer(url);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, buffer);
        downloaded += 1;
        console.log(`saved ${slug}/${rank}.png`);
      } catch (error) {
        failed += 1;
        console.error(String(error instanceof Error ? error.message : error));
      }
    }
  }
  console.log(`done: downloaded=${downloaded} failed=${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
