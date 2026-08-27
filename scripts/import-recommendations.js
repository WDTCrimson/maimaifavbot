import 'dotenv/config';
import { config as botConfig } from '../src/config.js';
import { loadWorkerConfig, runRecommendationWorker } from '../src/recommendation-worker.js';
import { SongCatalog } from '../src/song-catalog.js';

const workerConfig = loadWorkerConfig();
const songCatalog = new SongCatalog(botConfig.songCatalogFile);
songCatalog.aliasFile = botConfig.songAliasFile;
await songCatalog.ensureReady();
songCatalog.requireAvailable();

try {
  const report = await runRecommendationWorker({ config: workerConfig, songCatalog });
  console.log(JSON.stringify({
    runId: report.runId,
    mode: report.mode,
    counts: report.counts,
    tokens: report.tokens,
    estimatedCostUsd: report.estimatedCostUsd,
    failures: report.failures.length
  }, null, 2));
  if (report.failures.length) process.exitCode = 2;
} catch (error) {
  console.error(`Recommendation worker failed: ${error.message}`);
  process.exitCode = 1;
}
