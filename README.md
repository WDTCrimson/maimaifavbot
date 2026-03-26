# maimai-fav-bot

Discord bot to manage maimai favorite-song loadouts (up to 30 songs each), plus automation helpers to apply a loadout on maimaidxnet.

## What this MVP does

- Create, list, show, and delete per-user loadouts.
- Add/remove numeric song IDs per loadout (max 30).
- Generate a compact payload string for a loadout.
- Provide a bookmarklet installer string.
- Include a Chrome-compatible extension (`extension/`) that applies payloads on maimai pages.

## Bot commands

- `/loadout create name:<text>`
- `/loadout delete name:<text>`
- `/loadout list`
- `/loadout show name:<text>`
- `/loadout add name:<text> song_id:<id>`
- `/loadout remove name:<text> song_id:<id>`
- `/loadout payload name:<text>`
- `/loadout bookmarklet`

All bot replies are ephemeral (private).

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
- `DATA_FILE` (optional, default `./data/loadouts.json`)

## Using bookmarklet flow

1. Run `/loadout bookmarklet` and copy the URL from the attached file.
2. Create a browser bookmark and paste that URL as its destination.
3. Run `/loadout payload name:<your-loadout>` and copy payload text.
4. Open a maimai favorites/music page.
5. Click bookmarklet and paste payload.
6. Choose strict mode (`OK`) or add-only mode (`Cancel`).

## Using extension flow

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select the `extension/` folder.
4. On maimai page, click extension icon.
5. Paste payload from `/loadout payload` and click apply.

## Notes and limits

- The page automation is heuristic-based because maimaidxnet has no public API for favorites.
- If selectors differ on your target page, adjust logic in `extension/content.js` and `src/bookmarklet.js`.
- Review maimai terms/rules before using automation.

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
