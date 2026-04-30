import { setTimeout as sleep } from 'node:timers/promises';
import { restoreLinkedAuthFromStorage } from '../src/account-link-auth.js';
import { config, limits } from '../src/config.js';
import { fetchIntlAccountSnapshotFromClal } from '../src/maimai-intl.js';
import { SongCatalog } from '../src/song-catalog.js';
import { LoadoutStore } from '../src/store.js';

function parseArgs(argv) {
  const args = {
    userId: null,
    delayMs: 1000,
    dryRun: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--user-id=')) {
      const value = arg.slice('--user-id='.length).trim();
      if (!value) {
        throw new Error('Missing value for --user-id.');
      }
      args.userId = value;
      continue;
    }

    if (arg.startsWith('--delay-ms=')) {
      const value = Number.parseInt(arg.slice('--delay-ms='.length), 10);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('Invalid value for --delay-ms; expected a non-negative integer.');
      }
      args.delayMs = value;
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function formatUserLabel(userId, account) {
  const name = account?.player?.name || account?.displayName || null;
  return name ? `${name} (${userId})` : userId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!config.accountLinkDataSecret) {
    throw new Error('ACCOUNT_LINK_DATA_SECRET or ACCOUNT_LINK_SHARED_SECRET is required to decrypt linked account auth.');
  }

  const store = new LoadoutStore(
    {
      backend: config.dataBackend,
      jsonFile: config.dataFile,
      sqliteFile: config.sqliteFile
    },
    limits
  );
  await store.ensureReady();

  const songCatalog = new SongCatalog(config.songCatalogFile);
  songCatalog.aliasFile = config.songAliasFile;
  await songCatalog.ensureReady();

  const entries = Object.entries(store.state.users || {})
    .filter(([userId]) => !args.userId || userId === args.userId)
    .map(([userId, user]) => ({ userId, account: user?.account || null }));

  if (args.userId && entries.length === 0) {
    throw new Error(`No stored user found for --user-id=${args.userId}.`);
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Scanning ${entries.length} stored user account(s).${args.dryRun ? ' Dry run only.' : ''}`);

  for (const [index, { userId, account }] of entries.entries()) {
    const label = formatUserLabel(userId, account);
    if (!account?.linkedAuth) {
      skipped += 1;
      console.log(`SKIP ${label}: no reusable linked auth.`);
      continue;
    }

    let linkedAuth = null;
    try {
      linkedAuth = restoreLinkedAuthFromStorage(account.linkedAuth, config.accountLinkDataSecret);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${label}: could not decrypt linked auth: ${error?.message || error}`);
      continue;
    }

    if (!linkedAuth || linkedAuth.region !== 'intl' || linkedAuth.type !== 'clal') {
      skipped += 1;
      console.log(`SKIP ${label}: linked auth is not an International clal token.`);
      continue;
    }

    try {
      console.log(`SYNC ${label}: fetching account snapshot...`);
      if (args.dryRun) {
        synced += 1;
      } else {
        const refreshed = await fetchIntlAccountSnapshotFromClal(linkedAuth.token, songCatalog);
        const stored = await store.setAccount(userId, {
          ...account,
          ...refreshed.snapshot,
          provider: account.provider || refreshed.snapshot.provider,
          linkMethod: account.linkMethod || refreshed.snapshot.linkMethod,
          linkedAuth: account.linkedAuth
        });
        const scoreCount = store.getAccountScores(userId).length;
        const recentCount = store.getAccountRecentSessions(userId).length;
        const countWithPlayCounts = store.getAccountScores(userId).filter((score) => score?.playCount != null).length;
        synced += 1;
        console.log(
          `DONE ${formatUserLabel(userId, stored)}: ${scoreCount} score row(s), ${countWithPlayCounts} with play counts, ${recentCount} recent row(s).`
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${label}: ${error?.stack || error}`);
    }

    if (args.delayMs > 0 && index < entries.length - 1) {
      await sleep(args.delayMs);
    }
  }

  console.log(`Finished. Synced: ${synced}. Skipped: ${skipped}. Failed: ${failed}.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
