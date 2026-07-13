# Entry quality and manager separation — first dive

## Why this study exists

Recent PB and Momo paper profitability improved after operator-set manager overrides. Older research often judged an inseparable bundle—entry, arbitrary exit, sizing, execution and shared-OCC effects—and therefore could discard a useful entry because its manager rode a transient winner into the bell.

This study separates those questions. It does **not** reverse the current-policy replay; it explains why recent manager-era results and long-history bundled results can disagree.

## Entry-path method

`npm run entry-path-study` freezes the first valid cost-gated entry per channel/session and follows the selected contract's causal one-minute executable-bid path to the bell. It uses current entry specs, DTE and strike offset, but no manager, re-entry, conviction sizing or pyramiding. MFE is an outcome label only and never influences a decision.

The full chronological path, entry context and coverage are written to the gitignored `data/databento-v2/manifests/entry-path-study.json`. Current local policy hash: `4a26afcfb1a8`.

## Load-bearing result

| Entry engine | n | Median executable MFE | Reached +20% | Median bell return | Went ≥+10%, finished red |
|---|---:|---:|---:|---:|---:|
| breakout-smart-entries | 320 | +66.49% | 79.7% | -72.17% | 54.1% |
| breakout-alt-v3 | 335 | +67.96% | 79.1% | -69.90% | 52.8% |
| momo-shape-2 | 600 | +72.50% | 76.2% | -76.38% | 50.8% |
| qqq-thrust-trail | 406 | +71.65% | 76.1% | -71.38% | 50.5% |
| orb-trend-rider / orb-ustop | 767 | +70.07% | 76.7% | -70.07% | 49.8% |
| orb-qqq-trail | 512 | +63.52% | 75.0% | -66.62% | 48.4% |
| vb-ribbon-cross | 783 | +49.47% | 72.5% | -54.36% | 46.7% |
| vb-squeeze-break-qqq | 1,047 | +60.87% | 73.4% | -76.47% | 49.9% |

This validates the operator's core diagnosis: these entry engines frequently identify real premium expansion, while ride-to-bell management systematically gives it back.

It does **not** prove that every entry is good. Median MAE is roughly -82% to -92%. Many eventual +20% paths first suffer a large drawdown. MFE alone is a ceiling; the order of MFE and MAE determines whether a causal manager can harvest it.

## Preregistered manager lab

The manager family and success criteria were frozen in `docs/manager-lab-preregister-2026-07-12.md` before evaluation. `npm run manager-lab` compares identical one-contract entries under six managers and two controls using the chronological executable path.

No manager passed the registered durability gate.

- A -30% premium stop often exits before the contract later recovers to +20%; simply tightening the stop is not a solution.
- WIDE20/50 was pooled-positive for Smart (+$1,288) and V3 (+$1,353), but each was positive in only two of five calendar years.
- QQQ Thrust was approximately flat under WIDE20/50 (-$165) and LOCK50/30 (-$7), but positive in only one calendar year.
- Momo, ORB and the two tested VB engines remained negative under every registered manager.
- Banking half and riding a runner did not rescue the entries under the registered +20/+50 structure.

Therefore, the current evidence supports **manager development**, but not a universal static target. We must distinguish clean-developing entries from recoveries that reach MFE only after unacceptable heat.

## Exploratory context attribution

`npm run entry-context-study` applies the registered WIDE20/50 manager across fixed entry-context bins. This is discovery-only.

- ER below 0.25 is poor in aggregate; ER 0.40–0.60 improves Smart/V3 and SPY ORB. This corroborates the existing efficiency-ratio trend gate rather than discovering a new lever.
- Relative volume, gap magnitude and raw momentum show no stable monotonic rescue.
- Later entries appear better in aggregate but are sparse and inconsistent by channel.
- No new historical gate is justified from this pass.

## Forward requirement

The historical option archive is one-minute. It cannot resolve a target that appeared and disappeared inside that minute. The live worker already provides a better forward substrate:

- the fast sweep evaluates fresh executable bids roughly every ten seconds;
- running peak/trough and their timestamps persist to the position row;
- Phase 1D records decision/broker evidence;
- Phase 1E links the policy/manager epoch through position lineage to final outcome.

For clean manager comparisons, the next shadow slice should evaluate the small preregistered manager set during the existing ten-second sweep and append only each manager's **first counterfactual exit event**. It should not store every quote, alter an order, or change a live manager. Deterministic `(position, manager)` ids make the first event restart-safe and prevent a later trigger from overwriting the earlier causal outcome.

Monday-forward reads should compare actual manager outcome against those shadow exits by policy epoch. That is the credible path from max-peak diagnostics to a swappable manager library.

## OCC status

- Shared-OCC row attribution and booking are substantially repaired; Phase 1E now preserves parent/remainder/runner lineage and manual reasons.
- The same-channel pyramid stack is capped to its row rather than sibling OCC holdings.
- Desk-level correlated concentration is **not fully solved**. `stack_cap_n` is dark by default, and the full per-OCC contract/premium allocator remains part of the independent risk-service work.
- Older history is not retroactively cleaned. Policy epochs and outcome lineage make forward paper evidence materially more trustworthy.
