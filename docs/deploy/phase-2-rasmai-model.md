# Rasmai prediction-model port

Status: implemented as an opt-in model; not connected to production commands.

Last updated: 2026-11-03.

## Decision

MaiDeck now carries an attributed GPL-3.0-only JavaScript port of Rasmai's player-profile and prediction core. The port is isolated in `src/rasmai-skill-model.js`; `src/hybrid-skill-model.js` is the MaiDeck adapter.

The hybrid policy is intentionally narrow:

- charts with an existing best use Rasmai's repeat-play estimator;
- unseen charts continue to use MaiDeck's first-pass estimator;
- MaiDeck's original estimator remains available as the fallback;
- no live command uses the hybrid until the public-data acceptance gates pass;
- numeric probability output remains disabled until the existing 500-replayable-play calibration and reliability gates pass.

## Port parity

The JavaScript implementation was checked against Rasmai commit `52d8002b643f97ee3a73265dbef50cc5899b023a`.

On the private 108-play time-forward corpus, the port reproduced the upstream Python outputs for every prediction. Maximum absolute differences were:

- expected achievement: `2.84e-14`;
- prediction spread: `4.44e-16`;
- new-best probability: `6.97e-8` (normal-CDF implementation precision).

The committed synthetic oracle regression covers fitted curve parameters, between-chart consistency, repeat-run spread, per-player calibration, expected achievement, spread, rank, and new-best probability without including player data.

## Time-forward comparison

The private comparison used an earlier account snapshot as training data and only later recorded plays as tests. It contained 108 held-out plays: 65 first plays and 43 repeat plays.

| Segment | MaiDeck MAE | Rasmai MAE | Result |
| --- | ---: | ---: | --- |
| All held-out plays | 2.2985 | 2.0934 | Rasmai lower by 0.2051 |
| Repeat plays | 1.9940 | 1.0343 | Rasmai lower by 0.9597; won 31/43 |
| First plays | 2.5064 | 2.7940 | MaiDeck lower by 0.2876 |

Rasmai also produced a lower new-best Brier score (`0.2143` versus `0.4642`) and a higher exact-rank rate (`27.8%` versus `9.4%`) on this small held-out set. These figures justify the hybrid candidate, not production activation: the cohort is small and is not fresh external validation.

## Repeatable shadow backtest

Run the privacy-safe time-forward evaluation against a read-only database and matching catalog:

```bash
npm run backtest:hybrid -- \
  --db ./data/loadouts.sqlite \
  --catalog ./data/import/songs.normalized.json
```

The generated report contains aggregate metrics, anonymized profile labels, and a dataset-shape fingerprint. It excludes Discord IDs, profile names, raw plays, and individual prediction rows. Add `--json` for aggregate machine-readable output.

The 2026-11-03 shadow run used three profiles and 108 held-out plays. The hybrid used MaiDeck for 65 first plays and Rasmai for 43 repeat plays. Its overall MAE was `1.9092`, versus `2.2985` for MaiDeck alone. Its repeat-play MAE was `1.0343`, versus `1.9940`, and its repeat exact-rank rate was `44.2%`, versus `11.6%`.

This remains development evidence from the profiles used to choose the hybrid. Re-run the same command as new plays arrive, but do not treat those profiles as fresh cross-player validation.

## Remaining gate

Before switching any command to the hybrid model:

1. Collect fresh, consented, replayable plays not used for model selection.
2. Run a frozen time-forward comparison by first-play and repeat-play segment.
3. Verify rank accuracy, MAE, new-best Brier score, and reliability buckets.
4. Keep outputs as qualitative odds bands until at least 500 replayable plays exist and every documented calibration bucket passes.
5. Only then wire the chosen model into a user-visible command and perform Discord presentation QA.
