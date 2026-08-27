# Personalized recommendation pipeline

`/song suggest` reads the reviewed chart-level catalog at `community.json`. Live Discord requests never contact Reddit or QwenCloud. If the catalog is absent or invalid, linked players can still receive deterministic score-improvement suggestions from the last score snapshot.

## Catalog workflow

- `community.json` is schema v2 and is reviewed in git.
- Entries identify one exact chart with `songId`, `type`, and `difficulty`.
- Runtime loading validates every field and canonical chart, compares a SHA-256 content hash, and preserves the last good in-memory catalog after a failed reload.
- `rejections.json` permanently excludes candidate IDs from later proposals.
- JSON Schemas live in `schemas/`.

Legacy v1 song rows are never expanded across every chart. Create explicit mappings from `chart-mappings.example.json`, then run:

```bash
npm run migrate:recommendations -- \
  --source ./path/to/community-v1.json \
  --mappings ./data/recommendations/chart-mappings.json
```

Unmapped rows are written to `migration-report.json` with `needs_chart_mapping` and are not published.

## Worker safety model

The worker is `scripts/import-recommendations.js`. Its defaults are shadow mode and network-denied unless all of the following are deliberately configured:

```dotenv
REDDIT_ACCESS_APPROVED=true
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=...
DASHSCOPE_API_KEY=...
PUBLISH_PROPOSALS=false
```

`REDDIT_ACCESS_APPROVED` is an operator assertion, not a substitute for approval. Do not set it until Reddit approves daily automated `r/maimai` access and third-party QwenCloud processing.

The worker:

- reads only approved OAuth routes for `r/maimai`;
- holds Reddit titles, bodies, comments, and usernames only in process memory;
- persists source IDs, hashes, timestamps, derived candidates, token counts, and request IDs in a separate SQLite database;
- treats Reddit text as hostile, gives Qwen no tools, disables thinking, asks for strict JSON Schema, and validates output locally;
- quarantines ambiguous, chartless, negative, mixed, unclear, or lexically unsupported candidates;
- requires two distinct active Reddit threads before an automatic catalog addition;
- continues ingestion while an open proposal PR remains frozen;
- never merges a PR or pushes protected `main`.

For offline testing, set `RECOMMENDATION_FIXTURE_FILE` to a JSON fixture containing `items`; an item may contain a precomputed `extraction` object, so neither Reddit nor QwenCloud is contacted.

## Deployment

1. Create a dedicated worktree at `/srv/maimai-fav-bot-recommendation-worker` and a state directory at `/var/lib/maimai-fav-bot` owned by the non-root bot user.
2. Install `maimai-recommendation-worker.service` and `.timer` into `/etc/systemd/system/`.
3. Put secrets in `/etc/maimai-fav-bot/recommendation-worker.env`, owned by root and mode `0600`.
4. Leave the timer disabled while exercising fixtures.
5. After Reddit approval and the Qwen account-data terms check, enable the timer with `PUBLISH_PROPOSALS=false` for 14 daily shadow runs.
6. Require zero invalid canonical chart references, verify the fine-grained PAT cannot push or merge `main`, then set `PUBLISH_PROPOSALS=true` without changing cadence.

```bash
sudo systemctl daemon-reload
sudo systemctl start maimai-recommendation-worker.service
# Only at the approved 14-day shadow phase:
sudo systemctl enable --now maimai-recommendation-worker.timer
```

The PAT needs repository-scoped Contents and Pull requests write access. Branch protection must require PR merges on `main`. `RECOMMENDATION_LIVE_CATALOG_FILE` should point to the bot's external runtime catalog; it is installed atomically only after the merged `origin/main` catalog validates.

## External launch gates

The Reddit access request should disclose: non-commercial Discord feature, daily incremental reads limited to `r/maimai`, a 48-hour overlap, derived chart recommendations, no raw text or usernames retained, and QwenCloud as a third-party processor. Denial leaves the access-independent personalized command as the supported product.

Before activation, make one live QwenCloud probe and confirm strict schema behavior for the selected account/model, current pricing, and data handling. Keep the documented run ceilings and set the token-price environment variables so the USD 1 estimated-cost stop is meaningful.

Agent-Reach is optional for interactive maintainer research only. It is not imported by the bot or worker.
