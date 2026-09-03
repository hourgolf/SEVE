# September 2 channel program

This packet records the decision state after the September 2 nightly Atlas. It is not activation authority.

## Executive decisions

| Channel/program | Decision | Evidence | Confidence |
|---|---|---|---|
| `vb-or-fail-iwm` | Downgrade paper to observe-only; preserve collection | Current specification: 3 executed trades, 1 winner, -$68. Removing it adds $68 across the two compatible portfolio epochs, with no replacement opportunity or peer displacement. Removing its best trade leaves -$92. | Moderate |
| `pb-ride-itm` | Start a prospective cap-one comparison | Current exact cohort is only one session / three paths; broader observe cohort is 4 sessions / 14 paths and later entries are the suspected leak. | Low until 5 sessions / 10 prospective stamped paths |
| `grind-v3-2` | Start a prospective cap-one comparison | Current exact cohort is one session / four paths; broader observe cohort is 4 sessions / 14 paths and later entries are the suspected leak. | Low until 5 sessions / 10 prospective stamped paths |
| `fomc-follow` | Hold promotion | The 43-session Atlas cohort is generic 14:30 momentum, not event-only. The actual event probe has one FOMC bar session and zero quote-complete FOMC option sessions. | High confidence in NO-GO; insufficient evidence about the intended FOMC edge |
| `qqq-thrust-trail` | Continue paired exit collection | ARM +20 / KEEP HALF leads over 11 paired paths / 10 sessions, but the session-clustered 95% lower bound is -77.12 points. | Promising, not decision-ready |
| Breakout collectors | Prepare a four-collector pause; retain distinct control, ER40, ITM, IWM, and one QQQ research lane | Four pairs are highly redundant: correlations 0.94-0.96 with 22-43 same-clock paths. | Moderate; pause is reversible and does not change trading |

## `vb-or-fail-iwm`: exact posture replay

The candidate manifest changes one field only: `executionPosture` from `paper` to `observe-only`. Quantity 2, Account 2 route, priority 1, the all-out +15/-30 manager, first-entry cap, collection state, and historical evidence remain unchanged.

| Compatible epoch | Sessions | Removed trades | Portfolio delta if observed | Peer opportunities added |
|---|---:|---:|---:|---:|
| Previous current-spec epoch | 6 | +$24, -$52 | +$28 | 0 |
| Active epoch | 2 | -$40 | +$40 | 0 |
| Combined | 8 | 3 trades, -$68 | +$68 | 0 |

Strongest counterargument: the pre-registered rollback trigger called for three losing independent sessions, while the exact executed sample has two losing sessions. That objection is real. The downgrade is nevertheless supported because the compatible historical cohort is also negative, the result worsens without the best trade, the holdout is negative, there is no hidden displacement benefit, and observe-only collection keeps the hypothesis alive without paying for it.

Prepared candidate manifest: `sha256:64b17ce0ccb6f877469868d2aa911e0ef01c46b4504fbaa691eb9672be7d7d9d`.

## Prospective cap-one tests

Two `max_entries_per_session` experiments begin with signals on or after September 3:

- `priority-a:pb-ride-itm:max_entries_per_session:v2`
- `priority-a:grind-v3-2:max_entries_per_session:v2`

Both compare the uncapped signal sequence with entry 1 only. Entry logic, contract selection, native exit, manager, size, route, and collision policy stay fixed. The definitions carry no execution authority and require at least five independent sessions and ten scored prospective opportunities before review.

## FOMC validation

Observed fact: `fomc-follow` has a time-and-momentum specification but no FOMC-calendar predicate. Its 43-session Atlas cohort therefore estimates an ordinary-day afternoon momentum strategy. The event-only probe finds one FOMC session in the current bar corpus and no FOMC session with usable NBBO option paths.

Supported inference: the generic cohort may justify a separately named afternoon-momentum experiment, but it cannot validate the intended event strategy.

Missing evidence before promotion:

1. A sealed FOMC-session or explicit manual-arm gate.
2. Event-only option quote paths on multiple independent FOMC dates.
3. Same-opportunity comparison of the native exit and the chosen ratchet on that event-only cohort.
4. Outlier removal, chronological stability, capacity, collision, and displacement checks on the event-only cohort.

GO/NO-GO: NO-GO for paper promotion. Continue event-only collection.

## QQQ thrust exit work

The collection registry is active for both `qqq-thrust-trail` and `qqq-thrust-trail-wd`. No manager, size, route, or posture change is proposed. `qqq-thrust-trail` shows favorable movement but negative native conversion. ARM +20 / KEEP HALF is the current lead, yet its interval crosses zero; a paper switch would be premature.

## Breakout collection rationalization

Retain collection for:

- `breakout` as the baseline root.
- `breakout-alt-v3`, `breakout-alt-v3-ctl`, and `breakout-alt-v3-er40` as the representative same-family axis ladder.
- `breakout-alt-v3-itm` and `breakout-smart-entries-itm` while the ITM lever remains under-tested.
- `breakout-alt-v3-iwm` as the IWM lane.
- `breakout-smart-entries-qqq` as the one remaining QQQ diagnostic lane.

Prepare to pause these redundant observe-only collectors:

- `breakout-smart-entries`
- `breakout-smart-entries-ctl`
- `breakout-smart-entries-er40`
- `breakout-qqq`

The prepared pause hash is `sha256:fe8e819cbaa5fe84e2d5966f875a46f252629fad929d4dc96d28207f6825c283`. A later approved pause would append collection-state receipts only; it would not change the active manifest, execution posture, orders, positions, or historical evidence.

## Production boundary

The September 2 Atlas briefs were refreshed in the dashboard. The source repair, cap-one definitions, FOMC blocker, posture preview, and collector preview remain unmerged local work. Activating the `vb-or-fail-iwm` downgrade or pausing collectors requires separate approval. Pushing the source branch to `main` can redeploy both Vercel and Railway and must be treated as one coupled release.
