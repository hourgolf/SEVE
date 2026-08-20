# Fleet research queue · 2026-08-20

This is a read-only decision packet generated from the canonical profitability ledger, Decision Atlas, Entry Atlas, trail frontier, and collision graph through August 20. It made no production writes and changed no roster, manager, size, route, admission rule, position, or order.

## What the first full pass found

- **20 mature channels show entry opportunity followed by exit leakage.** Only one bounded alternative is ready for a controlled paper comparison: `fomc-follow` with `ARM +35 · KEEP TWO THIRDS`. It has 19 paired opportunities across 19 sessions, a +19.57-point typical lift, 95% improvement frequency, and a session-clustered lower bound of +11.14 points. This is a test proposal, not an activation.
- **Four more exit challengers are directionally interesting but not ready:** `power`, `power-smart-entries`, `orb-ustop`, and `qqq-thrust-trail`. Their intervals still cross zero, and `qqq-thrust-trail` has only 9 paired paths against the 10-path floor.
- **`qqq-thrust-trail` is the cleanest next shadow exit experiment.** Its 11-session cohort found a typical +47.6% favorable move but finished at -40%. `ARM +20 · KEEP HALF` improved 78% of 9 paired paths with a +42.08-point typical lift, but uncertainty remains wide (-104.25 to +88.50 points).
- **`momo-shape` is not rescued by its exit challenger.** Its typical path found +19.2% but finished at -40%; the best bounded exit adds only +8.63 points. Because its lifecycle evidence is negative and redundant, retirement review takes priority over another exit test.
- **`breakout-smart-entries-iwm` remains a retirement candidate.** It has 10 sessions / 28 opportunities, a -$16.35 typical session, and 8 negative sessions out of 10. Its strongest same-instrument peer comparison is `breakout-alt-v3-iwm` (3 comparable sessions, perfect observed correlation), but that redundancy sample is still small.

## Active evidence is deeper than the current-era cards imply

All 19 active roots are still below the exact-current 5-session / 10-opportunity floor because recent configuration changes reset exact-current cohorts. That does **not** mean the system knows nothing about them:

- 17 of 19 have a separate comparable historical or prospective cohort above the decision floor.
- Only `breakout-alt-v3-iwm` (5 sessions / 9 comparable opportunities) and `qqq-thrust-trail-wd` (5 / 6) lack both an exact-current floor and a comparable 10-opportunity floor.
- Comparable history must inform hypotheses, while exact-current execution remains the confirmation layer. These counts are shown separately and are never silently pooled.

## VB split

The VB families do not have one shared problem:

- **Trend/breakout VB:** 13 mature channels; median typical best move +22.5%, median finish -30%. Eleven show entry opportunity followed by exit leakage. Their existing bounded exit candidates generally fail to improve the native result, so the next work is new channel-specific exit shapes rather than tighter entry gates.
- **Reversal VB:** 11 mature channels; median typical best move +15.75%, median finish +15%. Only one has a weak/mixed entry read. These are primarily context, timing, and uniqueness questions—not a blanket exit problem.

## Breakout redundancy

Twenty breakout pairs clear the high-redundancy floor. The strongest cluster contains `breakout-alt-v3`, its CTL/ER40 variants, and `breakout-smart-entries` CTL/ER40/ITM variants. Correlations in the leading comparisons range from 0.87 to 0.99 across 8–16 comparable sessions. The next decision should compare same-session outcomes and unique evidence contribution before retaining every collector. Cross-account overlap remains permitted and is not treated as an automatic defect.

## Automation

`npm run fleet-research-queue` now produces frozen JSON, concise Markdown, and a receipt from an existing nightly Atlas run. The normal `nightly-decision-atlas` orchestrator invokes it after channel briefs are generated, so this queue refreshes with the rest of the read-only nightly research.

## Boundaries

- Actual execution, historical virtual paths, and exit counterfactuals remain separate.
- A favorable move diagnoses entry opportunity; it does not prove monetization.
- Configuration-unstamped history supports research grouping, not exact-current claims.
- No proposal in this packet is authorized for production activation.
