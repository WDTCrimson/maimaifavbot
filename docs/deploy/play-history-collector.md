# Play-history collector deployment

Implemented 2026-09-30. This collector grows the timestamped play corpus needed by the Phase 2 backtest without doing a full score sync every day.

## Production status

Deployed 2026-09-30 at `12b7d93`. The global commands are registered, the bot is running with the additive SQLite tables, and the collector timer is enabled through the persistent user systemd manager. The pre-migration backup is `backups/loadouts-pre-collector-20260930-215820.sqlite` on the host. The timer's canary run exited successfully without reading any accounts because `QUIET_READS_ENABLED` remains unset. Activation is intentionally pending the dedicated-secret rekey.

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
