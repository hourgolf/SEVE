# Smart roster — the v1-vs-v2 management experiment

These files turn every built-in channel into an **A/B experiment**: the original (`breakout / fade
/ grind / power`) versus a `*-smart` variant that adds an **R-based management layer** — premium
stops, scale-outs, breakeven ratchets, adaptive trailing, and a cost gate. Both versions run over
the **same** historical `option_bars` so the only variable is the management spec.

Companion to the original [`README.md`](README.md) (which documents the built-ins) and to
[`strategy-00-shared-signals.md`](strategy-00-shared-signals.md) (entry signals). Where strategy-00
defines *when to enter*, the management library defines *how to manage after entry*.

> This is backtest/telemetry infrastructure for our own channels. A favorable A/B is a **relative,
> post-cost result on historical data** — it says the smart layer behaves better on our bars, not
> that either version is profitable live. Not financial advice. Calibrate the cost model
> conservatively or you'll flatter both columns.

## Read order (fresh session, top to bottom)

1. **This file** — the experiment design.
2. [`CLAUDE-CODE-BRIEF.md`](CLAUDE-CODE-BRIEF.md) — the build spec: spec-vocabulary additions,
   position state machine, cost model, A/B harness. **Start here to implement.**
3. [`trade-management.md`](trade-management.md) — the shared management primitives (R, dual stop,
   scale-out ladder, adaptive trail, scale-in rules, cost gate). The smart theses compose these.
4. [`strategy-00-shared-signals.md`](strategy-00-shared-signals.md) — entry signals + gamma regime.
5. The per-channel pairs, each smart thesis next to its v1:
   - [`breakout.md`](breakout.md) → [`breakout-smart.md`](breakout-smart.md)
   - [`fade.md`](fade.md) → [`fade-smart.md`](fade-smart.md)
   - [`grind.md`](grind.md) → [`grind-smart.md`](grind-smart.md)
   - [`power.md`](power.md) → [`power-smart.md`](power-smart.md)

## How the v1-vs-v2 registry pattern works

- **Originals run from code** via `engine/registry.ts` (unchanged — do not touch them).
- **Smart variants are imported `StrategySpec` theses**, registered *alongside* the originals with
  `-smart` slugs. They are the **only** imported specs in this roster.
- **Do not re-import the originals.** They already run from code; importing their `.md` would
  duplicate a channel (same rule as the original README).
- Result: the registry holds both `breakout` and `breakout-smart` at once, drawing from the same
  data and fill model, so a head-to-head is apples-to-apples.

## Running the comparison

```bash
npm run ab -- --pair breakout:breakout-smart          # one pair
npm run ab -- --pair breakout:breakout-smart --days 90 # over a window
npm run ab -- --all                                    # every base:smart pair
npm run ab -- --pair power:power-smart --mgmt-only      # attribution mode (see below)
```

`npm run report` groups channels by base slug, so `breakout` and `breakout-smart` print adjacent
with a delta row. Run `npm run backtest -- --strat <slug>` to see the modeled edge for either side
on its own.

### Scorecard columns

| Metric | Read it as |
|---|---|
| `expectancyR` | mean P&L per trade in **R** — the headline number |
| `winRate` | % of closed trades positive (post-cost) |
| `profitFactor` | gross win ÷ gross loss |
| `avgWinR / avgLossR` | win and loss size in R |
| `maxDrawdownR` | worst peak-to-trough in R |
| `tailCapture` | % of total P&L from the top decile of trades — **does the runner harvest the tail?** |
| `costDrag` | total cost ÷ gross P&L — the silent killer, especially for the Grinder |
| `acted / vetoed` | risk-layer + cost-gate veto breakdown |

## `--mgmt-only` — why it exists (attribution)

Each smart thesis changes two things: **entry** (regime/IV/trend/cutoff fixes) and **management**
(the R-layer). A raw A/B win can't tell you which lever did the work. So every smart thesis cleanly
separates the two, and `--mgmt-only` makes the smart variant **inherit the base's entry rules** —
leaving the management block as the only difference.

Simple decomposition:

```
lift(--mgmt-only)              = contribution of MANAGEMENT alone
lift(full) − lift(--mgmt-only) = contribution of the ENTRY changes
```

Run both, subtract, and you know whether a result came from managing trades better or from being
choosier about entries. (The per-thesis "What changed vs v1" sections list exactly which rules flip
under the flag.)

## What each pair is expected to show (so the numbers don't surprise you)

| Pair | Hypothesis | Watch for |
|---|---|---|
| `breakout-smart` | ↑ expectancyR, ↑ tailCapture, ↓ maxDrawdownR | **winRate may fall** — breakeven scratches are the price of letting runners run. Correct for a convex strategy; not a regression. |
| `fade-smart` | expectancyR turns/stays positive after costs | If still weak after the regime/IV fixes, that's the signal to build **multi-leg** support (the real fade is a credit spread) rather than keep tuning. |
| `grind-smart` | kill-or-cure | If the cost gate can't lift expectancyR above 0, **retire the channel.** A structurally unprofitable scalper isn't a tuning problem. |
| `power-smart` | ↑ expectancyR, **↓↓ maxDrawdownR** | Should be the cleanest win — breakeven ratchet kills the v1 round-trip (a +3R winner riding back to zero at the bell). |

## Build sequence

Implement in the PR order from [`CLAUDE-CODE-BRIEF.md`](CLAUDE-CODE-BRIEF.md): (1) entryMinute
persistence → (2) cost model → (3) spec vocabulary → (4) state machine + management runtime → (5)
register smart channels → (6) A/B harness + report grouping. The first two are prerequisites:
without real entry timestamps the Grinder's clock is wrong, and without the cost model every
column is optimistic.

## Desk note (capability gaps this roster surfaces)

- **Entry kinds** still needed in the spec: `efficiency_ratio`, `momentum_atr`, `gamma_regime`
  (brief Part 3a).
- **Management block** is entirely new vocabulary (brief Part 3b): premium stops, R-multiples,
  scale-out ladders, breakeven trigger, adaptive trail, scale-in, cost gate.
- **Multi-leg / defined-risk structures** remain out of scope — the blocker for a structurally
  correct `fade`. Flagged as the next frontier, not built here.
