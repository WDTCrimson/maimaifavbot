# Phase 1 deploy: chart facts

Source-owner permission was supplied on 2026-09-30 as a screenshot of @non_otoge saying the mai-notes data may be used for learning or projects. Keep that evidence with the private deployment records. The bot is still safe to deploy without `chart-tags.json`; pattern surfaces will report that the optional data is unavailable.

## Before deploy

1. Review the English translations in `data/reference/pattern-labels.json`.
2. Run `npm run import:tags -- --dry-run` and inspect `data/reference/chart-tags-report.json` after the first real import.
3. Confirm at least 95% of tagged manifest charts map. The first approved live import mapped 709 of 741 (95.68%); unresolved identities remain in the report rather than being guessed.
4. Run `npm test` and `npm run check`.

## Deploy

1. Pull the release and run `npm run register` because `/song pattern` and `/song random` change the Discord command schema.
2. Run `npm run import:tags` once; subsequent unchanged runs use the stored ETag.
3. Reinstall `maimai-catalog-refresh.service`; its tag import is best-effort and cannot fail the required catalog/alias refresh.
4. Restart the bot.

## Manual checks

- `/song info` shows a Patterns line for every chart, or the dated unavailable message.
- `/song pattern tag:トリル` returns the tagged set with linked scores and working next/previous buttons.
- Autocomplete finds the same tag from `trill`, `トリル`, and `toriru`.
- `/song random`, a filtered random pick, and `unplayed:true` all return a matching chart.
- Temporarily move `chart-tags.json` aside and verify the bot still starts and the pattern command gives the dated unavailable message; restore it afterward.
