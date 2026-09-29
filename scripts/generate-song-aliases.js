import dotenv from 'dotenv';
import { generateMissingAliases, loadAliasGeneratorConfig } from '../src/alias-generator.js';
import { SongCatalog } from '../src/song-catalog.js';

dotenv.config({ quiet: true });

async function main() {
  const config = loadAliasGeneratorConfig();
  const songCatalog = new SongCatalog(process.env.SONG_CATALOG_FILE?.trim() || './data/import/songs.normalized.json');
  if (process.env.SONG_ALIAS_FILE?.trim()) {
    songCatalog.aliasFile = process.env.SONG_ALIAS_FILE.trim();
  }
  songCatalog.generatedAliasFile = config.outputFile;
  await songCatalog.load();
  songCatalog.requireAvailable();

  const summary = await generateMissingAliases({ songCatalog, config, log: (line) => console.log(line) });
  if (summary.skipped) {
    console.log(`Skipped alias generation for ${summary.pending} songs: ${summary.skipped}.`);
    return;
  }
  console.log(
    `Songs missing aliases: ${summary.pending}. Checked ${summary.checked} with ${summary.calls} Qwen call(s); ` +
      `${summary.aliased} got aliases. Output: ${config.outputFile}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
