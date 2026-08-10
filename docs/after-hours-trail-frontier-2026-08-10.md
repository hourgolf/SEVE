# After-hours trail frontier — 2026-08-10

## Outcome

SEVE can now compare six preregistered premium ratchet/trail shapes against each channel's native exit on the same logical opportunities and exact executable-bid paths. The result is read-only, configuration-era specific, and proposal-only.

No roster, entry, exit, manager, sizing, account, order, broker, Railway, or production research row was changed.

## Operational boundary

- Session-close readiness passed for all three paper accounts.
- Broker and desk books were flat and congruent.
- Open broker orders were zero.
- The current worker and receipt were fresh and matched.
- The trail runner performs only `SELECT` and `GET` reads. It has no production write or trading authority.

## Six bounded comparisons

| Shape | Plain-language behavior |
|---|---|
| ARM +20 · KEEP HALF | Start trailing after +20%; retain half of the best gain. |
| ARM +35 · KEEP TWO THIRDS | Start trailing after +35%; retain two thirds of the best gain. |
| A13 · ARM +50 · KEEP TWO THIRDS | Start trailing after +50%; retain two thirds of the best gain. |
| ARM +50 · KEEP THREE QUARTERS | Start trailing after +50%; retain three quarters of the best gain. |
| BANK +20 · A13 RUNNER | Bank half after +20%; apply A13 to the remaining contracts. |
| BANK +30 · A13 RUNNER | Bank half after +30%; apply A13 to the remaining contracts. |

Every shape uses the same -30% pre-arm stop for this bounded comparison. The bank-and-run shapes are censored for one-contract opportunities instead of pretending a staged exit was possible.

## What the evidence says now

The verified R2 archive supplied 16 complete session tapes. Thirty-three older ledger sessions predate the verified R2 archive and remain visibly missing. Exact current configuration eras are intentionally not pooled with legacy eras.

| Channel | Leading observed shape | Typical lift vs native | Beat frequency | Exact-current evidence | Current call |
|---|---|---:|---:|---:|---|
| orb-ustop-ctl | ARM +50 · KEEP THREE QUARTERS | +3.89 pts | 56% | 9 paths / 3 sessions | Keep native; collect. |
| vb-gap-drift | ARM +50 · KEEP THREE QUARTERS | +32.89 pts | 100% | 2 / 2 | Interesting, far too early. |
| grind-v3 | ARM +50 · KEEP THREE QUARTERS | +2.39 pts | 67% | 3 / 1 | Keep native; collect. |
| momo-shape-2 | ARM +35 · KEEP TWO THIRDS | +6.25 pts | 67% | 3 / 3 | Keep unchanged; collect. |
| orb-qqq-trail | BANK +30 · A13 RUNNER | +12.95 pts | 75% | 4 / 4 | Promising staged shape; collect. |
| vb-macd-state | ARM +20 · KEEP HALF | +33.33 pts | 100% | 1 / 1 | Too early. |
| pb-ride | ARM +20 · KEEP HALF | +38.61 pts | 100% | 1 / 1 | Too early. |
| breakout | ARM +20 · KEEP HALF | +10.39 pts | 100% | 1 / 1 | Too early. |
| vb-ribbon-cross-qqq | ARM +20 · KEEP HALF | +2.70 pts | 67% | 3 / 2 | Keep native; collect. |
| vb-vwap-revert-qqq | ARM +20 · KEEP HALF | 0 pts | 33% | 3 / 1 | No trail signal yet. |

No channel passes the complete proposal floor tonight. A paper trail test requires at least 10 paired opportunities across five independent sessions, positive session-clustered uncertainty, agreement in early and later sessions, leave-one-session-out stability, and a nearby parameter plateau. Capacity and displacement must still pass separately.

## Dashboard behavior

The existing Manager evidence view now receives a compact **Channel trail read**. It shows only the leading shape, typical lift, beat frequency, and evidence count. All six settings stay behind progressive disclosure. The default channel disposition remains unchanged unless a trail passes the full proposal floor.

## Trust repairs included

1. Account NAV is re-marked from the equity snapshot's own unrealized basis. Independently stale position rows can no longer create the false double-count observed intraday on PAPER 3.
2. A manager arm that first receives an eligible quote after the actual position closed remains censored forever. Later quotes can continue observation, but cannot manufacture a paired counterfactual.
3. Trail evidence is selected by the exact current channel-spec receipt/epoch. A larger legacy cohort cannot silently replace the current configuration.

## Next decision

Go to merge/deploy only after review. Publishing the refreshed concise briefs is a separate production research write. No manager or trail activation should accompany the dashboard deployment. The first likely trail experiment should be selected only after additional exact-current sessions make one channel clear the full floor.
