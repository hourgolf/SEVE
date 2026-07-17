# Weekend Day 1 — Gate 4 complementary Monday roster proposal

Status: **design proposal only; roster finalization and configuration changes are not authorized**.

The unit of evidence is an independent family opportunity. Same-clock siblings are one correlated group.
Exit-only alternatives share one root entry and run in shadow. A separate paper fill is reserved for an
actual admission, timing, DTE, strike, contract-selection, or underlying contrast and still requires an
explicit experimental reason.

## Proposed roots and shadows

| Cohort | Proposed executed root | Paper reason | Shadow/dark comparisons | Family concentration proposal |
|---|---|---|---|---|
| SPY pullback | `pb-ride` | 1DTE ATM pullback/continuation root | `pb-ride-2` for DTE/manager; `pb-ride-itm` for strike | one PB opportunity; root fill only |
| SPY ORB | `orb-ustop-ctl` | ORB baseline; only after premium-stop default is explicitly stamped | `orb-ustop`, `orb-trend-rider`, `orb-spy-trail` manager/structural alternatives | one ORB opportunity; root fill only |
| SPY grind | `grind-v3` | distinct grind continuation hypothesis | `grind-v3-2`, `grind-smart-entries` DTE/filter alternatives | one grind opportunity; root fill only |
| SPY momentum | `momo-shape` | distinct shaped-momentum hypothesis | `momo-shape-2` manager/target sibling | one momentum opportunity; root fill only |
| QQQ ORB | `orb-qqq-trail` | separate underlying and QQQ ORB hypothesis | QQQ thrust/breakout siblings remain shadow | one QQQ opportunity |
| IWM breakout | `breakout-alt-v3-iwm` | separate underlying and IWM expansion hypothesis | `breakout-smart-entries-iwm` admission/filter sibling | one IWM opportunity |

No power or mean-reversion root is proposed because operational/evidence readiness does not justify one.
Every VB candidate remains dark. At most one LAB VB paper channel may be considered later, but none currently
meets the exact-path evidence floor, so this proposal selects zero.

## Correlation and risk

The July 17 replay contained a seven-channel 10:16 SPY CALL cluster and four three-way PB clusters. The
proposal removes sibling multiplication, but distinct SPY roots can still share the same source clock and
direction. They must carry one declared `SPY_DIRECTION_CLOCK` concentration tag and an operator-ratified
family admission rule before execution. Until that exists, the roster is blocked rather than pretending
four SPY hypotheses are diversification.

Current unlearned per-root risk budgets sum to $4,400 and current max-contract ceilings sum to 64. These
are ceilings, not targets. The proposed family constraints are max one open position per root family, max
one executed sibling per family opportunity, and an unresolved cross-family SPY same-clock cap. Whole-lot
bank/runner allocations are also unresolved. The account daily latch remains an account safety control and
is not represented as a channel stop.

## July 17 capacity replay

Using the read-only July 17 report and only the six proposed roots:

- 17 of 66 executed trades (26% of the observed trade count);
- 165 opened contracts before collision suppression;
- at most 17 position rows and approximately 16 distinct entry OCCs;
- no more than six channel decision evaluations per source minute, plus dark research evaluation;
- approximately 1,500–3,000 batched held-capture receipts if duration-weighted load resembles July 17,
  versus the Gate 1 full-session projection of 6,022. This is a capacity range, not a storage guarantee.

The estimate does not assume P&L improvement. July 17 was one session and cannot promote or reject a root.
Provider load is driven by unique held OCCs and hold duration, so the pre-open rehearsal must recompute the
upper bound from the final ratified caps.

## Experimental-design controls

- Candidate identity is channel version + configuration epoch + exact source clock + underlying + side +
  OCC; account is provenance.
- Sibling outcomes cluster by session and opportunity clock. Report independent opportunities, sessions,
  worst-session contribution, negative concentration, and leave-one-session-out results.
- Phase 1K-E currently keys scorer inputs by slug/clock, not channel/manager/config versions. Any Monday
  configuration change would leak July 16–17 evidence into July 20. Either keep the policy unchanged or add
  a new versioned contract before scoring.
- The positive-share prose includes zero deltas in complete groups while the current scorer drops zero
  deltas. No decision may use that statistic until a later versioned contract resolves it conservatively.
- Synthetic native VB results are development-only. Exact executable bid paths are required for candidate
  manager evidence.

## Operator decisions required

The operator must ratify the six roots, every shadow, the cross-family SPY collision rule, risk and contract
ceilings, explicit stop defaults, whole-lot manager allocations, EOD behavior, exact VB posture, and the
complete strategy/configuration diff. Until then this is not the Monday roster and no configuration may be
applied.
