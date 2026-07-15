# Phase 1K-C — exact option paths and preregistered channel tests

Status: stacked implementation branch based on the Phase 1K-B review commit.
Read-only/local research only. No database migration, Supabase write, R2 write,
strategy configuration, worker runtime, order, sizing, manager, dashboard,
deployment, or production behavior is changed by this phase.

The July 15 market session was active while this work ran. It is deliberately
absent from every analysis below. Databento currently exposes the completed July
13–14 sessions to this account; July 15 becomes an untouched prospective holdout
only after its historical option data is available.

## Why 1K-C was necessary

Phase 1K-B correctly censored missing option snapshots, but its local archive
was too coarse to decide whether many entries had intraminute profit
opportunity. Four winners totaling +$1,484 opened and closed between snapshots.
That was not a small nuisance: outcome-linked missingness biased the comparable
cohort and understated favorable excursion throughout the fleet.

Phase 1K-C requests only the exact OCC contracts the desk actually traded and
uses Databento `OPRA.PILLAR` consolidated NBBO at one-second intervals
(`cbbo-1s`). It does not download whole strike windows.

Official source contract:

- Databento describes CBBO-1s as consolidated best bid/offer sampled at a
  one-second cadence;
- the historical API exposes cost estimation before download and reports a
  $2/GB unit price for this account's OPRA CBBO-1s entitlement;
- CBBO-1s is still interval data, not every OPRA book update.

## Exact-contract acquisition receipt

Read-only ledger window: 2026-07-13 through 2026-07-14.

| ET session | Positions | Exact OCC contracts | Valid CBBO-1s rows | Invalid/non-quoting rows | Compressed | Databento estimate |
|---|---:|---:|---:|---:|---:|---:|
| 2026-07-13 | 54 | 16 | 321,675 | 1,616 | 3.04 MiB | $0.049560 |
| 2026-07-14 | 48 | 18 | 332,149 | 33 | 3.15 MiB | $0.051229 |
| **Total** | **102** | **34 session-contracts** | **653,824** | **1,649** | **6.19 MiB** | **$0.100789** |

The local store is content-addressed under
`data/trade-option-paths/cbbo-1s/`. Each ET date has:

- a gzip JSON object named with the first 16 characters of its SHA-256;
- a manifest with full checksum, requested contracts, position IDs, row counts,
  valid/invalid counts, bytes, source schema, and cost estimate;
- a post-write checksum verification before the manifest is accepted.

These objects remain local and git-ignored. They have not been uploaded to R2.
The observed footprint is roughly 3.1 MiB and five cents per session for 16–18
traded contracts; that is a receipt, not a promise for higher-volume days.

## The material evidence correction

Replacing coarse snapshots contract-by-contract with CBBO-1s recovers all four
fast winners and changes the native denominator from 97/101 to **101/101**.
The authoritative native two-session P&L is again **-$9,444**; no native result
is dropped from the path analysis.

| Family | Snapshot median MFE | CBBO-1s median MFE | CBBO-1s median MAE |
|---|---:|---:|---:|
| BREAKOUT-SPY | -13.68% | +4.27% | -46.15% |
| GRIND | -4.23% | +8.93% | -18.08% |
| IWM | 0.00% | +7.27% | -38.18% |
| MOMO | +17.70% | +30.23% | -41.58% |
| ORB-SPY | -3.95% | +4.38% | -51.47% |
| PB | +8.20% | +11.48% | -7.11% |
| QQQ | +2.05% | +6.16% | -43.44% |
| VB | +3.70% | +17.77% | -19.64% |

The snapshot-era claim that Grind, QQQ/IWM, and most ORB observations were
primarily entry failures was too strong. One-second paths show more favorable
excursion, while their severe MAE remains. The corrected question is not
“entry or exit?” globally. It is how admission, option selection, per-channel
stops, and exit capture interact for each channel.

## Frozen development/holdout contract

The July 13–14 outcomes were already visible when these hypotheses were formed.
They are therefore **development evidence only** and can illustrate but never
validate the policy set.

- development cutoff: 2026-07-14 ET;
- untouched prospective holdout begins: 2026-07-15 ET;
- policy version: `phase1k-c-preregister-v1`;
- exact-path eligibility requires one CBBO-1s source, start/end lag no greater
  than 1.1 seconds, maximum internal gap no greater than five seconds, native
  provenance, and a complete booked outcome;
- targets, runner rules, and eligibility cannot be tuned after reading holdout
  results without creating a new version and a new future holdout;
- development and prospective holdout trades are rejected if a caller attempts
  to pool them in one score;
- every result has `policyChangeAuthorized: false`.

The five frozen scaling arms are:

1. MOMO bank half at +15%, remaining contracts use the native exit;
2. MOMO bank half at +15%, runner exits after half of peak return is given back;
3. MOMO bank half at +20%, runner exits after half of peak return is given back;
4. `vb-ribbon-cross` bank half at +15%, remaining contracts use the native exit;
5. `vb-ribbon-cross` bank half at +15%, runner uses half-giveback.

None changes the pre-bank stop. Stops remain channel-specific, not account-wide.
Two contracts are enough to model an integer bank/runner split; four is not a
trade requirement.

## Development replay — useful, not confirmatory

| Frozen arm | Triggered / eligible | Native P&L | Modeled P&L | Development delta |
|---|---:|---:|---:|---:|
| MOMO +15 / native runner | 12 / 17 | -$3,480 | -$1,554 | +$1,926 |
| MOMO +15 / half-giveback | 12 / 17 | -$3,480 | +$150 | +$3,630 |
| MOMO +20 / half-giveback | 12 / 17 | -$3,480 | +$642 | +$4,122 |
| VB-ribbon +15 / native runner | 5 / 6 | +$1,592 | +$1,081 | -$511 |
| VB-ribbon +15 / half-giveback | 5 / 6 | +$1,592 | +$526 | -$1,066 |

Channel-specific MOMO receipt for the strongest development arm:

| Channel | Triggered / eligible | Native P&L | +20/half-giveback | Delta | Better / worse / unchanged trades |
|---|---:|---:|---:|---:|---:|
| `momo-shape` | 6 / 8 | -$2,316 | +$570 | +$2,886 | 4 / 2 / 2 |
| `momo-shape-2` | 6 / 9 | -$1,164 | +$72 | +$1,236 | 2 / 4 / 3 |

This is not a free lunch. Each MOMO arm improved only six trades and worsened
six; the aggregate gain is tail-shaped. `momo-shape-2` in particular had more
worse than better trade-level deltas. The holdout must report distribution,
drawdown, and collision effects, not just total P&L.

VB-ribbon gives the opposite answer: all five triggered scale-outs reduced P&L
under both candidates. Its profitable native exit remains the control. A
fleet-wide “bank winners” policy would have damaged the strongest observed VB
subtype in this development sample.

## Truthful sibling matching

Durable `opportunity_id` values are position-specific in this cohort: 102
positions produced 102 distinct opportunity IDs. They cannot be used to claim
that siblings shared one opportunity.

Phase 1K-C instead labels a **matched source-bar clock** when trades share:

- the same completed source-bar timestamp;
- the same underlying;
- the same call/put side.

This produces 27 matched clocks containing 71 positions and 27 channel-pair
comparisons. Three clocks span more than one reporting family. The sum of entry
premium across these event groups is $110,844; it is not simultaneous account
exposure or required buying power.

Useful development contrasts:

- `pb-ride-2` had greater observed MFE than `pb-ride` on 9/11 matched clocks,
  but `pb-ride` realized more P&L on 7/11. That is direct evidence that more
  opportunity and better realized capture are different questions.
- `momo-shape` beat `momo-shape-2` on MFE in 5/7 matched clocks, while median
  realized P&L difference was zero. The two-day sample cannot pick a winner.
- `orb-trend-rider` realized more than `orb-ustop-ctl` on 4/4 matched clocks;
  the count is too small for a roster action but sufficient to keep the
  control from being pooled with the rider.
- `grind-v3` had higher MFE on 2/2 matched clocks while `grind-v3-2` realized
  more on 2/2. Again, entry opportunity and exit result point in different
  directions.
- the two QQQ-thrust variants split both matched comparisons. No verdict.

These rows are correlated comparisons, not independent trials.

## Admission diagnostics that remain unresolved

CBBO-1s prevents “no observed opportunity” from being overstated, but several
channels still combine modest upside with severe downside:

| Channel | Eligible | Reached +10% | Reached +15% | MAE ≤ -30% | Native P&L |
|---|---:|---:|---:|---:|---:|
| `breakout` | 1 | 0 | 0 | 1 | -$636 |
| `grind-smart-entries` | 1 | 0 | 0 | 1 | -$480 |
| `grind-v3` | 2 | 0 | 0 | 1 | -$450 |
| `grind-v3-2` | 2 | 0 | 0 | 0 | -$136 |
| `breakout-alt-v3-iwm` | 2 | 1 | 1 | 1 | -$210 |
| `breakout-smart-entries-iwm` | 1 | 0 | 0 | 1 | -$630 |
| `orb-trend-rider` | 6 | 2 | 1 | 5 | -$1,302 |
| `orb-ustop` | 3 | 2 | 2 | 3 | -$408 |
| `orb-ustop-ctl` | 4 | 2 | 2 | 4 | -$1,674 |
| `orb-qqq-trail` | 1 | 0 | 0 | 1 | -$684 |
| `qqq-thrust-trail` | 2 | 1 | 1 | 2 | -$1,417 |
| `qqq-thrust-trail-wd` | 2 | 1 | 0 | 2 | -$1,400 |

This does not authorize exit optimization for those channels. The samples are
tiny, and a scale-out can coexist with an admission problem. Their next tests
must retain channel-specific stops, contract selection, and same-clock family
collision context.

## Remaining limitations

- CBBO-1s is consolidated interval sampling, not every quote event. MFE/MAE and
  first-touch timing remain observed lower bounds.
- A modeled bank fill uses the first observed executable bid at or above the
  target. It does not model queue position or latency inside that second.
- No usable fresh, non-crossed native exit-decision NBBO exists in the cohort;
  native exit slippage remains unavailable.
- Replays end at the actual native close and do not invent a longer runner path.
- The two sessions are correlated development evidence and include repeated
  sibling clocks. They are not a statistical edge estimate.
- No portfolio allocator, occupancy replay, daily-stop replay, or covariance
  adjustment is claimed by the event-level totals.
- Local exact-path objects are not yet an R2 durability claim.

## Next gate

After July 15 is complete and Databento exposes its T+1 CBBO-1s data:

1. download only the exact July 15 contracts under a new checksum manifest;
2. score the frozen version without changing any target or selector;
3. report MOMO arms separately for Shape and Shape-2, including better/worse
   trade counts and drawdown—not only aggregate P&L;
4. retain VB-ribbon native exit as the control;
5. extend matched clocks and admission diagnostics for Grind, ORB, QQQ, IWM,
   and PB without roster changes;
6. upload validated content-addressed objects to the research R2 prefix only
   after an explicit storage review.

## Verification

- exact Databento request/parser self-test: 10/10;
- preregistered path model self-test: 10/10;
- Phase 1K-B path regression: 38/38;
- root TypeScript: clean;
- two manifests re-read, SHA-256 verified, and row counts matched;
- 653,824 valid CBBO-1s rows loaded;
- 101/101 native outcomes exact-path eligible;
- active July 15 session excluded;
- no Supabase/R2 write, migration, worker change, deployment, or production
  behavior change.
