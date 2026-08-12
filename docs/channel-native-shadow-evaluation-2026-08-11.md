# Native and shadow configuration evaluation — through 2026-08-11

**DECISION PREPARATION ONLY · NO CONFIGURATION OR ROSTER MUTATION**

This packet assigns one primary learning job to every channel. “Native” means the
configuration that would produce the paper result. “Shadow” means a paired,
non-ordering challenger on the same logical opportunity. For dark channels, native
means the existing virtual control path; it does not imply promotion.

The aim is not to wait for certainty. It is to make the best reversible paper choice
available, preserve the displaced configuration as a shadow control, and rotate the
next challenger only when it answers a different question.

## Recommended operating rules

1. One native behavior and one primary shadow question per channel. A second shadow is
   allowed only to preserve the displaced native when a challenger becomes executable.
2. Change one axis per configuration epoch: entry, exit, size, or route—not several.
3. Review after the later of three independent sessions or five logical opportunities.
   Move sooner after two clean, same-direction failures or a broken safety invariant.
4. A successful paper challenger may become native; the prior native then remains in
   shadow. Nothing is discarded merely because it is displaced.
5. Presets are reference controls. Exact targets, arms, floors, and tranche sizes may
   be channel-specific.

## Lane A — active paper channels

These are the only rows where “native trial” would alter paper behavior. They are
proposals, not active changes.

| Channel | Evidence at first glance | Proposed native | Primary shadow | Decision |
|---|---|---|---|---|
| `breakout` | 2 sessions / 2 trades; typical best move +17%; current +22% target often not reached | Trial all-out **TP +17%**; keep entry, size, route, and −40% catastrophe stop fixed | Current TP +22% | Prepare. This directly tests whether the target sits above the channel’s normal opportunity. Do not use LOCK50/30 as the first answer to a +17% move distribution. |
| `breakout-alt-v3-iwm` | 5/5; roughly +22% best move but only 46% captured | Trial **all-out TP +20%** | Current bank +20% / A13 runner | Prepare. The entry finds a move; the runner appears to give much of it back. |
| `grind-v3` | 2 sessions / 6 outcomes; typical best move +24%, result negative | Trial **bank half +20%, remainder floor at breakeven after bank** | Current bank +25% / A13 | Prepare, but score separately from sizing. The current first bank sits just above the typical move. |
| `momo-shape-2` | 3/3 positive; typical capture approximately 100% | Keep **all-out TP +27%** | TP +21% only as an opportunity-cost comparison | Keep. Do not disturb a native exit that is currently retaining the move. |
| `orb-qqq-trail` | 7/7; +38% best move, only 23% retained | Trial **bank half +30%, A13 remainder** | Current bank +20% / native ATR | Prepare. This is the cleanest next manager reversal; bespoke bank +11 / arm +53 stays research-only until more paths corroborate it. |
| `orb-ustop-ctl` | 1 session / 3 current trades; +81% best move, 52% retained | **LOCK50/30**, as operator-selected | Current bank +30% / A13 | Queue remains valid. Score manual closes separately. |
| `pb-ride` | 2/2; typical best move +12%, current first target +50%, typical result −$67/ct | Trial **all-out TP +12%** | Current bank +50% / A13 | Prepare as an aggressive paper correction. The existing threshold is structurally above the observed opportunity. |
| `pb-ride-itm` | 1 session / 3 trades; +$27/ct; approximately 96% captured | Keep **all-out TP +10%** | TP +43% | Keep native. Shadow tests whether the current target exits too early without sacrificing its consistency. |
| `qqq-thrust-trail-wd` | 1 losing trade with no favorable move | Keep TP +50% temporarily | Current exit with a stricter/delayed entry eligibility stamp | Entry-first. No exit can capture a move that never existed. |
| `vb-gap-drift` | 2/2 positive; about 93% of the move retained | Keep **all-out TP +25%** | Same entry/exit at expanded notional in capacity replay only | Keep. Exit tuning is not the current constraint. |
| `vb-macd-state` | 2/2 current outcomes negative; typical move about +20%; bank starts at +30% | Trial **all-out TP +18%** | Current bank +30% / run to +50% | Prepare. Do not size this channel up until the reachable-exit experiment is scored. |
| `vb-ribbon-cross-qqq` | 1 session / 2 outcomes; +$14.5/ct and 84% capture | Keep current bank +50% / A13 | All-out TP +25% | Keep. The shadow asks whether a reachable fixed exit is steadier; there is no case for replacing a useful native yet. |
| `vb-vwap-revert-qqq` | 2 sessions / 6 outcomes; +$20.5/ct and about 100% capture | Keep **all-out TP +15%** | TP +20% | Keep. Shadow only tests whether more room adds value. |

## Lane B — strongest paper-promotion candidates

| Channel | Proposed paper-native configuration | Shadow control/challenger | Why this is the useful experiment |
|---|---|---|---|
| `fomc-follow` | Promote with **arm +35%, retain two-thirds** | Existing native plus custom arm +15% / retain 25% | The +35/two-thirds benchmark has the best robust paired result; the bespoke lower arm is also positive and tells us whether earlier protection is preferable. |
| `grind-v3-2` | Bounded paper placement with its current native exit and size fixed | Custom TP +39% | 16 sessions / 59 outcomes support testing execution. The target is promising but lacks a nearby stable target, so it stays shadow. |
| `grind-smart-entries` | Paper placement with **one entry per session** and native exit | Current uncapped entry behavior | Promotion evidence is positive, but entry 2 is the first weak ordinal. Solve admission before changing exit. |
| `breakout-alt-v3-itm` | Candidate paper placement with **entry 1 only** and native exit | Current multi-entry behavior | Best typical result in the breakout-alt family (+$35/ct); entry 2 is negative. Promote the clean hypothesis, not every sibling. |

## Lane C — entry/timing experiments

Native exit remains fixed in this lane. The shadow changes only the stated entry
behavior.

| Channel | Native/control posture | Primary shadow experiment | Why |
|---|---|---|---|
| `breakout-alt-v3` | Continue dark native | Cap at entry 1 | Entry 1 is +$32/ct; entry 2 is −$11/ct. |
| `breakout-alt-v3-ctl` | Continue dark native | Cap at entry 1 | Entry 2 is the first repeated weak ordinal. |
| `breakout-alt-v3-er40` | Continue dark native | Cap at entry 1 | Entry 2 is flat and later ordinals are unstable. |
| `breakout-smart-entries` | Continue dark native | Cap at entry 1 | First entry is strongest; later evidence is thin. |
| `breakout-smart-entries-ctl` | Continue dark native | Skip the first signal; admit the next qualified signal | First entry is negative while entries 2–5 are positive. |
| `breakout-smart-entries-er40` | Continue dark native | Skip the first signal | First entry is −$31/ct; entry 2 is +$23/ct. |
| `breakout-smart-entries-itm` | Continue dark native | Skip the first signal | First entry is negative; entries 2–5 are strongly positive. |
| `breakout-smart-entries-iwm` | Continue dark native | Cap at entry 1 | Entry 1 is positive and entries 2–4 are negative. |
| `breakout-qqq` | Continue dark native | Cap at entry 1 | Entry 2 is negative and later ordinals alternate; reduce churn before tuning exits. |
| `orb-trend-rider` | Continue dark native | Cap at two entries | Entry 3 is the first well-observed negative ordinal; native capture is already 75%. |
| `pb-ride-2` | Continue dark native | Cap at two entries | Entry 3 is the first well-observed loser. Compare this cleanly with executing `pb-ride`. |
| `vb-curl-reversal` | Continue dark native | Cap at three entries | Entry 4 is the first repeated negative ordinal. |
| `vb-curl-reversal-iwm` | Continue dark native | Cap at four entries | Entries 1–4 are positive; entries 5–8 turn negative. |
| `vb-curl-reversal-qqq` | Continue dark native | One-entry cap | Entry 1 is strong; entry 2 is sharply negative. |
| `vb-level-break` | Continue dark native | Cap at two entries | Entry 3 is the first repeated weak ordinal. |
| `vb-or-fail` | Continue dark native | Skip first signal; test second qualified signal | Entry 1 is negative and entry 2 is positive. |
| `vb-or-fail-iwm` | Continue dark native | Skip first signal; test second qualified signal | Same direction as SPY variant, but score independently. |
| `vb-or-fail-qqq` | Continue dark native | Tighten qualification before any entry | Early ordinals are broadly negative; merely changing exits does not repair them. |
| `vb-ribbon-cross-iwm` | Continue dark native | One-entry cap | Entry 1 is positive; entry 2 and most later entries are negative. |
| `vb-rsi-revert` | Continue dark native | One-entry cap | Entry 1 is positive and entry 2 is negative. |
| `vb-rsi-revert-iwm` | Continue dark native | One-entry cap | Entry 1 is positive; later entries are inconsistent. |
| `vb-rsi-revert-qqq` | Continue dark native | Delayed-entry window; reject the earliest signal | First three ordinals are negative while entries 4–7 are positive. |
| `vb-squeeze-break` | Continue dark native | Skip first signal | Entry 1 is negative; entries 2–3 are positive. |
| `vb-squeeze-break-qqq` | Continue dark native | Delayed-entry window | Early outcomes alternate; entry 2 is positive while entry 1 is negative. |
| `vb-vwap-revert` | Continue dark native | Bounded early-session cap; start with five entries | Early ordinals are mostly positive before churn dominates. High ordinal labels need a separate session-reset audit before trusting an exact cap. |
| `vb-vwap-revert-iwm` | Continue dark native | Reject first signal; require later confirmation | Entry 1 is materially negative; later entries are mixed. |

## Lane D — exit challengers for dark collectors

| Channel | Keep as native/control | Primary shadow exit | Decision logic |
|---|---|---|---|
| `grind-manual` | Preserve historical native only | First backfill complete executable-bid paths | A manager contest without paired paths would be invented evidence. |
| `momo-shape` | Current native dark path | **arm +43%, retain 25%** | Improved 75% of eight virtual paths with much better downside than the fixed-target alternatives; still only three sessions. |
| `orb-spy-trail` | Current native dark path | **arm +52%, retain 25%** | Improved all five paired paths and improved observed downside; collect more independent sessions before promotion. |
| `orb-ustop` | Current native dark path | **LOCK50/30 family**, then a custom lower-arm variant | Native gives back a large move. The current bespoke +161% arm is path-selected and too high to execute as the first test. |
| `power` | Current native dark path | **arm +16%, retain 25%** | Improves the typical pair and 81% of outcomes, but tail downside still crosses zero. |
| `power-final30` | Current native dark path | **all-out TP +5%** | Typical favorable movement is only about +5%; if even this cannot create positive expectancy, retire the variant. |
| `power-smart-entries` | Current native dark path | **arm +16%, retain 25%** | Improves 82% of pairs; score separately from `power`. |
| `qqq-thrust-trail` | Current native dark path | **bank first tranche +20%, floor remainder at breakeven** | Fixed targets and current trails lose; the only useful unanswered question is whether banking the first real move prevents the observed giveback. |

## Lane E — exit changes rejected; entry or lifecycle is the real question

These channels were initially labeled “review exit,” but their native capture is often
reasonable and the tested exits are neutral or worse. Do not waste shadow capacity on
another manager until the stated entry/lifecycle question is resolved.

| Channel | Native/control | Next shadow | Reason |
|---|---|---|---|
| `vb-gap-drift-iwm` | Keep native dark exit | Tighten entry qualification | 72% capture; every adaptive exit is worse. Negative opportunity quality is upstream. |
| `vb-gap-drift-qqq` | Keep native dark exit | Entry-quality filter | 68% capture; no exit challenger adds value. |
| `vb-level-break-iwm` | Keep native dark exit | Entry/timing filter | 68% capture; every custom exit loses. |
| `vb-level-break-qqq` | Keep native dark exit | Delay first entry / emphasize later qualified signals | 66% capture; manager changes do not repair the negative entry cohort. |
| `vb-macd-state-qqq` | Keep native dark exit | Delayed-entry test | 65% capture and every adaptive exit is worse. |
| `vb-pm-trend` | Keep native dark exit | Stricter entry filter | 69% capture; exit alternatives are negative. |
| `vb-pm-trend-iwm` | Keep native only while confirming redundancy | Retirement comparison against stronger peer | 52% capture, negative typical result, and custom exits are inferior. This should graduate to retirement review if redundancy holds. |
| `vb-ribbon-cross` | Keep native dark exit | Entry-timing test | 77% capture; only one complete trail session and no basis for a manager switch. |

## Lane F — collect, archive, or pause

| Channel | Action | What remains worth learning |
|---|---|---|
| `grind` | Continue native dark collection | Only two sessions; collect independent opportunity evidence without another variant. |
| `breakout-smart-entries-qqq` | Continue briefly with no new manager | Nine outcomes are negative, but the decision cohort has not yet established redundancy. Move to retirement review if the next independent sessions remain negative. |
| `power-manual` | Archive history; do not spawn a new shadow | No scored cohort. Resume only with a specific, unique hypothesis. |
| `qqq-thrust-trail-manual` | Archive history; do not spawn a new shadow | No scored cohort. It adds no current information. |
| `breakout-alt-v3-qqq` | **Pause collector** | Negative and redundant; retirement evidence already passed review. |
| `breakout-manual` | **Pause collector** | Negative and redundant; retirement evidence already passed review. |
| `vb-macd-state-iwm` | **Pause collector** | 25 sessions / 147 outcomes, negative, and adaptive exits are inferior. |
| `vb-pm-trend-qqq` | **Pause collector** | 21 sessions / 117 outcomes, negative and redundant. |
| `vb-squeeze-break-iwm` | **Pause collector** | 25 sessions / 137 outcomes, negative, and custom exits are inferior. |

## Proposed sequence

1. Assemble reversible paper bundles for `orb-ustop-ctl`, `orb-qqq-trail`,
   `breakout`, `breakout-alt-v3-iwm`, `grind-v3`, `pb-ride`, and `vb-macd-state`.
   Each bundle must install the displaced native as a paired shadow control.
2. Prepare the four promotion packets independently; do not consume a paper route until
   collision/capacity replay identifies its account.
3. Register the entry-only shadows in Lane C. No exit or size change belongs in those
   epochs.
4. Register the eight dark exit challengers in Lane D.
5. Move the five approved retirement candidates to paused collection; archive the two
   empty manual lanes.
6. Refresh this matrix nightly. A channel moves lanes only from new paired evidence,
   not from total profit or one large winner.

## Evidence limitations

- The current trail regeneration has verified executable archives for 17 sessions and
  lacks complete archives for 33 older sessions. Missing paths are censored.
- Some historical entry-ordinal rows exceed plausible same-session counts. Exact caps
  above the early ordinals must wait for the session-reset audit; this packet uses only
  the repeated early pattern.
- “Prepare” is not activation authority. No order, position, account, route, roster,
  size, manager, entry, or production configuration changed during this evaluation.
