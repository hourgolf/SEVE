# Weekend Day 1 — corrected Gate 4 Monday proposal

Status: **proposal only; not finalized or applied**. Paper-only is invariant. This document does not
authorize a roster, configuration, migration, seal, merge, push, or deployment.

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

| Family | Executed root proposal | Entry / contract hypothesis | Contracts and whole-lot allocation | Prospective safety baseline |
|---|---|---|---:|---|
| SPY PB | `pb-ride` | pullback continuation; 1DTE ATM | 1; hold 1, bank 0, runner 0 | aggregate entry debit <= $500; premium stop -30%; no structural stop or profit target; EOD 15:25 ET |
| SPY ORB | `orb-ustop-ctl` | opening-range continuation; 0DTE ATM | 1; hold 1, bank 0, runner 0 | aggregate entry debit <= $500; explicit premium stop -30%; no inherited default, structural stop, or target; EOD 15:25 ET |
| SPY Grind | `grind-v3` | grind continuation; 0DTE ATM | 1; hold 1, bank 0, runner 0 | aggregate entry debit <= $500; premium stop -30%; no structural stop or target; EOD 15:25 ET |
| SPY MOMO | `momo-shape` | shaped momentum; 0DTE ATM | 2; executed hold 2, bank 0, runner 0 | aggregate entry debit <= $1,000; premium stop -30%; no structural stop or target; EOD 15:25 ET |
| QQQ ORB | `orb-qqq-trail` | QQQ opening-range continuation; 0DTE ATM | 1; hold 1, bank 0, runner 0 | aggregate entry debit <= $500; premium stop -30%; no target; EOD 15:25 ET |
| IWM breakout | `breakout-alt-v3-iwm` | IWM expansion; 0DTE ATM | 1; hold 1, bank 0, runner 0 | aggregate entry debit <= $500; premium stop -30%; no target, pyramid, or re-entry; EOD 15:25 ET |

The debit guard means skip the candidate if the exact executable entry ask would exceed the stated
aggregate limit. It is not permission to substitute a mid, snapshot, approximate contract, or stale ask.
The -30% premium stop is a common prospective catastrophe boundary used by existing shadow research; it is
chosen for loss containment, not because the small sample proved it optimal. A missing fresh executable bid
must be reported truthfully and handled by the separately ratified paper safety procedure.

MOMO alone proposes two contracts because a previously preregistered 1/1 bank-runner manager contrast is a
real whole-lot research question. The executed safety manager still holds both lots. The other roots use one
contract and therefore do not pretend a fractional scale-out is executable.

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
- Maximum simultaneous contract count under these caps: five, because the MOMO root has two lots.
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

The observer never authorizes execution. On one-contract roots, the two split arms are exact-path research
models but are marked `whole_lot_not_executable`; they cannot be presented as an executable one-lot result.
MOMO's two lots permit a 1-bank/1-runner allocation for those shadow arms. `BELL/no-stop` is observation-
only and can never override the executed -30% catastrophe stop.

## Complete current-paper → proposed diff

The proposed active root values below replace arbitrary operational numbers rather than carrying them
forward. `Debit` is a new admission ceiling and must be implemented and reviewed before any application.
`P/U·TP·A` means premium stop / underlying stop, target, adds.

| Channel | Current state and numeric configuration | Proposed state and configuration |
|---|---|---|
| `pb-ride` | paper; $1200/cap10; 1DTE ATM; 30/0.35·10·0 | proposed root; debit $500/cap1; 1DTE ATM; 30/—·0·0; hold1; EOD 15:25 |
| `orb-ustop-ctl` | paper; $500/cap6; 0DTE ATM; inherited 50/—·0·0 | proposed root; debit $500/cap1; 0DTE ATM; explicit 30/—·0·0; hold1; EOD 15:25 |
| `grind-v3` | paper; $600/cap12; 0DTE ATM; 35/0.5·6·0 | proposed root; debit $500/cap1; 0DTE ATM; 30/—·0·0; hold1; EOD 15:25 |
| `momo-shape` | paper; $1200/cap12; 0DTE ATM; 40/0.5·0·0 | proposed root; debit $1000/cap2; 0DTE ATM; 30/—·0·0; hold2; EOD 15:25 |
| `orb-qqq-trail` | paper; $750/cap12; 0DTE ATM; 40/—·0·0 | proposed root; debit $500/cap1; 0DTE ATM; 30/—·0·0; hold1; EOD 15:25 |
| `breakout-alt-v3-iwm` | paper; $750/cap10; 0DTE ATM; 30/—·22·0 | proposed root; debit $500/cap1; 0DTE ATM; 30/—·0·0; hold1; no adds/re-entry; EOD 15:25 |
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
draft/disabled rows are unchanged. Because the deployed lifecycle cannot express a durable dark/bench state,
the paper-to-dark transitions require operator review and an explicit configuration mechanism; this document
does not apply them.

## Remaining operator decisions

The operator must decide whether to ratify the six roots; the $500/$1,000 debit ceilings; one-versus-two lot
quantities; -30% premium stop; 15:25 ET EOD; max-open rules; SPY collision priority; duplicate-OCC rule;
manager-arm set and whole-lot censoring; and the lifecycle representation for dark channels. Ratification
must happen after the debit guard and version stamps are shown to be implementable. Until then this is not
the Monday roster.
