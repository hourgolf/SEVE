# Weekend Day 1 — corrected Gate 4 Monday proposal

Status: **operator-ratified and implemented as a checked-in, default-off local release candidate; not
applied**. Paper-only is invariant. Ratification authorizes preparation and sealing, not configuration
application, migration, merge, push, deployment, or orders.

## Evidence boundary and parameter classes

July 15 exact paths and the July 15 untouched holdout are useful for choosing conservative questions, not
for promotion. July 17 is one additional correlated paper session. In particular, PB showed materially
smaller observed development MAE than ORB/MOMO, the small Grind/IWM/QQQ samples included severe downside,
and MOMO +15 half-bank/half-giveback was directionally better in one holdout while +20 was worse. None of
those samples is large enough to establish an edge or optimize a threshold.

The proposal separates five kinds of settings:

- **Operational safety guardrails:** paper-only; one open position per family; bounded contracts, entry
  debit, premium loss, concurrency, same-clock collision, and EOD liquidation. These are prospective loss
  containment choices, not learned settings.
- **Entry hypotheses:** PB continuation, SPY ORB, SPY Grind, shaped SPY momentum, QQQ ORB, and IWM expansion.
- **Contract-selection hypotheses:** each root keeps only its existing underlying, side selection, DTE, and
  ATM rule. These identities are hypotheses, not evidence-backed optima.
- **Exit-manager hypotheses:** all non-safety exits remain shadow research. Exit-only siblings do not place
  separate paper orders.
- **Learned settings:** none. No numeric setting below is promoted, optimized, or labeled learned.

## Complementary proposed roots

### Observed fresh entry asks, July 15–17

SELECT-only execution receipts were reduced to one non-runner root position per entry and required a
positive decision ask no more than 15 seconds old. All 60 proposed-root positions had valid asks; no missing,
stale, nonpositive, or unmapped rows were converted to zero.

| Root | Valid / censored | Median | p75 | p90 | p95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| `pb-ride` | 16 / 0 | $2.13 | $2.44 | $2.96 | $3.37 | $3.37 |
| `orb-ustop-ctl` | 8 / 0 | $1.25 | $1.46 | $1.87 | $1.87 | $1.87 |
| `grind-v3` | 11 / 0 | $1.08 | $1.25 | $1.31 | $1.65 | $1.65 |
| `momo-shape` | 18 / 0 | $1.225 | $1.48 | $1.69 | $2.04 | $2.04 |
| `orb-qqq-trail` | 4 / 0 | $2.195 | $2.33 | $2.71 | $2.71 | $2.71 |
| `breakout-alt-v3-iwm` | 3 / 0 | $0.79 | $1.04 | $1.04 | $1.04 | $1.04 |

These are small, correlated paper samples. The proposed per-contract ceilings round each observed maximum
up to the next conservative $0.25 increment. The aggregate debit ceiling is exactly two contracts times
that premium ceiling times the $100 option multiplier. Quantity therefore does not silently change the
entry hypothesis through the old universal $500 admission limit.

| Family | Executed root proposal | Entry / contract hypothesis | Contracts and whole-lot allocation | Prospective safety baseline |
|---|---|---|---:|---|
| SPY PB | `pb-ride` | pullback continuation; 1DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $3.50; aggregate debit <= $700; premium stop -30%; EOD 15:25 ET |
| SPY ORB | `orb-ustop-ctl` | opening-range continuation; 0DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $2.00; aggregate debit <= $400; explicit premium stop -30%; EOD 15:25 ET |
| SPY Grind | `grind-v3` | grind continuation; 0DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $1.75; aggregate debit <= $350; premium stop -30%; EOD 15:25 ET |
| SPY MOMO | `momo-shape` | shaped momentum; 0DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $2.25; aggregate debit <= $450; premium stop -30%; EOD 15:25 ET |
| QQQ ORB | `orb-qqq-trail` | QQQ opening-range continuation; 0DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $3.00; aggregate debit <= $600; premium stop -30%; EOD 15:25 ET |
| IWM breakout | `breakout-alt-v3-iwm` | IWM expansion; 0DTE ATM | 2; all-out arms 2/0, split arms bank 1/run 1 | per-contract premium <= $1.25; aggregate debit <= $250; premium stop -30%; no adds/re-entry; EOD 15:25 ET |

Both premium and aggregate guards must pass on the same exact executable entry ask. They are not permission
to substitute a mid, snapshot, approximate contract, or stale ask.
The -30% premium stop is a common prospective catastrophe boundary used by existing shadow research; it is
chosen for loss containment, not because the small sample proved it optimal. A missing fresh executable bid
must be reported truthfully and handled by the separately ratified paper safety procedure.

Every ordinary root proposes two contracts so the existing split manager arms are whole-lot executable in
research: one bank lot and one runner lot. The root remains the only paper fill; exit alternatives continue
to observe that same exact path and do not create sibling orders.

## Dark siblings and legitimate contrasts

Exit-only alternatives stay dark and consume the executed root's exact path. This includes
`momo-shape-2`, `orb-trend-rider`, `orb-ustop`, and the QQQ trail/target variants. The following siblings
encode real entry or contract contrasts but also remain dark for Day 1 because the evidence floor and
concentration budget do not justify a second fill:

- `pb-ride-2`: 0DTE timing/DTE contrast;
- `pb-ride-itm`: 1DTE ITM strike contrast;
- `grind-v3-2`: 1DTE contrast;
- `grind-smart-entries`: admission/filter contrast;
- `breakout-smart-entries-iwm`: IWM admission/filter contrast;
- QQQ breakout/thrust siblings: entry-family contrast.

All VB candidates remain dark until the exact-path candidate contract passes. Synthetic native paths,
snapshots, mids, `option_quotes`, and approximate contracts cannot satisfy that gate.

## Concurrency, collision, and EOD proposal

- Maximum open positions: one per named family; two total across SPY; one QQQ; one IWM; four account-wide.
- Maximum simultaneous contract count under these caps: eight, because every admitted root has two lots.
- Same family and source clock: root candidate only; every sibling is shadow/dark.
- Cross-family SPY same completed source-bar clock and direction: admit at most one new root in deterministic
  safety order `PB > Grind > MOMO > ORB`. The order follows the development downside ranking only as a loss-
  containment prior; it is not an edge claim. Every suppressed candidate retains a collision censor.
- Same OCC already open anywhere in the paper account: no duplicate fill; retain the candidate and collision
  censor. QQQ and IWM may coexist because they are explicit underlying contrasts, subject to global caps.
- No pyramids or re-entry on Day 1. No automatic promotion.
- At 15:25 ET, stop admissions and flatten every remaining root with the paper safety executor. Evidence
  continues to retain the exact decision clock, quote provenance, and any no-fresh-bid censor.

The current account daily latch remains an independent account guard. It is not a channel stop and does not
replace the limits above.

## Exact manager arms observed from each root

Each root path is submitted to the existing eight-arm exact manager observer, keyed prospectively by root
channel version, manager version, and configuration epoch:

`LOCK20/30`, `LOCK30/30`, `LOCK50/30`, `WIDE20/50`, `BANK20/RUN50`,
`ARM20/HALF-GIVEBACK`, `BELL/-30`, and `BELL/no-stop`.

The observer never authorizes execution. `BANK20/RUN50` and `ARM20/HALF-GIVEBACK` use one bank lot and one
runner lot on every two-contract root; all-out arms use both lots. `BELL/no-stop` is observation-only and can
never override the executed -30% catastrophe stop.

## Complete current-paper → proposed diff

The proposed active root values below replace arbitrary operational numbers rather than carrying them
forward. `Debit` is a new admission ceiling and must be implemented and reviewed before any application.
`P/U·TP·A` means premium stop / underlying stop, target, adds.

| Channel | Current state and numeric configuration | Proposed state and configuration |
|---|---|---|
| `pb-ride` | paper; $1200/cap10; 1DTE ATM; 30/0.35·10·0 | proposed root; premium $3.50/debit $700/cap2; 1DTE ATM; 30/—·0·0; split 1/1; EOD 15:25 |
| `orb-ustop-ctl` | paper; $500/cap6; 0DTE ATM; inherited 50/—·0·0 | proposed root; premium $2.00/debit $400/cap2; 0DTE ATM; explicit 30/—·0·0; split 1/1; EOD 15:25 |
| `grind-v3` | paper; $600/cap12; 0DTE ATM; 35/0.5·6·0 | proposed root; premium $1.75/debit $350/cap2; 0DTE ATM; 30/—·0·0; split 1/1; EOD 15:25 |
| `momo-shape` | paper; $1200/cap12; 0DTE ATM; 40/0.5·0·0 | proposed root; premium $2.25/debit $450/cap2; 0DTE ATM; 30/—·0·0; split 1/1; EOD 15:25 |
| `orb-qqq-trail` | paper; $750/cap12; 0DTE ATM; 40/—·0·0 | proposed root; premium $3.00/debit $600/cap2; 0DTE ATM; 30/—·0·0; split 1/1; EOD 15:25 |
| `breakout-alt-v3-iwm` | paper; $750/cap10; 0DTE ATM; 30/—·22·0 | proposed root; premium $1.25/debit $250/cap2; 0DTE ATM; 30/—·0·0; split 1/1; no adds/re-entry; EOD 15:25 |
| `breakout` | paper; $600/cap12; 40/—·22·0 | dark/draft; current values quarantined and not a Monday configuration |
| `breakout-alt-v3` | paper; $750/cap18; 40/—·22·3 | dark/draft; current values quarantined; incomplete pyramid disabled |
| `breakout-alt-v3-qqq` | paper; $250/cap6; 30/—·14·0 | dark/draft; current values quarantined |
| `breakout-qqq` | paper; $500/cap12; 30/0.2·22·0 | dark/draft; current values quarantined |
| `breakout-smart-entries` | paper; $750/cap18; 40/—·22·3 | dark/draft; current values quarantined; incomplete pyramid disabled |
| `breakout-smart-entries-iwm` | paper; $750/cap10; 30/—·22·0 | dark/draft entry/filter contrast; no fill |
| `breakout-smart-entries-qqq` | paper; $250/cap6; 30/—·15·0 | dark/draft; current values quarantined |
| `grind-smart-entries` | paper; $600/cap12; 35/0.5·8·0 | dark/draft entry/filter contrast; no fill |
| `grind-v3-2` | paper; $600/cap12; 1DTE ATM; 35/0.5·7·0 | dark/draft DTE contrast; no fill |
| `momo-shape-2` | paper; $950/cap12; 40/0.5·27·0 | dark/draft exit sibling; root path only |
| `orb-trend-rider` | paper; $500/cap6; 35/—·30·0 | dark/draft exit sibling; root path only |
| `orb-ustop` | paper; $500/cap6; inherited 50/0.3·0·0 | dark/draft structural-stop sibling; root path only |
| `pb-ride-2` | paper; $1000/cap10; 0DTE ATM; 30/0.35·20·0 | dark/draft DTE/exit contrast; no fill |
| `pb-ride-itm` | paper; $1500/cap10; 1DTE ITM; 30/0.35·10·0 | dark/draft strike contrast; no fill |
| `qqq-thrust-trail` | paper; $750/cap12; 40/—·0·0 | dark/draft entry-family contrast; no fill |
| `qqq-thrust-trail-wd` | paper; $750/cap12; inherited 50/—·50·0 | dark/draft exit sibling; root path only |
| `vb-curl-reversal` | paper; $350/cap6; 30/—·15·0 | dark/draft; exact candidate contract not passed |
| `vb-ribbon-cross` | paper; $350/cap6; 0DTE ITM; 30/—·28·0 | dark/draft; exact candidate contract not passed |
| `vb-squeeze-break-qqq` | paper; $500/cap8; 30/—·16·0 | dark/draft; exact candidate contract not passed |

The other 43 inventory rows are already draft or disabled and remain unchanged and dark:
`breakout-alt-v3-ctl`, `breakout-alt-v3-er40`, `breakout-alt-v3-itm`, `breakout-manual`,
`breakout-smart-entries-ctl`, `breakout-smart-entries-er40`, `breakout-smart-entries-itm`, `fomc-follow`,
`grind`, `grind-manual`, `orb-spy-trail`, `power`, `power-final30`, `power-manual`,
`power-smart-entries`, `qqq-thrust-trail-manual`, `vb-curl-reversal-iwm`, `vb-curl-reversal-qqq`,
`vb-gap-drift`, `vb-gap-drift-iwm`, `vb-gap-drift-qqq`, `vb-level-break`, `vb-level-break-iwm`,
`vb-level-break-qqq`, `vb-macd-state`, `vb-macd-state-iwm`, `vb-macd-state-qqq`, `vb-or-fail`,
`vb-or-fail-iwm`, `vb-or-fail-qqq`, `vb-pm-trend`, `vb-pm-trend-iwm`, `vb-pm-trend-qqq`,
`vb-ribbon-cross-iwm`, `vb-ribbon-cross-qqq`, `vb-rsi-revert`, `vb-rsi-revert-iwm`,
`vb-rsi-revert-qqq`, `vb-squeeze-break`, `vb-squeeze-break-iwm`, `vb-vwap-revert`,
`vb-vwap-revert-iwm`, and `vb-vwap-revert-qqq`. No numeric value on those rows is proposed for Monday use.

This diff covers all 68 inventory rows: 25 current paper rows are enumerated above and 43 existing
draft/disabled rows are unchanged. The local release overlay now expresses root/dark lifecycle durably in
checked-in code without creating sibling fills. It is guarded by a default-off environment switch and exact
configuration SHA; this document does not apply it.

## Ratified local release-candidate identity

The operator ratified every proposed value above. The checked-in canonical payload is
`weekend-day1-2026-07-20-rc1`, schema 1, SHA-256
`ba0fed21340f34a7f816a7edb7589a44758e15b6696b4a6db41d432e090a37c1`. It represents six roots and all
62 non-roots as dark, with unknown channels failing dark. The runtime gate remains default-off and refuses
startup when enabled without this exact expected SHA-256. No current Supabase configuration row was changed;
the “current” side of the table remains the SELECT-only inventory and the “proposed” side is the complete
local overlay.
