# MaiDeck

MaiDeck is a Discord bot for **maimai DX**, an arcade rhythm game. It started as a way to manage favorite-song lists and has grown into a set of tools for finding charts, checking scores, and keeping track of player progress.

You can use it to look up a song without remembering its exact title, save playlists for different sessions, and inspect score or rating targets. Optional account linking adds profile snapshots and recent-play information.

**Project site:** [maideck.xyz](https://maideck.xyz)  
**Source code:** [GitHub](https://github.com/WDTCrimson/maimaifavbot)  
**License:** [AGPL-3.0-or-later](LICENSE)

## Features

- **Playlists:** Create, share, import, and export favorite-song lists of up to 30 songs. Set achievement targets and render playlist graphics.
- **Chart lookup:** Search by song, difficulty, internal level, or alias. Browse chart-pattern tags, find random charts, and inspect chart details.
- **Score tools:** Use an interactive achievement/DX Score simulator and look up charts relevant to rating improvement.
- **Player profiles:** Import account data manually or use the optional account-link flow to view top scores, recent plays, progress, and rating history.
- **Browser integration:** Apply a playlist to maimai DX NET favorites through an extension, bookmarklet, or supported linked-account flow.
- **Catalog maintenance:** Merge song data and aliases from multiple sources, keep regional availability distinct, and refresh the running catalog without restarting the bot.

Some features depend on imported catalog data or an account-link service. The bot can run without those optional integrations.

## Using the bot

Commands are exposed as Discord slash commands. A few starting points:

```text
/help
/song info query:<song title>
/song search query:12.3-12.8
/playlist create name:<playlist name>
/playlist add-song name:<playlist name> song_query:<song title>
/playlist graphic name:<playlist name>
/account status
```

Most responses are private to the person running the command. Song information and some discovery tools post public results that can be shared in a channel. The [full command reference](#command-reference) is below.

## Run your own instance

You need **Node.js 20 or newer** and a Discord application with a bot token and application client ID.

1. Clone the repository and install dependencies.
2. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. For development, set `DISCORD_GUILD_ID` to register changes in a test server.
3. Register slash commands and start the bot.

```bash
git clone https://github.com/WDTCrimson/maimaifavbot.git
cd maimaifavbot
npm install
cp .env.example .env
# Edit .env before continuing.
npm run register
npm start
```

For local song search, import the song catalog and related assets:

```bash
npm run import:data
npm run import:aliases
```

These importers retrieve data from third-party sources. Read the [third-party notices](THIRD_PARTY_NOTICES.md) and source terms before distributing any downloaded assets.

To run the tests and source checks:

```bash
npm test
npm run check
```

## Technical notes

MaiDeck runs on Node.js and `discord.js`, with JSON storage by default and an optional SQLite backend. Song data is normalized to internal IDs so playlists do not depend on a particular source's numeric identifiers. The catalog refresh workflow validates updates and retains the previous data if a refresh looks malformed.

The optional browser-link flow uses signed, short-lived URLs and an authenticated callback. Linked-account sync authorization is encrypted at rest when configured. It is separate from ordinary playlist and song-lookup use. Details are in [Account linking](#account-linking-groundwork) and the [privacy policy](docs/legal/privacy-policy.md).

The score and rating research code also has a fixture-based backtest. It is **not** being presented as a validated player-skill predictor; the current limitations are documented in [Skill model backtest](#skill-model-backtest).

## Documentation

- [Command reference](#command-reference)
- [Account linking and imports](#account-linking-groundwork)
- [Bookmarklet and browser extension](#using-bookmarklet-flow)
- [Storage and backups](#playlist-storage)
- [Catalog refresh](#automatic-catalog-refresh)
- [Running as a systemd service](#run-as-a-systemd-service)
- [Terms of Service](docs/legal/terms-of-service.md) and [Privacy Policy](docs/legal/privacy-policy.md)
- [Contributing](CONTRIBUTING.md), [Security policy](SECURITY.md), and [Third-party notices](THIRD_PARTY_NOTICES.md)

MaiDeck is an independent community project, not affiliated with or endorsed by SEGA. It has no paid features. The repository's license covers its original code, not third-party songs, images, fonts, or game assets. Review the relevant service rules before using website automation. Use test accounts and synthetic data when developing; don't use another player's account or data.

## Command reference

- `/help`
- `/playlist create name:<text>`
- `/playlist delete name:<text>`
- `/playlist list`
- `/playlist show name:<text>`
- `/playlist stats name:<text>`
- `/playlist add-song name:<text> song_query:<text>`
- `/playlist remove-song name:<text> song_query:<text>`
- `/playlist export name:<text>`
- `/playlist apply name:<text>`
- `/playlist share name:<text>`
- `/playlist import name:<text> code:<text> [replace:true|false]`
- `/playlist graphic name:<text>`
- `/playlist set-target name:<text> song_query:<text> target:<text> [difficulty:<text>] [type:dx|std] [combo:fc|fc+|ap|ap+]`
- `/playlist clear-target name:<text> song_query:<text>`
- `/playlist bookmarklet`
- `/song search query:<internal-level-or-range>`
- `/song suggest [bucket] [difficulty] [level] [type] [sort] [count]`
- `/song info query:<text>`
- `/song pattern tag:<text> [level] [difficulty]`
- `/song random [level] [difficulty] [unplayed]`
- `/song simulate query:<text>`
- `/song predict query:<text> type:<dx|std> difficulty:<difficulty>`
- `/account link`
- `/account import provider:<auto|manual|maimaijson|tomomai|mimixd> data:<json-or-base64>`
- `/account status`
- `/account public action:<enable|view|disable>`
- `/account sync`
- `/account top`
- `/account recent`
- `/account progress [version] [plate] [difficulty]`
- `/account history [count]`
- `/account daily [date]`
- `/account roast`
- `/account plays [count]`
- `/account summary level:<level> [difficulty:<difficulty>]` (defaults to every standard difficulty with a chart in that level bracket)
- `/account unlink`

`/song search` searches internal chart levels only. Examples: `12.3`, `13.7 mas`, `11.8 dx`, `12.3-12.8`, `12.0-12.4 dx`.
Use `/song info` for title, artist, ID, and alias lookup.

`/song simulate` opens a public interactive calculator. Pick the chart, note type, and judgment from dropdowns, then adjust the count with −10, −1, +1, and +10 buttons; the achievement, rank, and DX Score update immediately. Only the person who opened it can use its controls. Counts are retained separately while switching charts. Every judgment you leave out is treated as CRITICAL PERFECT. BREAK PERFECT/GREAT inputs produce a range because those displayed judgments contain scoring sub-tiers.

`/playlist set-target` stores an achievement target per playlist song. `/playlist graphic` renders a DXRating-style target board from those targets.

To cache DXRating rank badges locally for the target board:

```bash
npm run import:dxrating-ranks
```

Most bot replies are ephemeral (private). `/song info`, `/song pattern`, `/song random`, and `/song simulate` are public so their song cards or results can be shared in the channel.

## Chart patterns

MaiDeck can show editor-authored chart pattern tags in `/song info`, browse them with `/song pattern`, and choose a filtered chart with `/song random`. Pattern names are searchable in English, Japanese, or romaji. Pattern results are shown as jacket-backed embeds, five charts per page, with first/previous/next/last buttons when a result set spans multiple pages. Random picks use the same jacket-backed presentation and include the selected chart's pattern labels. The generated tag dataset is optional: when it is absent, the bot continues to run and explains that pattern data is unavailable.

Before enabling the automated import, ask the mai-notes owner for permission. Once permission is granted, import the derived tags with:

```bash
npm run import:tags
```

The importer uses conditional requests, stores derived tag names only, and never redistributes chart files or simai. `data/reference/pattern-labels.json` contains the reviewed English labels.

Production rollout details and the remaining Discord smoke checks are recorded in [docs/deploy/phase-1-chart-facts.md](docs/deploy/phase-1-chart-facts.md).

To review generic labels against playable examples from mai-notes:

```bash
npm run review:patterns
```

Open `data/reports/pattern-translation-review.html`, use **Watch pattern** to launch the source simulator, and enter the terminology global players use. Draft names stay in browser local storage and **Export names** downloads them as JSON. The generated review board is local and gitignored.

These chart-pattern features were inspired by Rasmai and were independently implemented. MaiDeck will have no paid features, ever.

## Legal documents

- [Terms of Service](docs/legal/terms-of-service.md)
- [Privacy Policy](docs/legal/privacy-policy.md)
- [Legal operations checklist](docs/legal/publishing-checklist.md)

The published documents are available at [maideck.xyz/terms](https://maideck.xyz/terms) and [maideck.xyz/privacy](https://maideck.xyz/privacy). The checklist records operational controls, external-platform issues, and items that still require qualified legal advice.

## Open-source license

MaiDeck's original source code is available under the [GNU Affero General Public License v3.0 or later](LICENSE). If you operate a modified version as a network service, the AGPL requires you to offer the corresponding source code to users of that service.

The AGPL does **not** grant rights to third-party names, logos, song jackets, game artwork, fonts, datasets, or other material that MaiDeck does not own. Those items remain subject to their respective owners' terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing a build or asset pack.

Security reports should follow [SECURITY.md](SECURITY.md). Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md).

## Skill model backtest

The skill model is kept as pure, side-effect-free functions. Run its deterministic fixture backtest on any checkout with:

```bash
npm run backtest -- --fixture
```

This writes `data/reports/skill-model-backtest.md`. To test local SQLite account data instead, use `npm run backtest -- --db ./data/loadouts.sqlite`; add `--json` for machine-readable output. During parameter work, add `--tune-only` to evaluate the tuning split without computing or exposing held-out metrics.

Freeze a candidate before obtaining external validation data:

```bash
npm run backtest -- --db ./data/loadouts.sqlite --tune-only \
  --parameters-out ./data/reports/skill-model-parameters.json
```

Evaluate it later without retuning:

```bash
npm run backtest -- --db ./data/loadouts.sqlite \
  --parameters ./data/reports/skill-model-parameters.json \
  --output ./data/reports/skill-model-external-validation.md
```

The parameter artifact contains salted profile fingerprints and automatically excludes the tuning cohort, even when old and fresh profiles share one database. It does not contain Discord IDs or profile names, and evaluation fails closed when no eligible fresh profile remains. A fixture pass only validates the pipeline—it does not establish real-player accuracy or odds calibration. The model is not connected to Discord commands yet: its first real-data held-out run failed the Phase 2 acceptance gate. Future estimator surfaces will use odds bands until a history replay has at least 500 usable plays and meets the reliability criteria; numeric odds remain disabled until then.

An attributed GPL-3.0-only JavaScript port of Rasmai's repeat-play estimator is available in `src/rasmai-skill-model.js`, with an opt-in hybrid adapter in `src/hybrid-skill-model.js`. The hybrid deliberately retains MaiDeck's estimator for first plays and selects Rasmai only for charts with an existing best. It is not the production default. See [the evaluation record](docs/deploy/phase-2-rasmai-model.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Song aliases

Song aliases are loaded from `data/reference/song-aliases.json` and work anywhere song lookup is used:

- `/song search`
- `/song info`
- `/playlist add-song`
- title-based playlist imports

Alias file format:

```json
{
  "entries": [
    {
      "aliases": ["qzk", "qzkago"],
      "title": "QZKago Requiem",
      "artist": "t+pazolite"
    },
    {
      "alias": "hibana",
      "songId": "song:examplecanonicalid"
    }
  ],
  "aliases": {
    "melt": "メルト"
  }
}
```

Prefer `title` + `artist` for aliases maintained by hand. `songId`, current favorite ID, and legacy favorite ID are also accepted.

To import the tracked alias bundle used by this bot:

```bash
npm run import:aliases
```

The importer writes `data/reference/song-aliases.json` and a small report at `data/reference/song-aliases-report.json`.
By default it merges:
- Yuzu maimai alias API (Chinese/community aliases)
- GCM-bot English maimai aliases
- GCM-bot Korean maimai aliases

It also preserves any existing hand-added aliases already present in `data/reference/song-aliases.json`.
The Yuzu source defaults to `https://www.yuzuchan.moe/api/maimaidx/maimaidxalias`; the older documented `api.yuzuchan.moe` host may return 403 from some networks.

## Tests

Run the bot's unit, persistence-parity, rendering-smoke, callback, and worker fixture tests:

```bash
npm test
npm run test:coverage
npm run check
```

### Environment variables

- `DISCORD_TOKEN` (required)
- `DISCORD_CLIENT_ID` (required)
- `DISCORD_GUILD_ID` (optional but recommended for fast command updates)
- `DATA_BACKEND` (optional, `json` or `sqlite`, default `json`)
- `DATA_FILE` (optional, default `./data/loadouts.json`)
- `SQLITE_FILE` (optional, default `./data/loadouts.sqlite`, used when `DATA_BACKEND=sqlite`)
- `USAGE_LOG_DIR` (optional, default `./logs`, used for local expensive-command usage logs)
- `SONG_CATALOG_FILE` (optional, default `./data/import/songs.normalized.json`)
- `SONG_ALIAS_FILE` (optional, default `./data/reference/song-aliases.json`)
- `CHART_TAGS_FILE` (optional, default `./data/reference/chart-tags.json`)
- `PATTERN_LABELS_FILE` (optional, default `./data/reference/pattern-labels.json`)
- `CHART_TAGS_REPORT_FILE` (optional, default `./data/reference/chart-tags-report.json`)
- `MODEL_MIN_NEARBY_BESTS` (optional, default `20`)
- `MODEL_MIN_TOTAL_BESTS` (optional, default `50`)
- `MODEL_NEARBY_WINDOW` (optional, default `1.0` internal-level points)
- `GRAPHIC_THEME_DIR` (optional, default `./data/theme/tomomai` when present, else `./data/theme`)
- `ACCOUNT_LINK_BASE_URL` (optional, external web service start URL for `/account link`)
- `ACCOUNT_LINK_CALLBACK_PUBLIC_URL` (optional, public callback URL the external service posts snapshots to)
- `ACCOUNT_LINK_CALLBACK_BIND` (optional, default `127.0.0.1`)
- `ACCOUNT_LINK_CALLBACK_PORT` (optional, enables the built-in callback listener when set)
- `ACCOUNT_LINK_SHARED_SECRET` (optional, required with callback port for secure web linking)
- `ACCOUNT_LINK_SIGNING_SECRET` (optional, defaults to `ACCOUNT_LINK_SHARED_SECRET`)
- `ACCOUNT_LINK_DATA_SECRET` (optional, encrypts saved sync auth, defaults to `ACCOUNT_LINK_SHARED_SECRET`)
- `ACCOUNT_LINK_TTL_MINUTES` (optional, default `15`)
- `ACCOUNT_PUBLIC_BASE_URL` (optional, public linker profile base URL; production uses `https://maideck.xyz/p`)

## Using bookmarklet flow

1. Run `/playlist bookmarklet` and copy the bookmark URL from the bot message.
   The URL is sent as its own message for easier mobile copy/paste.
2. Create a browser bookmark and paste that URL as its destination.
3. Run `/playlist export name:<your-playlist>` and copy payload text.
4. Open a maimai favorites/music page.
5. Click bookmarklet and paste payload.
6. Bookmarklet resets favorites, applies songs, and auto-submits `DECIDE`.

## Using extension flow

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select the `extension/` folder.
4. On maimai page, click extension icon.
5. To apply an existing bot playlist:
   Paste payload from `/playlist export` and click apply.
6. To import your current website favorites into the bot:
   Click `Export Current Favorites`, then run:
   `/playlist import name:<new_playlist_name> code:<paste_code> replace:true`

## Direct linked-account apply

If you linked an International maimai account with `/account link`, you can apply a bot playlist directly without the bookmarklet or extension:

- `/playlist apply name:<text>`

This updates the website favorites to match the playlist as closely as the current favorites page allows, then reports added/removed/missing songs.

## Playlist storage

Playlists are now stored with canonical internal song IDs, not upstream website numeric IDs.

- Existing legacy playlists auto-migrate on bot startup.
- Old share codes with numeric song IDs are still accepted for import.
- Website-facing favorite IDs are resolved only when exporting or applying a playlist.

### SQLite backend

User state can now be stored in SQLite instead of JSON.

- default backend: JSON
- opt-in backend: SQLite
- first SQLite startup imports existing JSON state automatically if the database is empty

Example:

```env
DATA_BACKEND=sqlite
DATA_FILE=./data/loadouts.json
SQLITE_FILE=./data/loadouts.sqlite
```

In that configuration:
- `DATA_FILE` remains the legacy JSON import source
- `SQLITE_FILE` becomes the active runtime store

To export the current storage state to a timestamped JSON snapshot:

```bash
npm run export:loadouts
```

Optional custom output path:

```bash
node scripts/export-loadouts.js --output=./backups/manual-export.json
```

Optional retention cleanup during export:

```bash
node scripts/export-loadouts.js --retention-days=30
```

This deletes older `loadouts-export-*.json` files in the same backup directory after writing the new export.

To restore from an exported JSON snapshot:

```bash
node scripts/restore-loadouts.js --input=./backups/loadouts-export-YYYYMMDD-HHMMSS.json
```

By default this writes a pre-restore backup into `./backups/` before it overwrites the active store.

To inspect SQLite growth without modifying anything:

```bash
npm run storage:report
```

The report shows allocated and reclaimable database space, profile and row counts, snapshot/history payload sizes, free disk, and an observed twelve-month payload-growth projection. It warns at 1 GiB, 250 profiles, or less than 20% free disk. These warnings do not compact or delete data; compaction remains deferred until the model and calibration gates are complete.

### Rebuild extension CSS (Tailwind)

- Source: `extension/popup.tailwind.css`
- Build once:
  ```bash
  npm run build:extension:css
  ```
- Watch mode while editing:
  ```bash
  npm run dev:extension:css
  ```

## Notes and limits

- The page automation is heuristic-based because maimaidxnet has no public API for favorites.
- If selectors differ on your target page, adjust logic in `extension/content.js` and `src/bookmarklet.js`.
- Title-only import payloads require a local song catalog (`SONG_CATALOG_FILE`) so the bot can resolve titles to song IDs.
- Review maimai terms/rules before using automation.

## Account linking groundwork

The bot now has two account-link paths:

- manual snapshot import with `/account import`
- a scaffolded web-link session with `/account link`

The web-link path is intentionally narrow. This bot does not log into maimai NET by itself yet. Instead, it generates a one-time session URL and exposes a callback endpoint so a separate browser-based link service can POST a sanitized account snapshot back into the bot.

Current supported flows:
- import a profile snapshot from another tool or manual export
- generate a one-time web-link session with `/account link`
- inspect the current snapshot or pending session with `/account status`
- refresh a linked International web-linked snapshot with `/account sync`
- generate a Tomomai-style top-score image with `/account top`
- inspect plate/completion progress, rating history, and saved daily plays
- filter B15/B35 rating targets by bucket, chart, level, and expected gain
- keep distinct sync snapshots and timestamped recent plays in append-only history
- remove the linked snapshot with `/account unlink`

Recommended import mode:
- use `provider:auto` first
- use a provider-specific mode only if you want to force a parsing path

Minimal import payload example:

```json
{
  "name": "TEIO",
  "rating": 12007,
  "friendCode": "1234-5678",
  "region": "INTL",
  "fetchedAt": "2026-04-13T12:00:00.000Z"
}
```

You can pass raw JSON or base64url-encoded JSON to `/account import`.

Examples:

```text
/account import provider:auto data:{"name":"TEIO","rating":12007}
```

```text
/account import provider:maimaijson data:{"player_data":{"userName":"TEIO","rating":12007}}
```

### Web-link callback contract

If you set all of these environment variables:

- `ACCOUNT_LINK_BASE_URL`
- `ACCOUNT_LINK_CALLBACK_PUBLIC_URL`
- `ACCOUNT_LINK_CALLBACK_PORT`
- `ACCOUNT_LINK_SHARED_SECRET`
- `ACCOUNT_LINK_SIGNING_SECRET` (optional, recommended if you want a separate signer for public link URLs)
- `ACCOUNT_LINK_DATA_SECRET` (optional, recommended if you want a separate encryption key for saved sync auth)

then `/account link` will generate a one-time external URL and the bot will start a local callback listener.

Expected callback request:

```http
POST /account-link/callback
x-account-link-secret: <ACCOUNT_LINK_SHARED_SECRET>
content-type: application/json
```

```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "tomomai",
  "account": {
    "name": "TEIO",
    "rating": 12007
  }
}
```

The external service is responsible for obtaining maimai session data, transforming it into a safe profile snapshot, and POSTing it to the callback URL. For the International cookie-based web flow, the bot can also store encrypted sync auth so `/account sync` can refresh the snapshot later.

The public `/account link` URL is now signed. The callback URL is no longer exposed in the browser query string.
Raw imported account payloads are no longer persisted in the bot state file.

## Import song data + logos + jackets

Run:

```bash
npm run import:data
```

This imports:

- Source JSON datasets into `data/import/sources/`
- A normalized merged song dataset into `data/import/songs.normalized.json`
- Logos into `data/assets/logo/otoge-db/`
- Jackets into:
  - `data/assets/jacket/otoge-db/`
  - `data/assets/jacket/dxrating/`
- Import summary report into `data/import/import-report.json`

Optional flags:

```bash
node scripts/import-maimai-data.js --concurrency=10 --retries=3 --force
node scripts/import-maimai-data.js --skip-jackets
node scripts/import-maimai-data.js --skip-logos
node scripts/import-maimai-data.js --skip-data
```

The normalized catalog retains per-song `jp`, `intl`, `usa`, and `cn` availability. JP-only releases are searchable immediately, but their region metadata remains distinct so they are not treated as International availability.

### Automatic catalog refresh

The running bot checks `SONG_CATALOG_FILE` and `SONG_ALIAS_FILE` every five minutes by default and atomically installs changed catalog or alias data. A malformed update, or one that unexpectedly removes more than 10% of the known songs, is rejected while the last known-good catalog and aliases remain active.

Install the supplied systemd timer to fetch source data and any missing jackets twice daily:

```bash
sudo install -m 0644 maimai-catalog-refresh.service /etc/systemd/system/
sudo install -m 0644 maimai-catalog-refresh.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maimai-catalog-refresh.timer
sudo systemctl start maimai-catalog-refresh.service
```

Inspect it with:

```bash
systemctl list-timers maimai-catalog-refresh.timer
journalctl -u maimai-catalog-refresh.service -n 100 --no-pager
```

Change the bot-side file polling interval with `CATALOG_RELOAD_INTERVAL_MINUTES`. The timer imports both International and JP-only entries from the upstream datasets, refreshes aliases from Yuzu and GCM, then performs the approved chart-tag import as a best-effort step. A tag-source failure cannot fail the required catalog and alias refresh. No bot restart is required after a successful refresh.

## Customize graphic assets

`/playlist graphic` can use custom assets from `GRAPHIC_THEME_DIR` (default `data/theme/tomomai/` when available).

Tomomai assets copied locally in this project:

- Full pack: `data/assets/tomomai/res/`
- Ready preset: `data/theme/tomomai/` (set `GRAPHIC_THEME_DIR=./data/theme/tomomai`)

Drop files with these base names:

- `background` (full background)
- `header-overlay` (header image overlay)
- `logo` (top-right logo)
- `watermark` (global overlay)
- `card-bg` (inside song cards)
- `card-frame` (on top of song cards)

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.webp`

Optional style tuning:

- Create `data/theme/theme.json` using `data/theme/theme.json.example` as template.

## Run as a systemd service

1. Copy the provided unit file:
   ```bash
   sudo cp maimai-fav-bot.service /etc/systemd/system/maimai-fav-bot.service
   ```
2. Reload systemd:
   ```bash
   sudo systemctl daemon-reload
   ```
3. Enable and start the bot:
   ```bash
   sudo systemctl enable --now maimai-fav-bot
   ```
4. Check status/logs:
   ```bash
   sudo systemctl status maimai-fav-bot
   sudo journalctl -u maimai-fav-bot -f
   ```
