import { setTimeout as sleep } from 'node:timers/promises';
import { restoreLinkedAuthFromStorage } from '../src/account-link-auth.js';
import { accountSyncConfig as config, accountSyncLimits as limits } from '../src/account-sync-config.js';
import { fetchIntlAccountSnapshotFromClal, fetchIntlRecentPlayCollectionFromClal } from '../src/maimai-intl.js';
import { isQuietReadDue, QUIET_READ_BACKOFF_HOURS } from '../src/play-collection.js';
import { SongCatalog } from '../src/song-catalog.js';
import { LoadoutStore } from '../src/store.js';

function parseArgs(argv) {
  const args = {
    userId: null,
    delayMs: 1000,
    dryRun: false,
    quiet: false
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

    if (arg === '--quiet') {
      args.quiet = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function formatUserLabel(userId, account, profileName = null) {
  const name = account?.player?.name || account?.displayName || null;
  const profile = profileName ? `/${profileName}` : '';
  return name ? `${name} (${userId}${profile})` : `${userId}${profile}`;
}

function shouldStopQuietRun(error) {
  const message = String(error?.message || error).toLowerCase();
  return message.includes('expired or invalid')
    || message.includes('maintenance')
    || /http (429|5\d\d)/.test(message)
    || message.includes('login page');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.quiet && !config.quietReadsEnabled) {
    console.log('Quiet reads are disabled by QUIET_READS_ENABLED. No accounts were read.');
    return;
  }

  if (args.quiet && config.dataBackend !== 'sqlite') {
    throw new Error('Quiet reads require DATA_BACKEND=sqlite.');
  }

  if (args.quiet && !config.accountLinkDataSecretDedicated) {
    throw new Error('Quiet reads require an explicit ACCOUNT_LINK_DATA_SECRET distinct from the signing secret.');
  }

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

  if (args.quiet) {
    const globalBackoff = store.getQuietReadGlobalBackoff();
    if (Number.isFinite(Date.parse(globalBackoff || '')) && Date.parse(globalBackoff) > Date.now()) {
      console.log(`Quiet reads are globally backed off until ${globalBackoff}. No accounts were read.`);
      return;
    }
  }

  const songCatalog = new SongCatalog(config.songCatalogFile);
  songCatalog.aliasFile = config.songAliasFile;
  await songCatalog.ensureReady();

  let entries = Object.entries(store.state.users || {})
    .filter(([userId]) => !args.userId || userId === args.userId)
    .flatMap(([userId, user]) => Object.entries(user?.profiles || {}).map(([profileName]) => ({
      userId,
      profileName,
      account: store.getAccount(userId, profileName)
    })));

  if (args.quiet) {
    entries = entries
      .filter(({ userId, profileName }) => isQuietReadDue(
        store.getPlayCollectionStatus(userId, profileName),
        Date.now(),
        config.quietReadMinIntervalHours
      ))
      .slice(0, config.quietReadMaxAccountsPerRun);
  }

  if (args.userId && entries.length === 0) {
    throw new Error(`No stored user found for --user-id=${args.userId}.`);
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Scanning ${entries.length} stored profile(s)${args.quiet ? ' due for quiet history collection' : ''}.${args.dryRun ? ' Dry run only.' : ''}`);

  for (const [index, { userId, profileName, account }] of entries.entries()) {
    const label = formatUserLabel(userId, args.quiet ? null : account, profileName);
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
      console.log(`${args.quiet ? 'QUIET' : 'SYNC'} ${label}: fetching ${args.quiet ? 'recent plays' : 'account snapshot'}...`);
      if (args.dryRun) {
        synced += 1;
      } else if (args.quiet) {
        if (!store.tryAcquireQuietReadLease(userId, profileName)) {
          skipped += 1;
          console.log(`SKIP ${label}: another sync currently holds the collection lease.`);
          continue;
        }
        const collected = await fetchIntlRecentPlayCollectionFromClal(linkedAuth.token, songCatalog);
        const result = store.recordQuietPlayCollection(userId, profileName, collected);
        synced += 1;
        console.log(JSON.stringify({
          event: 'quiet_read',
          userId,
          profileName,
          outcome: result.gap ? 'gap' : 'ok',
          captured: result.written,
          missing: result.gap?.missingPlays ?? 0,
          continuousPlays: result.state.continuousPlays
        }));
      } else {
        const refreshed = await fetchIntlAccountSnapshotFromClal(linkedAuth.token, songCatalog, {
          previousSnapshot: account,
          previousScores: store.getAccountScores(userId, profileName)
        });
        const stored = await store.setAccount(userId, {
          ...account,
          ...refreshed.snapshot,
          provider: account.provider || refreshed.snapshot.provider,
          linkMethod: account.linkMethod || refreshed.snapshot.linkMethod,
          linkedAuth: account.linkedAuth
        }, profileName);
        const scoreCount = store.getAccountScores(userId, profileName).length;
        const recentCount = store.getAccountRecentSessions(userId, profileName).length;
        const countWithPlayCounts = store.getAccountScores(userId, profileName).filter((score) => score?.playCount != null).length;
        synced += 1;
        console.log(
          `DONE ${formatUserLabel(userId, stored, profileName)}: ${scoreCount} score row(s), ${countWithPlayCounts} with play counts, ${recentCount} recent row(s).`
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${label}: ${error?.stack || error}`);
      if (args.quiet) {
        const stop = shouldStopQuietRun(error);
        const backoffUntil = stop
          ? new Date(Date.now() + QUIET_READ_BACKOFF_HOURS * 60 * 60 * 1000).toISOString()
          : null;
        store.recordQuietReadFailure(userId, profileName, stop ? 'service-backoff' : 'failed', backoffUntil);
        if (stop) {
          store.setQuietReadGlobalBackoff(backoffUntil);
          console.error(`Stopping quiet-read run; this profile is backed off until ${backoffUntil}.`);
          break;
        }
      }
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
