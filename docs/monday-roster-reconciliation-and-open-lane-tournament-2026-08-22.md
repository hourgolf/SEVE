# Monday roster reconciliation and open-lane tournament

**Evidence through 2026-08-21 · SELECT-only · no production behavior changed**

## Bottom line

The live receipt-bound manifest does **not** give 21 channels permission to trade. It contains 21 specifications split into:

- **10 paper-entry channels** — exactly the ten channels in the published August 24 packet;
- **11 observe-only collectors** — no entry authority;
- **0 paper/observe intent mismatches**.

The confusing “21” is therefore a presentation and roster-version problem, not an accidental 21-channel live desk.

The newer evidence-led roster is different from the already published ten-channel packet. It replaces three weak live selections (`vb-curl-reversal-qqq`, `pb-ride-itm`, and `grind-v3`) with `grind-smart-entries`, leaving two genuine open lanes to award. A 35-scenario, last-priority tournament found two bounded paper candidates:

1. **`vb-gap-drift-qqq` in Account 2, 2 contracts, historical native exit**;
2. **`orb-trend-rider` in Account 3, 2 contracts, TP50, behind the incumbent ORB family**.

Together they added **+$461** over August 3–21 and **+$496** over August 10–21 in the portfolio replay, with no incumbent paths displaced. These are paper-trial estimates, not broker P&L or certainty.

## What the live 21 actually contains

| Runtime group | Count | Read |
|---|---:|---|
| Paper entry | 10 | Matches the published Monday packet |
| Observe only | 11 | Collects evidence; cannot enter |
| Intent mismatches | 0 | No control-plane posture drift |

Three observe-only specifications are outside the published packet: `pb-ride`, `vb-ribbon-cross-qqq`, and `vb-vwap-revert-qqq`. They are extra collectors, not hidden live traders.

## Published packet versus evidence-led roster

| Status | Channels |
|---|---|
| Keep in the evidence-led core | `momo-shape-2`, `vb-level-break`, `breakout`, `orb-ustop-ctl`, `vb-macd-state`, `breakout-alt-v3-itm`, `vb-rsi-revert-iwm` |
| Move from observe-only into the core | `grind-smart-entries` |
| Remove from paper entry | `vb-curl-reversal-qqq`, `pb-ride-itm`, `grind-v3` |
| Open-lane winner 1 | `vb-gap-drift-qqq` — Account 2, 2ct, bounded paper trial |
| Open-lane winner 2 | `orb-trend-rider` — Account 3, 2ct, TP50, last ORB-family priority |

This produces a ten-channel proposal again, but with three paper selections changed and two tournament winners added. It has **not** been activated.

## Open-lane tournament

Every candidate was inserted at the last priority in every compatible paper account. A candidate qualified only if it:

- improved both the August 3–21 and August 10–21 windows;
- remained non-negative after removing its single best session;
- displaced zero incumbent paths;
- retained the active account, underlying, same-OCC, and strategy-family protections.

| Candidate | Best route | Exit | 3-week add | Without best | 2-week add | Without best | Admitted 3w / 2w | Decision |
|---|---|---|---:|---:|---:|---:|---:|---|
| `vb-gap-drift-qqq` | Account 2 | native | +$254 | +$84 | +$359 | +$189 | 9 / 5 | Bounded paper trial |
| `orb-trend-rider` | Account 3 | TP50 | +$207 | +$31 | +$137 | +$21 | 5 / 3 | Smaller second-chance ORB trial |
| `vb-or-fail-qqq` | Account 2 | BANK30-BE-R50-K67 | +$28 | -$182 | +$134 | -$76 | 12 / 9 | Tail-dependent; observe |
| `vb-vwap-revert-iwm` | Account 2 | native | +$22 | -$7 | -$36 | -$61 | 15 / 10 | Recent failure; observe |
| `momo-shape` | Account 1 | FULL-R20-K50 | +$645 | -$314 | -$64 | -$142 | 6 / 4 | Tail-driven; do not replace Momo 2 |
| `pb-ride-2` | Account 3 | native | -$7 | -$74 | -$143 | -$192 | 15 / 10 | Reject for the lane |
| `qqq-thrust-trail` | Account 2 | native | +$192 | -$810 | -$697 | -$697 | 8 / 6 | Good movement, unusable native conversion |

The remaining candidates either admitted no recent paths into their best route or failed one of the two time windows. In particular, **`breakout-smart-entries` did not earn the lane**: its attractive small holdout did not turn into a recent marginal portfolio contribution.

## Important channel reads

### `vb-gap-drift-qqq`

- 17 independent sessions and 89 research opportunities;
- typical favorable move **+39%** and typical native result **+25%**;
- positive after removing its best session in both windows;
- no conflict with the corrected core because it fills an otherwise open QQQ lane;
- worst session in the replay was **-$216**, which is why the proposed first exposure is two contracts rather than a size-up.

This is the clearest open-lane winner.

### `orb-trend-rider`

- 19 independent sessions and 91 research opportunities;
- TP50 is the paired exit used in the tournament;
- Account 1 and Account 2 failed the recent-window test;
- Account 3 worked only as a **last-priority sibling behind `orb-ustop-ctl`**, with the shared `SPY-ORB` family protection intact;
- only three recent opportunities were admitted, so this is a small paper trial—not evidence that it should replace `orb-ustop-ctl`.

This is useful as a selective second ORB expression, not as unrestricted duplicate exposure.

### Momo sibling decision

Replacing `momo-shape-2` with `momo-shape` + FULL-R20-K50 lost **$35** over three weeks and **$225** over the recent two weeks. Removing the best session made the replacement materially worse. Keep the `momo-shape-2` entry logic; continue testing better profit conversion on those entries instead of switching to the noisier sibling.

## Trust boundaries

- The replay uses exact option paths for named challenger managers and historical virtual native paths otherwise.
- Absolute replay totals from different reports are not directly comparable when their coverage and exact-path requirements differ; decisions here use paired deltas within the same run.
- Known siblings retain their real strategy family. Renaming a candidate cannot bypass same-domain family or OCC protection.
- Cross-account same-OCC remains permitted where the active policy permits it; exits stay independent.
- No roster, manager, size, account, broker, order, position, production research row, deployment, or schedule changed.

## Recommendation

Prepare—but do not yet activate—the evidence-led ten-channel Monday manifest:

1. use the corrected eight-channel core;
2. award the QQQ lane to `vb-gap-drift-qqq` at 2ct in Account 2;
3. add `orb-trend-rider` at 2ct in Account 3 behind `orb-ustop-ctl`, with TP50 and the shared ORB family protection;
4. keep `breakout-smart-entries` observe-only;
5. preregister rollback conditions for each new trial independently.

Activation should wait for an exact manifest diff, flat-boundary check, receipt generation, and explicit approval.
