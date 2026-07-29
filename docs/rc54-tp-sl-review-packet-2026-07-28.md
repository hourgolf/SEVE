# RC5.4 TP/SL review packet — 2026-07-28

Status: **LOCAL · READ-ONLY · NO CHANGE AUTHORITY**

This packet summarizes the first two paper sessions of the sealed RC5.4
release. It does not authorize a proposal, configuration change, activation,
deployment, Railway restart, order, or trade.

## Executive conclusion

SEVE is ready for a disciplined TP/SL discussion, but the current RC5.4 sample
is not large enough to justify changing a live paper policy.

- 14 independent opportunities were executed across 2 sessions.
- The position ledger records **+$928** over 28 contracts.
- All 21 resulting position rows have immutable execution-account routes to
  configured paper accounts.
- All 21 position rows have exit-fill quality receipts.
- All 112 expected portable manager paths are terminal: 14 opportunities × 8
  registered shadow arms, with zero censors.

The useful early signal is channel-specific, not a universal stop or target
change. Bank-plus-remainder profiles were positive in this tiny sample. The
unprotected `RC53-RIDE` family showed a large giveback case, but its five
opportunities are too heterogeneous and include one operator close. A global
change would be overfitting.

The manual-close plumbing defect found during this review is now corrected in
production by PR #26 / merge commit `fae9d5a1`. Authenticated manual closes
resolve the latest immutable execution account, fail closed on missing or
unreadable routing, and derive receipt economics from the position's sealed
RC5.4 manager stamp rather than mutable current configuration.

The historical July 27 `grind-v3` receipt remains invalid for policy-field
analysis: it recorded a 35% stop and 6% take profit even though the sealed lot
was `RC53-RIDE` with a 30% catastrophe stop and no target. The correction does
not rewrite that immutable historical fact.

## Evidence identity and scope

- Release: `week2-2026-07-27-rc5.4`
- Configuration SHA-256:
  `a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227`
- Evidence dates: July 27–28, 2026
- Price basis for sealed managers: executable option bid
- Mode: paper only
- Quantity: 2 contracts per opportunity
- Actual evidence source: positions filtered by the exact release ID and
  configuration hash stamped in `entry_features.release_evidence`
- Opportunity identity: stamped `entry_features.opportunity_id`
- Account attribution: latest immutable
  `execution_observations.account_id` for each `position_id`

The 21 position rows are not 21 independent trades. Target-plus-runner managers
split one two-contract opportunity into a parent row and one child row. This
packet rolls those rows back up to 14 opportunities.

The draft control-plane manifest and channel-spec rows are not runtime
authority and are not used to infer these outcomes.

## Sealed RC5.4 manager matrix

Every profile uses a 30% catastrophe stop, a 15:25 ET admission/liquidation
boundary, no reentry, no adds, and executable-option-bid marks.

| Channel | Cohort | Manager profile | First bank | Remainder |
| --- | --- | --- | ---: | --- |
| `pb-ride` | Control | `RC53-RIDE` | none | full-position ride |
| `grind-v3` | Control | `RC53-RIDE` | none | full-position ride |
| `momo-shape` | Control | `RC53-A13` | none | full position arms at +50%, then retains two thirds of peak gain |
| `orb-ustop-ctl` | Control | `ORB54-B30-A13` | 1 at +30% | 1 on A13 |
| `orb-qqq-trail` | Control | `QQQ54-B20-NATIVE-ATR` | 1 at +20% | 1 on native ATR chandelier |
| `breakout-alt-v3-iwm` | Control | `RC53-RIDE` | none | full-position ride |
| `vb-macd-state` | LAB | `LAB54-L30-L50` | 1 at +30% | 1 at +50% |
| `vb-squeeze-break` | LAB | `LAB54-L30-L50` | 1 at +30% | 1 at +50% |
| `vb-ribbon-cross-qqq` | LAB | `LAB54-B50-A13` | 1 at +50% | 1 on A13 |

`vb-ribbon-cross-qqq` had no RC5.4 execution in the two-session sample.

## Actual opportunity ledger

`Max leg MFE` is the highest marked return observed on any surviving leg. For a
split position it is not the P&L of the original two-contract lot at that
moment, so it must not be summed or treated as portfolio MFE.

| Date | Channel | Profile | Actual P&L | Return on initial debit | Max leg MFE | Min leg MAE | Close mix |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 07/27 | `breakout-alt-v3-iwm` | `RC53-RIDE` | -$46 | -31.5% | +191.8% | -31.5% | premium stop |
| 07/27 | `grind-v3` | `RC53-RIDE` | +$510 | +153.6% | +194.0% | -19.3% | operator target |
| 07/27 | `momo-shape` | `RC53-A13` | +$142 | +47.0% | +69.5% | -4.0% | A13 giveback |
| 07/27 | `orb-qqq-trail` | `QQQ54-B20-NATIVE-ATR` | +$122 | +23.4% | +84.7% | -2.7% | bank + ATR trail |
| 07/27 | `orb-ustop-ctl` | `ORB54-B30-A13` | +$185 | +57.1% | +125.9% | -1.2% | bank + A13 |
| 07/27 | `pb-ride` | `RC53-RIDE` | -$154 | -30.0% | +6.2% | -29.2% | premium stop |
| 07/27 | `vb-macd-state` | `LAB54-L30-L50` | +$143 | +46.4% | +52.6% | -0.6% | +30% bank + +50% target |
| 07/27 | `vb-squeeze-break` | `LAB54-L30-L50` | -$94 | -33.6% | +15.7% | -32.1% | premium stop |
| 07/28 | `grind-v3` | `RC53-RIDE` | -$70 | -30.4% | +16.5% | -30.4% | premium stop |
| 07/28 | `orb-qqq-trail` | `QQQ54-B20-NATIVE-ATR` | +$54 | +17.2% | +38.9% | -28.7% | bank + ATR trail |
| 07/28 | `orb-ustop-ctl` | `ORB54-B30-A13` | +$117 | +48.3% | +102.5% | -9.1% | bank + A13 |
| 07/28 | `pb-ride` | `RC53-RIDE` | -$212 | -30.5% | +13.5% | -30.5% | premium stop |
| 07/28 | `vb-macd-state` | `LAB54-L30-L50` | +$121 | +42.9% | +60.3% | -29.1% | +30% bank + +50% target |
| 07/28 | `vb-squeeze-break` | `LAB54-L30-L50` | +$110 | +41.0% | +50.7% | -8.2% | +30% bank + +50% target |

## Session and profile rollups

| Session | Opportunities | Wins / losses | Actual P&L | Return on initial debit |
| --- | ---: | ---: | ---: | ---: |
| 07/27 | 8 | 5 / 3 | +$808 | +29.6% |
| 07/28 | 6 | 4 / 2 | +$120 | +5.9% |
| Total | 14 | 9 / 5 | **+$928** | **+19.5%** |

| Active profile | Opportunities | Wins / losses | Actual P&L | Return on initial debit | Limitation |
| --- | ---: | ---: | ---: | ---: | --- |
| `LAB54-L30-L50` | 4 | 3 / 1 | +$280 | +24.6% | two channels, two sessions |
| `ORB54-B30-A13` | 2 | 2 / 0 | +$302 | +53.4% | one channel, two paths |
| `QQQ54-B20-NATIVE-ATR` | 2 | 2 / 0 | +$176 | +21.1% | one channel, two paths |
| `RC53-A13` | 1 | 1 / 0 | +$142 | +47.0% | one path |
| `RC53-RIDE` | 5 | 1 / 4 | +$28 | +1.5% | one +$510 operator close masks four automated losses totaling -$482 |

## Execution-quality checks

- Premium-stop exits: 5 receipts covering 10/10 requested contracts. Average
  trigger was -31.0%, average realized return was -31.2%, and average threshold
  overshoot was 1.2 percentage points.
- Target exits: 10 one-contract receipts covering 10/10 requested contracts.
  Average trigger was +36.7% and average realized return was +37.0%. The
  aggregate mixes +20%, +30%, and +50% targets and must not be interpreted as
  one configured target.
- Trail exits: 3 receipts covering 4/4 requested contracts. Average trigger was
  +63.7% and average realized return was +64.6%.
- ATR-chandelier exits: 2 one-contract receipts covering 2/2 requested
  contracts. The quality schema currently classifies these as `other`; the
  position close reason preserves `trail_chandelier`.
- Operator exit: 1 two-contract receipt, filled in 384 ms. Its recorded
  configured stop/target fields are mutable-config metadata and conflict with
  the sealed position stamp, as described below.

The observed stop slippage does not support widening the 30% catastrophe stop.
Five stops are also far too few to support tightening it. The more interesting
question is whether selected channels should protect gains after a meaningful
favorable excursion.

## Portable manager evidence

All eight registered manager arms reached terminal observations for all 14
opportunities, producing 112/112 complete paths with zero censors.

| Portable arm | Runs | Wins / losses | Modeled P&L | Average terminal return |
| --- | ---: | ---: | ---: | ---: |
| `LOCK50/30` | 14 | 9 / 5 | +$862 | +24.0% |
| `ARM20/HALF-GIVEBACK` | 14 | 10 / 4 | +$600 | +17.7% |
| `LOCK30/30` | 14 | 10 / 4 | +$440 | +13.9% |
| `BANK20/RUN50` | 14 | 10 / 4 | +$391 | +11.6% |
| `LOCK20/30` | 14 | 10 / 4 | +$192 | +8.2% |
| `WIDE20/50` | 14 | 11 / 3 | +$16 | +7.6% |
| `BELL/-30` | 14 | 3 / 11 | -$344 | -4.0% |
| `BELL/no-stop` | 14 | 3 / 11 | -$1,536 | -30.1% |

These are executable-bid counterfactual paths, not broker fills. They are
comparable to one another over the same 14 source opportunities. Their stored
`actual_realized_pnl` field is not comparable to the opportunity-level actual
total because it records the parent row but does not roll up runner-child P&L.
For that reason this packet does not publish a modeled-minus-actual delta.

The two-session pooled leader is `LOCK50/30`. That is not a universal-policy
recommendation. Earlier exact and Week 1 evidence produced different pooled and
channel-level leaders. The stable conclusion is that manager behavior is
channel-specific and should not be selected from a pooled two-session winner.

## Confirmed findings

### Keep unchanged

- The 30% catastrophe stop. Current evidence neither justifies widening nor
  tightening it.
- `ORB54-B30-A13`. Both first observations were positive, but two paths are not
  enough to optimize it.
- `QQQ54-B20-NATIVE-ATR`. Both first observations were positive; keep gathering
  evidence.
- `LAB54-L30-L50`. Three of four opportunities were positive and the one loss
  stopped as designed.
- `RC53-A13` for `momo-shape`. One path is only a plumbing confirmation.

### Investigate without changing runtime

- `breakout-alt-v3-iwm` gave back a +191.8% favorable excursion and eventually
  hit the -30% catastrophe stop. That is a strong single-path reason to
  preregister a channel-specific profit-protection comparison, not to change
  the global stop.
- `pb-ride` stopped twice after only +6.2% and +13.5% maximum favorable
  excursions. A profit lock would not have rescued either path. This points
  more toward entry/path quality than a simple target change.
- `grind-v3` had one +153.6% operator close and one -30.4% automated stop.
  Operator intervention makes the active result unsuitable for tuning until
  more fully automated paths arrive.
- The `RC53-RIDE` family should be analyzed by channel. Pooling PB, Grind, and
  IWM hides three different path shapes.

### Corrected before routine configuration activation

Production `app/api/close-position/route.ts` now:

1. chooses broker credentials through the position's latest immutable
   `execution_observations.account_id`; and
2. writes configured stop/target receipt fields from the sealed RC5.4 manager
   stamp.

The canonical account rule is the latest immutable
`execution_observations.account_id` for the exact `position_id`, with no
fallback to the strategist's current assignment. Missing routing or an
unconfigured/non-paper account leaves the position open and places no order.

The correction changed no strategy, configuration, migration, roster, Railway
worker, or release economics.

## Recommended decision sequence

1. Review this packet as evidence, not as an approval request.
2. Treat the production manual-close correction as complete; do not reinterpret
   the historical July 27 receipt.
3. Continue RC5.4 unchanged while gathering additional independent sessions.
4. Preregister channel-specific shadow comparisons for:
   `breakout-alt-v3-iwm`, `pb-ride`, and `grind-v3`.
5. Re-run the packet after the preregistered evidence floor is reached.
6. Only then draft a bounded proposal for a single channel/profile if the
   evidence remains coherent. Quantity, catastrophe stop, bank target, and
   remainder manager must be reviewed as separate decisions.

No production deployment is needed to review the evidence or specify the next
shadow comparisons. A deployment would only become relevant after a reviewed
code correction or an explicitly approved configuration proposal.
