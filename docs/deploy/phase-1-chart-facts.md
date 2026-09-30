# Phase 1 deploy: chart facts

Source-owner permission was supplied on 2026-09-30 as a screenshot of @non_otoge saying the mai-notes data may be used for learning or projects. Keep that evidence with the private deployment records. The bot is still safe to deploy without `chart-tags.json`; pattern surfaces will report that the optional data is unavailable.

## Production status

Deployed on 2026-09-30 at commit `5dabcd7fc05670d07410878f2f5485563beb3efb`.

- Remote `npm run check` and all 116 tests passed before restart.
- Three global Discord commands were registered; Discord may take up to an hour to propagate changes.
- The live import mapped 709 of 741 tagged charts (95.68%) and retained 32 unmatched charts in the report.
- The bot started as `MaiDeck#4269`, loaded 709 chart-pattern records, and remained active with zero restarts.
- The catalog refresh timer is active, and the installed unit treats tag import as best-effort after required catalog and alias work.
- The production canary resolved `trill`, `トリル`, and `toriru` to `トリル`; that tag currently resolves to 103 International charts.
- Rollback revision: `0a1e31151e195b03f5ee1120164808feb83eb0d2`.

## Completed deploy procedure

1. Review the English translations in `data/reference/pattern-labels.json`.
2. Run `npm run import:tags -- --dry-run` and inspect `data/reference/chart-tags-report.json` after the first real import.
3. Confirm at least 95% of tagged manifest charts map. The first approved live import mapped 709 of 741 (95.68%); unresolved identities remain in the report rather than being guessed.
4. Run `npm test` and `npm run check`.

The release was fast-forwarded on the remote host, checked, registered, imported, and restarted in that order. `maimai-catalog-refresh.service` was reinstalled before the restart.

## Remaining manual Discord checks

- `/song info` shows a Patterns line for every chart, or the dated unavailable message.
- `/song pattern tag:トリル` returns the tagged set with linked scores and working next/previous buttons.
- Autocomplete finds the same tag from `trill`, `トリル`, and `toriru` (already covered by the automated production canary; confirm the Discord UI once).
- `/song random`, a filtered random pick, and `unplayed:true` all return a matching chart.

The missing-data fallback is covered by automated tests. Do not move the production tag file merely to repeat that test.
