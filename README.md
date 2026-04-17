# maimai-fav-bot

Discord bot to manage maimai favorite-song playlists (up to 30 songs each), plus automation helpers to apply a playlist on maimaidxnet.

## What this MVP does

- Create, list, show, and delete per-user playlists.
- Add/remove songs per playlist (max 30).
- Generate a compact payload string for a playlist.
- Suggest songs from a curated community recommendation dataset.
- Provide a bookmarklet installer string.
- Include a Chrome-compatible extension (`extension/`) that applies payloads on maimai pages.

## Bot commands

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
- `/song suggest range:<text> [focus:<text>] [count:<1-10>]`
- `/song info query:<text>`
- `/account link`
- `/account import provider:<auto|manual|maimaijson|tomomai|mimixd> data:<json-or-base64>`
- `/account status`
- `/account sync`
- `/account top`
- `/account unlink`

`/song search` searches internal chart levels only. Examples: `12.3`, `13.7 mas`, `11.8 dx`, `12.3-12.8`, `12.0-12.4 dx`.
Use `/song info` for title, artist, ID, and alias lookup.

`/playlist set-target` stores an achievement target per playlist song. `/playlist graphic` renders a DXRating-style target board from those targets.

To cache DXRating rank badges locally for the target board:

```bash
npm run import:dxrating-ranks
```

Most bot replies are ephemeral (private). `/song info` is public.

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

## Quick start

1. Create a Discord application and bot in the Discord Developer Portal.
2. Copy `.env.example` to `.env` and fill values.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Register slash commands:
   ```bash
   npm run register
   ```
5. Start bot:
   ```bash
   npm start
   ```

### Environment variables

- `DISCORD_TOKEN` (required)
- `DISCORD_CLIENT_ID` (required)
- `DISCORD_GUILD_ID` (optional but recommended for fast command updates)
- `DATA_BACKEND` (optional, `json` or `sqlite`, default `json`)
- `DATA_FILE` (optional, default `./data/loadouts.json`)
- `SQLITE_FILE` (optional, default `./data/loadouts.sqlite`, used when `DATA_BACKEND=sqlite`)
- `SONG_CATALOG_FILE` (optional, default `./data/import/songs.normalized.json`)
- `SONG_ALIAS_FILE` (optional, default `./data/reference/song-aliases.json`)
- `RECOMMENDATION_FILE` (optional, default `./data/recommendations/community.json`)
- `GRAPHIC_THEME_DIR` (optional, default `./data/theme/tomomai` when present, else `./data/theme`)
- `ACCOUNT_LINK_BASE_URL` (optional, external web service start URL for `/account link`)
- `ACCOUNT_LINK_CALLBACK_PUBLIC_URL` (optional, public callback URL the external service posts snapshots to)
- `ACCOUNT_LINK_CALLBACK_BIND` (optional, default `127.0.0.1`)
- `ACCOUNT_LINK_CALLBACK_PORT` (optional, enables the built-in callback listener when set)
- `ACCOUNT_LINK_SHARED_SECRET` (optional, required with callback port for secure web linking)
- `ACCOUNT_LINK_SIGNING_SECRET` (optional, defaults to `ACCOUNT_LINK_SHARED_SECRET`)
- `ACCOUNT_LINK_DATA_SECRET` (optional, encrypts saved sync auth, defaults to `ACCOUNT_LINK_SHARED_SECRET`)
- `ACCOUNT_LINK_TTL_MINUTES` (optional, default `15`)

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

## Community recommendations

`/song suggest` reads a local dataset, but that dataset can now be generated automatically from public discussion sources.

Bootstrap the source config:

```bash
mkdir -p data/recommendations
cp data/recommendations/sources.example.json data/recommendations/sources.json
```

Generate the recommendation dataset:

```bash
npm run import:recommendations
```

This writes:
- `data/recommendations/community.json`
- `data/recommendations/import-report.json`

The importer prefers `data/recommendations/sources.json` when present, and otherwise falls back to the tracked `data/recommendations/sources.example.json`.

GitHub Actions:

- Workflow file: [.github/workflows/import-recommendations.yml](/home/crimson/PersonalProjects/maimaifavbot/.github/workflows/import-recommendations.yml)
- Trigger: manual or daily schedule
- Behavior: first builds a transient song catalog with `npm run import:data -- --skip-jackets --skip-logos`, then runs the recommendation importer and commits updated `community.json` and `import-report.json` back into the repo
- If Reddit public endpoints return `403`, set GitHub Actions secrets `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` so the importer can use Reddit OAuth instead

You can still hand-edit `community.json` if you want, but the intended path is to tune the tracked source config and rerun the importer. See [data/recommendations/README.md](/home/crimson/PersonalProjects/maimaifavbot/data/recommendations/README.md) for the schema.

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
