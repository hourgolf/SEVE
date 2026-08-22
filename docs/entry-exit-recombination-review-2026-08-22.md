# Entry × exit recombination review · 2026-08-22

**READ-ONLY PAPER RESEARCH · AUGUST 3–21 · NO PRODUCTION CHANGES**

## Corrected momo conclusion

Keep the `momo-shape-2` entry logic. Its more frequent winning behavior becomes materially better when paired with `FULL-R50-K67`: after a position reaches +50%, protect two-thirds of its best gain; retain the existing -30% pre-arm stop. Do not replace it with `momo-shape`.

| Momo package in the same proposed roster | Aug 3–21 | Aug 10–21 |
|---|---:|---:|
| Current `momo-shape-2` manager | +$2,273 | -$889 |
| `momo-shape` + FULL-R20-K50 | +$3,003 | -$883 |
| `momo-shape-2` + FULL-R20-K50 | +$3,513 | -$633 |
| **`momo-shape-2` + FULL-R50-K67** | **+$3,671** | **-$579** |

At two contracts, the first eligible `momo-shape-2` opportunity of each session replayed to +$1,292 across ten sessions. Five sessions won, the typical session result was +$120, and the result remained +$288 after removing the largest winner. This is better-supported than the earlier `momo-shape` replacement.

## Fleet-wide finding

The issue is pervasive. Holding each channel's stamped entry stream fixed and replaying every bounded exit on the same option-bid paths found:

- 62 channels with a stable entry version in the review window;
- 39 channels whose entry stream had a better bounded exit worth reviewing;
- 14 repeatable-profit candidates;
- 4 profitable aggregates whose typical path still lost;
- 9 tail-dependent candidates;
- 12 exits that reduced loss but did not create positive expectancy.

This scan produces hypotheses, not configuration authority. Every active candidate was then replayed chronologically with account capacity, same-clock admission, family occupancy, same-OCC protection, and displaced opportunities.

## Active-channel portfolio screen

| Entry kept fixed | Exit replayed | Aug 3–21 vs current roster | Aug 10–21 vs current roster | Read |
|---|---|---:|---:|---|
| `momo-shape-2` | FULL-R50-K67 | +$1,397 | +$310 | Strong in both windows |
| `vb-level-break` | FULL-R50-K67 | +$1,293 | +$262 | Strong in both windows |
| `grind-v3` | FULL-R20-K50 | +$58 | +$249 | Helpful but tail-dependent |
| `breakout` | FULL-R20-K50 | +$60 | +$41 | Modest alone; stronger in the package |
| `pb-ride-itm` | FULL-R20-K50 | +$479 | +$26 | Reject: still negative alone and harms the combined package |
| `vb-curl-reversal-qqq` | FULL-R35-K67 | +$408 | -$127 | Reject: unstable by window |
| `breakout-alt-v3-itm` | TP50 | -$20 | -$236 | Reject |
| `vb-macd-state` | FULL-R50-K75 | -$1,020 | -$700 | Reject |

Testing every subset of the five survivors identified one clear package:

| Chronological roster replay | Aug 3–21 | Aug 10–21 |
|---|---:|---:|
| Current proposed roster | +$2,273 | -$889 |
| **Momo2 R50/K67 + VB level R50/K67 + Grind R20/K50 + Breakout R20/K50** | **+$6,077** | **+$107** |
| Same package plus PB Ride R20/K50 | +$5,088 | -$170 |

The four-change package ranked first in both windows among all 31 possible subsets. It improved ten-session results by $997 and three-week results by $3,804. This is mixed actual/virtual comparative research, not broker P&L or a forecast.

## Recommendation for a separately approved paper experiment

1. Keep `momo-shape-2` active at two contracts and make FULL-R50-K67 its native exit; shadow its current bank/runner manager and FULL-R20-K50.
2. Keep `vb-level-break`'s entry and size fixed; make FULL-R50-K67 its native paper exit and shadow the current exit.
3. Keep `grind-v3`'s entry and size fixed; make FULL-R20-K50 its native paper exit and shadow the current exit. Flag it as a tail-capture test, not a rehabilitated channel.
4. Keep `breakout`'s entry and size fixed; make FULL-R20-K50 its native paper exit and shadow the current exit.
5. Do not change `pb-ride-itm`, `vb-curl-reversal-qqq`, `breakout-alt-v3-itm`, or `vb-macd-state` from this scan.
6. Keep `momo-shape` observe-only as the sibling entry control.
7. Do not add the rejected `qqq-thrust-trail` bank/runner proposal.

## Decision discipline going forward

Nightly research should evaluate entry and exit as recombinable components:

1. hold a stamped entry stream fixed;
2. replay bounded exits on identical opportunities;
3. show typical result, positive sessions, aggregate result, and result without the largest winner;
4. reject incomplete or incompatible cohorts;
5. replay surviving combinations chronologically against account capacity and displacement;
6. keep the displaced native behavior as the prospective shadow control.

No roster, manager, size, broker, order, position, production data, or deployment change was made by this review.
