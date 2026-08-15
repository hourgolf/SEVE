# SEVE next-week decision plan · 2026-08-17

**Paper-only proposal · channel-specific changes · no activation authority**

## Decision summary

| Channel / desk area | Monday posture | One thing being tested | Kept fixed | Friday decision |
|---|---|---|---|---|
| `grind-v3` | Propose two-entry governor | Maximum two executed entries per session; continue scoring later blocked candidates virtually | Entry formula, 4 contracts, native exit, Account 3 route, priority 3 | Keep cap 2, restore cap 3, or design a signal-quality gate |
| `orb-ustop-ctl` | Keep live and first in Account 3 | Did priority suppress good candidates, or did the entry simply fail to develop? | Entry formula, 4 contracts, +50% all-out exit, route | Keep priority, change one entry variable, or continue unchanged |
| `vb-macd-state` | Keep live | First entry versus later eligible entries; capacity is not assumed helpful | Native exit, 4 contracts, Account 2 route | Keep one-entry posture or preregister a second-entry experiment |
| `vb-gap-drift` | Keep live | Continue exact-current collection | Entry, exit, 2 contracts, route | Hold unless a repeatable current-era pattern appears |
| `vb-ribbon-cross-iwm` | Promotion candidate for Account 2 | Two-contract, first-entry-only independent IWM paper root | Native +25% target and −30% stop; Account 2 global cap remains 2 | Keep the one-entry posture, return to dark, or retune one variable |
| `breakout-alt-v3-iwm` | Keep live in Account 1 | Parallel IWM behavior versus the VB candidate | Existing entry, exit, size, and route | Compare unique behavior, not just profit |

## Rest of the executing roster

| Channel | Next-week posture | Nightly focus |
|---|---|---|
| `breakout` | Keep unchanged | Confirm its native exit continues retaining favorable movement |
| `breakout-alt-v3-itm` | Keep unchanged with bounded Account 3 overflow | Count opportunities newly admitted by overflow and any displaced peer |
| `grind-v3-2` | Keep unchanged | Confirm its positive typical trade persists beyond two current sessions |
| `grind-smart-entries` | Keep unchanged | Compare its entry-quality contrast with `grind-v3`; do not pool the channels |
| `momo-shape-2` | Keep unchanged at two contracts | Collect exact-current evidence; no size or manager change |
| `orb-qqq-trail` | Keep unchanged | One current loss is not an exit verdict; collect paired path evidence |
| `pb-ride` | Keep unchanged | Diagnose why entries fail to develop before changing its exit |
| `pb-ride-itm` | Keep unchanged at one contract | Confirm positive typical behavior and account-room cost |
| `qqq-thrust-trail-wd` | `LOCK20/30` paper experiment active | Native all-out +20% / -30% stop versus the former +50% / -50% native as the paired shadow control; entry, size, and route stay fixed |
| `vb-gap-drift` | Keep unchanged | Build an exact-current sample before revisiting its manager |
| `vb-macd-state` | Keep native live; continue A13 shadow | Separate first entry from blocked later opportunities |

No executing channel receives a size increase in this plan.

## Why the Grind governor is cap 2

The chronological realized-logical-trade replay compared several governors without changing the exit or size.

| Cohort | Native | Cap 2 | Change | Trades retained |
|---|---:|---:|---:|---:|
| Aug 10–14 | −$496 | −$296 | +$200 | 8/12 |
| Jul 27–Aug 14 | +$241 | +$363 | +$122 | 19/24 |
| Structural history, mixed legacy eras | −$1,222 | −$950 | +$272 | 66/123 |

A one-entry cap improved dollars but kept the weakest current-week entry bucket and discarded too much evidence. A stop-after-first-loss rule improved mixed legacy history but was −$2 versus native in the recent paper era. Cap 2 is the least assumption-heavy forward paper test.

The third and later candidates must remain observable as virtual paths with the exact block reason. That makes the governor reversible and tells us what it protected versus what it cost.

## ORB investigation

ORB's new Account 3 priority is a forward experiment. Historical replay did not recover a completed ORB path merely by moving ORB first. Four of five current-era trades also failed to exceed roughly +11% favorable movement, so the current evidence points to entry quality before exit management.

For every ORB candidate next week, record:

1. signal time, direction, OR width, VWAP side, momentum/ATR, relative volume, gap, and option debit;
2. whether it was admitted, suppressed by same-clock priority, blocked by occupancy/capital, or rejected by cost;
3. the complete virtual option path for every non-fill;
4. first-versus-later entry order and time bucket;
5. native +50% outcome and paired manager alternatives only when favorable movement existed.

The Friday question is whether strong ORB opportunities disappeared because the market regime changed, because the entry thresholds drifted into weaker candidates, or because desk admission hid them. Priority alone is not currently the leading explanation.

## VB admission review

`vb-macd-state` was usually stopped by its own session-entry limit after its first fill. Nine later signals were marked as underlying-capacity blocks during the week, but capacity was not consistently valuable: the frozen-cohort replay was approximately +$46 on Aug 11 and −$209 across the later cohort. Therefore no blanket VB priority or capacity expansion is proposed.

Next week's comparison is first entry versus later logical opportunity, clustered by session. Repeated minute rows from one continuing signal must not be counted as independent opportunities.

## Additional IWM slot

The leading candidate is `vb-ribbon-cross-iwm`, specifically with a one-entry-per-session governor:

| Entry allowance | Paths | Total / contract | Typical session | Positive sessions |
|---|---:|---:|---:|---:|
| First entry only | 27 | +$245.15 | +$14.50 | 20/27 |
| First two entries | 49 | +$156.40 | +$3.15 | 16/27 |
| First three entries | 62 | +$172.40 | +$6.95 | 15/27 |
| All observed entries | 71 | +$40.10 | −$1.70 | 13/27 |

The signal appears useful early and degrades when repeated. The proposed paper root therefore keeps the exact 9/21 ribbon-cross entry, native +25% target, −30% premium stop, and two-contract size, but admits only the first entry each session.

Recommended placement is Account 2. Account 2 currently has `maxOpenGlobal: 2`, `SPY: 1`, and no executing IWM root. Add `IWM: 1` and same-clock IWM capacity 1 while leaving the global cap at 2. This permits one SPY plus one IWM position; it does not authorize a third simultaneous position or weaken same-account OCC protection.

The initial `vb-rsi-revert-iwm` candidate was rejected after the exact chronological screen. Its positive median opportunity hid a negative total of about −$140 per contract across 55 paths, with only 9 of 21 sessions positive on a summed-session basis. It remains research evidence, not a promotion candidate.

`vb-vwap-revert-iwm` remains highly repetitive and redundant. It is a useful shadow comparator, not the first new root.

## Nightly scorecard

The default nightly view should answer five questions in one row per experiment:

1. What executed?
2. What was blocked, and what did the blocked opportunity later do?
3. Did the native exit retain available movement?
4. Did the experiment improve the typical session without worsening downside?
5. Did it displace a better opportunity?

Raw signal rows, manager arms, hashes, and provenance stay behind detail disclosure.

## Evidence gates for Friday

- Do not pool portfolio epochs or silently mix legacy and current channel configurations.
- Use logical opportunities and session-clustered comparisons.
- Treat the week as a paper experiment, not a permanent optimization verdict.
- A positive total is insufficient if the typical session is negative or one winner dominates.
- Keep entry and exit experiments separate for each channel.
- Cross-account same-OCC overlap remains permitted with independent exits.
- Any activation requires a flat desk, exact receipt-bound preview, rollback target, and separate approval.

## Current recommendation

- **GO to prepare:** `grind-v3` cap 2 and first-entry-only `vb-ribbon-cross-iwm` in Account 2 at two contracts.
- **GO to measure unchanged:** ORB-first priority, `vb-macd-state` first-versus-later entries, current exit shadows.
- **NO GO:** broad VB priority change, unrestricted capacity expansion, ORB exit change before diagnosing entry quality, or a second simultaneous variable change on any channel.
