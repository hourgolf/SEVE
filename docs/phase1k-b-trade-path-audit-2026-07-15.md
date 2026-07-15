# Phase 1K-B — censored option-path reconstruction

Status: implementation branch. Read-only research tooling only. No database
migration, Supabase write, R2 write, strategy configuration, worker runtime,
order, sizing, manager, dashboard, or deployment behavior is changed by this
phase.

Phase 1K-A established which position outcomes have durable lineage. Phase
1K-B joins that lineage to observed executable option quotes and separately
attests the available intraminute underlying receipts. Its purpose is to tell
the difference between:

- an entry that never developed favorable option value;
- an entry that developed value but the native exit failed to retain it;
- a path that cannot support either claim because observations are missing.

The command is:

```text
npm run trade-path-audit -- --from YYYY-MM-DD --through YYYY-MM-DD
```

It performs SELECTs only and writes an ignored local JSON receipt under
`data/trade-path-audits/`.

## Evidence boundary

The audit keeps four facts distinct:

1. Supabase is the durable position, opportunity, outcome, execution, and
   intraminute-receipt ledger.
2. `data/quotes-archive/YYYY-MM-DD.json.gz` supplies observed option bid/ask
   snapshots for the held OCC contract. Those are the executable option paths
   used for MFE and MAE in this cohort.
3. R2 holds immutable high-frequency underlying SIP events. A verified local
   entry-minute fixture may attest that those raw objects were downloaded and
   checksum/row/byte verified, but underlying events are never presented as an
   option-price path.
4. Databento CBBO and forward-captured option quotes are declared future source
   types. They are not silently substituted into this run.

For July 13–14 the adapter scanned 161,178 archived option snapshots and found
18,925 rows belonging to the held contracts. The July 14 intraminute fixture
attests 48 entries, 29 recovered source minutes, and 481,562 verified raw
underlying events. The current command did not re-download R2 objects; its JSON
receipt says so explicitly.

## Deterministic path contract

- MFE and MAE use observed executable **bids**, relative to the booked average
  entry price. Midpoints are not liquidation values.
- A zero or crossed quote is invalid. No observation is forward-filled.
- Start, terminal, and internal gaps greater than 75 seconds censor a complete
  path. The threshold accommodates one-minute CBBO evidence and is not an
  execution setting.
- Targets at +10%, +15%, +20%, +25%, +30%, +50%, and +100% record first
  observed bid touch; absence means “not observed,” not “impossible.”
- Native realized return is reconstructed from booked P&L, quantity, and entry
  price. Peak giveback and realized/MFE capture are emitted only for a complete
  native path.
- Observed MFE is a lower bound. A fill above the highest sampled bid may yield
  capture above 1.0; the audit reports that conflict instead of clipping it.
- Manual/operator-managed closes may teach entry-path behavior but cannot teach
  the native exit. A durable annotation excludes the known `momo-shape-2`
  +$348 close test from both entry and exit inference.
- Quantity two or greater is scale-capable evidence. Four-plus is reported
  separately; neither is a new fleet minimum.
- Slippage requires a fresh, positive, non-crossed decision NBBO. Spread is
  retained beside the comparison. Wide or crossed marks cannot manufacture a
  favorable fill claim.
- Every result is permanently `promotionEligible: false`.

## Live two-session receipt

Read-only window: 2026-07-13 through 2026-07-14.

- 102 closed paper trades;
- 101 native outcomes and one annotated operator test;
- 98 complete observed option paths;
- 97 native exit-comparable paths, all quantity two or greater;
- comparable native P&L: **-$10,928**;
- four censored native outcomes: **+$1,484**;
- 48 positions with intraminute source-minute receipts and independently
  checksum-verified raw fixtures;
- zero usable fresh, non-crossed exit-decision NBBOs. Exit slippage is therefore
  unavailable, not zero.

The four missing paths are not random losers. They are fast winners that opened
and closed between archive snapshots:

| Channel | Hold | Native P&L | Censor |
|---|---:|---:|---|
| `orb-trend-rider` | 33.728s | +$312 | no quote inside holding window |
| `pb-ride` | 44.755s | +$410 | no quote inside holding window |
| `pb-ride-itm` | 48.929s | +$360 | no quote inside holding window |
| `vb-ribbon-cross` | 22.515s | +$402 | no quote inside holding window |

Dropping them would change the two-session native total from -$9,444 to
-$10,928. Phase 1K-B therefore reports comparable and censored P&L side by side;
it never treats missing paths as zero. This outcome-linked censoring is also
why full OPRA/forward option capture is required before formal policy tests.

## Family evidence — diagnostic, not a ranking

| Family | Comparable / native | Comparable P&L | Censored P&L | Median observed MFE | Median observed MAE | Reached +15% |
|---|---:|---:|---:|---:|---:|---:|
| BREAKOUT-SPY | 1 / 1 | -$636 | $0 | -13.68% | -38.46% | 0 / 1 |
| GRIND | 5 / 5 | -$1,066 | $0 | -4.23% | -16.92% | 0 / 5 |
| IWM | 3 / 3 | -$840 | $0 | 0.00% | -29.09% | 0 / 3 |
| MOMO | 17 / 17 | -$3,480 | $0 | +17.70% | -34.33% | 9 / 17 |
| ORB-SPY | 12 / 13 | -$3,696 | +$312 | -3.95% | -39.98% | 2 / 12 |
| PB | 31 / 33 | +$1,605 | +$770 | +8.20% | -10.99% | 4 / 31 |
| QQQ | 5 / 5 | -$3,501 | $0 | +2.05% | -38.52% | 0 / 5 |
| VB | 23 / 24 | +$686 | +$402 | +3.70% | -12.92% | 4 / 23 |

Two sessions and correlated sibling entries do not estimate a durable edge.
The useful split is mechanistic:

- **MOMO is the clearest exit/capture hypothesis.** Nine of 17 comparable
  trades touched +15% and six touched +20%, yet the family lost $3,480 and its
  median realized/MFE capture was negative. This does not prove a scale-out
  policy, but it justifies preregistered exit-path tests rather than rewriting
  the entry first.
- **GRIND, QQQ/IWM, and most ORB observations point upstream.** Their typical
  trade had little or negative favorable excursion and substantial adverse
  excursion. A new take-profit cannot rescue an option that was not observed
  above entry; admission, timing, option selection, and correlated family risk
  deserve priority.
- **PB is positive but heterogeneous.** `pb-ride` produced +$1,520 on ten
  comparable paths plus a censored +$410 winner; `pb-ride-2` produced +$165 on
  13 paths and supplied four of PB's four observed +15% touches; `pb-ride-itm`
  produced -$80 on eight paths plus a censored +$360 winner. Native exits remain
  the control until the variants have more independent sessions.
- **VB must not be pooled.** `vb-ribbon-cross` produced +$1,190 on five
  comparable paths plus a censored +$402 winner, with four of five reaching
  +15%. `vb-curl-reversal` produced -$546 on 12 paths and none reached +15%.
  `vb-squeeze-break-qqq` was approximately flat (+$42 on six). A fleet-wide VB
  manager would erase the actual hypothesis boundary.

## Channel receipt

| Channel | Comparable | Comparable P&L | Censored | Median MFE | Median MAE | +15% touches |
|---|---:|---:|---:|---:|---:|---:|
| `breakout` | 1 | -$636 | 0 / $0 | -13.68% | -38.46% | 0 / 1 |
| `grind-smart-entries` | 1 | -$480 | 0 / $0 | -9.82% | -35.71% | 0 / 1 |
| `grind-v3` | 2 | -$450 | 0 / $0 | -3.92% | -16.58% | 0 / 2 |
| `grind-v3-2` | 2 | -$136 | 0 / $0 | -0.50% | -7.31% | 0 / 2 |
| `breakout-alt-v3-iwm` | 2 | -$210 | 0 / $0 | +1.96% | -12.58% | 0 / 2 |
| `breakout-smart-entries-iwm` | 1 | -$630 | 0 / $0 | -1.79% | -30.36% | 0 / 1 |
| `momo-shape` | 8 | -$2,316 | 0 / $0 | +21.78% | -34.99% | 5 / 8 |
| `momo-shape-2` | 9 | -$1,164 | 0 / $0 | +12.16% | -34.33% | 4 / 9 |
| `orb-trend-rider` | 5 | -$1,614 | 1 / +$312 | -4.96% | -28.68% | 0 / 5 |
| `orb-ustop` | 3 | -$408 | 0 / $0 | +10.71% | -64.07% | 1 / 3 |
| `orb-ustop-ctl` | 4 | -$1,674 | 0 / $0 | -4.04% | -47.08% | 1 / 4 |
| `pb-ride` | 10 | +$1,520 | 1 / +$410 | +8.19% | -2.37% | 0 / 10 |
| `pb-ride-2` | 13 | +$165 | 0 / $0 | +10.00% | -14.42% | 4 / 13 |
| `pb-ride-itm` | 8 | -$80 | 1 / +$360 | +8.11% | -12.68% | 0 / 8 |
| `orb-qqq-trail` | 1 | -$684 | 0 / $0 | -3.70% | -38.52% | 0 / 1 |
| `qqq-thrust-trail` | 2 | -$1,417 | 0 / $0 | +2.91% | -32.68% | 0 / 2 |
| `qqq-thrust-trail-wd` | 2 | -$1,400 | 0 / $0 | +6.41% | -44.66% | 0 / 2 |
| `vb-curl-reversal` | 12 | -$546 | 0 / $0 | +2.35% | -17.46% | 0 / 12 |
| `vb-ribbon-cross` | 5 | +$1,190 | 1 / +$402 | +18.85% | -10.47% | 4 / 5 |
| `vb-squeeze-break-qqq` | 6 | +$42 | 0 / $0 | +3.59% | -12.51% | 0 / 6 |

## What Phase 1K-B does not claim

- The observed archive is not full OPRA and misses the fastest outcomes.
- The 75-second completeness limit does not make one-minute evidence suitable
  for intraminute execution or exact touch ordering.
- R2 SIP receipts validate underlying event capture, not option bids, IV,
  delta, or attainable fills.
- Capture above 1.0 and actual exits above observed peaks expose snapshot
  limits; they are not economic outperformance claims.
- Entry fill-versus-ask is descriptive and spread-sensitive. Exit slippage has
  no valid denominator in this cohort.
- Family and channel rows are correlated and not independent trials.
- No target, stop, scale allocation, channel roster, or promotion decision is
  made here.

## Next research gate

Phase 1K-C should preregister family-specific questions before reading another
outcome batch:

1. ingest exact T+1 Databento OPRA/CBBO paths, or a durable forward option path,
   so the four fast winners and intraminute touch order are measurable;
2. compare siblings only on matched opportunity clocks and report family
   collision/capital overlap;
3. test MOMO and VB-ribbon native exit against whole-lot scale paths, while
   retaining native exits as the control;
4. test Grind, QQQ/IWM, and ORB admission/contract-selection hypotheses before
   optimizing their profit targets;
5. keep all work paper-only and shadow-only until independent sessions support
   a policy review.

## Verification

- trade path model self-test: 38/38;
- fleet evidence passport regression: 40/40;
- Phase 1J observer scorecard regression: 25/25;
- research annotation regression: 4/4;
- session exit replay regression: 6/6;
- root TypeScript: clean;
- read-only live July 13–14 audit completed successfully;
- 102 outcomes and all 20 traded channels receive explicit denominators;
- four outcome-linked missing paths and +$1,484 censored P&L reproduced;
- invalid/crossed NBBOs and wide spreads cannot silently create slippage;
- no Supabase/R2 write, migration, worker change, deployment, or production
  behavior change.
