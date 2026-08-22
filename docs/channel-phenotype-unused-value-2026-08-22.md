# Unused value discovery · channel phenotypes · 2026-08-22

**READ-ONLY PAPER RESEARCH · JULY 20–AUGUST 21 · NO PRODUCTION CHANGES**

## What changed in the analysis

The important advance is conceptual: SEVE must not judge an entry by the final trade result. A good entry can find a large favorable move and still lose because the exit failed to convert it. The recovered phenotype study therefore separates three questions:

1. **Entry opportunity:** how much favorable movement followed the signal?
2. **Profit conversion:** how much of that available movement did the historical native exit retain?
3. **Manager choice:** which bounded exit improved the same exact option path?

The study joined **3,830 logical virtual opportunities across 62 channels** to their pre-entry signal context. It selected feature relationships on earlier sessions, froze them, and required the direction to repeat on untouched later sessions. Final P&L was never used to label entry quality.

The full scan found many exploratory relationships. Only the channel-specific, controllable findings below should enter the experiment queue. They are prospective test designs, not permission to change production.

## Where active channels are leaving value

The counts below describe historical virtual native paths in the current research window. “Move lost” means the option reached at least +15% after entry but finished at or below entry. “Profit leaked” means it finished positive but retained less than 60% of its best move.

| Channel | Sessions / paths | Never worked | Move lost | Profit leaked | Profit retained | Read |
|---|---:|---:|---:|---:|---:|---|
| `grind-smart-entries` | 22 / 81 | 8 | 7 | 56 | 0 | Entry often finds movement; historical native conversion is the dominant leak |
| `momo-shape-2` | 16 / 83 | 10 | 12 | 48 | 7 | Strong opportunity stream, but later entries and conversion both deserve controlled tests |
| `vb-gap-drift` | 14 / 102 | 17 | 22 | 53 | 4 | Large conversion backlog; no clean pre-entry filter replicated strongly enough yet |
| `vb-macd-state` | 23 / 133 | 27 | 24 | 56 | 12 | Both entry context and conversion matter; do not solve this with size alone |
| `vb-level-break` | 18 / 86 | 11 | 18 | 43 | 6 | Useful movement exists, but the historical exit gave too much of it back |
| `pb-ride-itm` | 25 / 116 | 25 | 3 | 55 | 6 | Fewer outright lost moves, but weak capture; opening-range depth is the clearest entry clue |
| `orb-ustop-ctl` | 16 / 48 | 7 | 29 | 4 | 4 | The entry frequently found movement; the native results span manager eras, so this is a conversion diagnosis, not a new manager verdict |
| `breakout` | 22 / 63 | 9 | 4 | 38 | 4 | Cap-one behavior is supported; the remaining problem is converting the first opportunity |
| `grind-v3` | 16 / 54 | 12 | 5 | 32 | 1 | Weak conversion plus failed holdout manager tests supports the existing pause decision |
| `grind-v3-2` | 22 / 77 | 12 | 3 | 49 | 0 | More evidence of a useful entry stream paired with poor conversion, not a promotion case yet |

These are not broker P&L totals and cannot be added together. They are overlapping hypothetical opportunity paths.

## Best bounded entry experiments

| Channel | Repeated clue on later sessions | What it means | Proposed one-variable paper test |
|---|---|---|---|
| `breakout` | First entry had about **+24 MFE points** over later entries | Existing one-entry cap is doing useful work | Keep cap one; do not reopen frequency |
| `momo-shape-2` | Third-or-later entries had about **41 fewer MFE points** | Re-entry dilution is real enough to test | Compare current admission with max two entries; keep exit, size, and account fixed |
| `pb-ride-itm` | Deep opening-range entries had about **8 fewer MFE points** | The option contract is not the only issue; location within the opening range matters | Preregister a deep-OR stand-down versus current entry |
| `vb-macd-state` | Far-from-VWAP entries had about **36 fewer MFE points**; deep-OR entries about **43 fewer** | Extension/chasing appears more damaging than raw signal direction | Test one distance guard first; do not combine it with an entry cap or manager change |
| `vb-vwap-revert-qqq` | Medium-efficiency setups had about **45 more MFE points** | Mean-reversion quality changes with market efficiency | Observe a medium-efficiency cohort prospectively before any return to live entry |
| `grind-smart-entries` | Cheaper-premium cohort found substantially more movement in the holdout | Contract cost may proxy for entry timing or distance | Diagnose the upstream timing/distance cause before imposing a premium rule |

The larger raw list includes direction, volume, momentum, and time associations. Those remain research candidates because many are correlated descriptions of the same market state. Turning them all into rules would overfit the desk.

## Entry from one sibling, exit from another

Same-minute, same-underlying, same-direction sibling comparisons exposed a second unused asset: strategy components can be evaluated separately instead of accepting every channel as an indivisible preset.

- The `pb-ride` family repeatedly showed a stronger opportunity-finding stream in one sibling and a better historical finish in another. No standard bounded manager survived the exact-path holdout, so the next work is a **bespoke tranche/contract study**, not a manager swap.
- The `grind` family showed the same split. Again, the standard bounded exits did not produce a defensible new combination in this phenotype pass.
- `breakout-smart-entries` paired with `FULL-R35-K67` retained a positive later-session exact-path lift, but the holdout is only **four opportunities across three sessions**. It is suitable for a small prospective observation trial, not a profit claim.
- `breakout-alt-v3` paired with `BANK30-BE-R50-K67` also retained a small later-session lift, but the holdout remains tiny and does not supersede the corrected portfolio admission review.

No feature-conditioned manager rule passed. In other words, the data does **not** yet support “use manager X only when indicator Y is high.” That is an open research lane, not a hidden solution.

## What this changes about the weekend plan

The best unused value is not another global exit preset. It is a tighter research loop:

1. **Re-score the corrected Monday roster before activation.** The phenotype evidence should affect selection and admission: favor channels that repeatedly find movement, retain the existing `breakout` cap-one protection, add the bounded `momo-shape-2` and `vb-macd-state` entry experiments below, and do not keep a channel merely because it was already in the packet.
2. **Preregister two admission tests:** `momo-shape-2` max-two entries and one `vb-macd-state` extension guard. These address the largest replicated controllable entry leaks.
3. **Keep exit rehabilitation separate:** continue the already prepared channel-specific exits for `momo-shape-2`, `vb-level-break`, `breakout`, and `grind-smart-entries`, shadowing displaced behavior.
4. **Build bespoke sibling studies for PB and Grind.** Standard manager presets did not capture the opportunity; examine contract selection, first bank, runner handoff, and time-to-MFE on matched opportunities.
5. **Do not award the open lane to `breakout-smart-entries` yet.** Its tiny holdout earns entry into a portfolio-aware candidate tournament, not the lane itself. Compare it with `orb-trend-rider`, `vb-level-break-qqq`, `vb-or-fail-qqq`, the stronger Momo sibling combination, and any other compatible candidate using marginal desk contribution, displacement, collision, uniqueness, and evidence value.
6. **Make the phenotype conclusion part of the larger dashboard trust cleanup.** Do not create another panel. Replace redundant and stale tables with one canonical per-channel decision summary—entry issue, conversion issue, both, or collecting—and put evidence-layer, era, freshness, and raw comparisons behind disclosure.

## What not to do

- Do not add all replicated indicators to a channel at once.
- Do not call a favorable-move stream profitable until an exit converts it.
- Do not call a manager better because it won total dollars or one large session.
- Do not pool native conversion across configuration eras to select a current manager.
- Do not promote a sibling recombination without an account-level admission and displacement replay.
- Do not size a channel up while entry frequency or conversion remains the unresolved variable.

## Evidence boundary

The deterministic artifacts are generated locally under `data/weekend-optimization/2026-08-22/channel-phenotypes/` with input and output hashes. The underlying canonical refresh read 1,639 complete logical trades, 3,331 manager paths, 46,530 signals, and 5,257 virtual rows; the exact-path frontier rebuilt 4,112 logical opportunities with no missing path archive. The phenotype join retained 3,830 signal-backed virtual opportunities.

All work was SELECT-only. No roster, manager, size, account, order, position, production research row, deployment, or schedule changed.
