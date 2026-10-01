# Play-history collector deployment

Implemented 2026-09-30. This collector grows the timestamped play corpus needed by the Phase 2 backtest without doing a full score sync every day.

## Production status

Deployed 2026-09-30. The global commands are registered, the bot is running with the additive SQLite tables, and the collector timer is enabled through the persistent user systemd manager. The pre-migration backup is `backups/loadouts-pre-collector-20260930-215820.sqlite` on the host.

The dedicated-secret migration shipped at `c396fba` and rekeyed all four linked profiles. Production backups are `backups/loadouts-pre-linked-auth-rekey-20260930T151430Z.sqlite` and `backups/env-pre-linked-auth-rekey-20260930T151430Z`. All four payloads were verified with the new key, the bot logged back into Discord, and `QUIET_READS_ENABLED=true`.

One profile opted in and completed its first supervised read on 2026-09-30. The read succeeded with zero gaps, preserved the account snapshot byte-for-byte, preserved `sourceFetchedAt`, and found no rows beyond the 56 plays already stored. This established the collection baseline; future newly captured plays count toward the continuous 500-play gate.

Read-only storage monitoring shipped on 2026-10-01. The first production `npm run storage:report` showed 2.0 MiB allocated, four profiles, 890 score rows, 15 snapshots containing 1.0 MiB of JSON, 99 history rows containing 89.6 KiB, an observed payload-growth projection of 2.6 MiB/year, and 270 GiB free. No warning threshold was active. The command warns at 1 GiB, 250 profiles, or less than 20% free disk; it never compacts or deletes data.

## What is built

- `/account settings [history:true|false]` stores consent per profile and shows continuous replayable progress toward 500 plays.
- `scripts/sync-accounts.js --quiet` reads only the DX NET player page and recent-play list for opted-in, due profiles.
- A quiet read writes only deduplicated `account_recent_history` rows and `quiet_read_state`; it does not update the account snapshot, scores, or `sourceFetchedAt`.
- Reads are at least 20 hours apart, process at most two profiles per run, use a 10-minute lease, and stop/back off for six hours on login, maintenance, HTTP 429, or HTTP 5xx responses.
- The first observation establishes a baseline. If total play count rises by more than the number of new recent rows captured, a gap is recorded and the continuous replayable counter restarts.

## Host prerequisites

The feature stays inert until all of these are true:

1. `DATA_BACKEND=sqlite`
2. `ACCOUNT_LINK_DATA_SECRET` is explicitly set and differs from the effective signing/shared secret
3. `QUIET_READS_ENABLED=true`
4. The player enables `/account settings history:true`

Do not enable the collector with the legacy shared encryption/signing secret. Complete the Phase 0 rekey first.

## Rekey and activate

The rekey command defaults to a read-only dry run. Keep the generated secret in a mode-`600` file outside the repository; the command never prints it.

```sh
umask 077
secret_file="$(mktemp)"
openssl rand -base64 48 > "$secret_file"
npm run rekey:linked-auth -- --new-secret-file="$secret_file"
```

After the dry run validates every linked profile, stop the bot and apply. `--activate-collector` backs up `.env`, writes the new `ACCOUNT_LINK_DATA_SECRET`, and sets `QUIET_READS_ENABLED=true`. The command also creates an online SQLite backup before changing any rows.

```sh
systemctl stop maimaifavbot
npm run rekey:linked-auth -- --new-secret-file="$secret_file" --apply --activate-collector
systemctl start maimaifavbot
rm -f "$secret_file"
```

Then enable one test profile with `/account settings history:true` and run the user collector service once. The profile owner must perform this opt-in; the migration does not grant consent on anyone's behalf.

## Install and verify

```sh
npm run register
sudo cp maimai-history-collector.service maimai-history-collector.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maimai-history-collector.timer
systemctl list-timers maimai-history-collector.timer
sudo systemctl start maimai-history-collector.service
journalctl -u maimai-history-collector.service -n 50 --no-pager
```

Keep `QUIET_READS_ENABLED=false` for the first deployment. After the dedicated secret is installed and linked auth has been rekeyed, switch it to `true`, restart the bot, opt in one test profile, and run the service once manually. Confirm `/account settings` shows a last background read while `/account status` still reports the prior full-sync timestamp.

Emergency stop: set `QUIET_READS_ENABLED=false`. The timer can remain installed; disabled runs make no network requests.

### User-service fallback

On hosts where the deploy account cannot write `/etc/systemd/system`, use the persistent user manager instead (`loginctl show-user "$USER" -p Linger` must report `yes`):

```sh
mkdir -p ~/.config/systemd/user
install -m 0644 maimai-history-collector.user.service ~/.config/systemd/user/maimai-history-collector.service
install -m 0644 maimai-history-collector.timer ~/.config/systemd/user/maimai-history-collector.timer
systemctl --user daemon-reload
systemctl --user enable --now maimai-history-collector.timer
systemctl --user start maimai-history-collector.service
```
