# SEVE Engine (Phase A — backtest core)

The trading engine that will bring the four strategists to life. Phase A builds
the **portable core** + **The Fade** + a **backtest harness**, runnable today.

## Run

```bash
npm run backtest -- --days 60 --seed 1
```

Prints an expectancy report (win rate, avg win/loss, expectancy/trade, total
P&L, max drawdown, exit-reason breakdown) for The Fade.

## What's here

- `types.ts` — portable engine types (`Bar`, `Quote`, `Signal`, `Position`, …).
- `market.ts` — Black-Scholes pricing, a seeded RNG, and `generateSession()` —
  synthetic full 9:30–16:00 ET days in **trend** or **range** regimes, plus
  `priceChain()` to build synthetic 0DTE chains.
- `engine.ts` — pure core: `computeFeatures` (VWAP, opening range, ATR,
  momentum), `fillPrice` (cross-the-spread + slippage paper fills), and
  `riskGovernor` (mute/solo/halt → master/PM daily stops → capital·aggression
  sizing capped at max_contracts).
- `strategies/fade.ts` — **The Fade**: enter on a ≥1.5-ATR stretch beyond the
  opening range away from VWAP on weak momentum; exit on revert-to-VWAP, an
  adverse-ATR stop, a time-stop, or the EOD flatten.
- `backtest.ts` — replays sessions through the same core and reports metrics.

## ⚠️ Data honesty

The current data set is **~1 partial captured day** (and it's missing the
market open). So the backtest runs on **synthetic** sessions, which validate the
**engine + strategy shape and the plumbing end-to-end** — they are **not** a
claim of real edge. The synthetic generator is also range-regime-heavy, which
The Fade (a mean-reversion strategy) is built to profit from, so a positive
synthetic expectancy mostly confirms "the logic trades as designed," not "this
makes money live." Real-edge measurement needs captured/real option history
(accumulating now) or a historical bars backfill via the Alpaca-credentialed
ingest function.

## Design note: one engine, two drivers

The core (`computeFeatures` / `riskGovernor` / `fillPrice` / strategy rules) is
pure and runtime-agnostic. `backtest.ts` is the **backtest driver** (synthetic
clock + synthetic/captured data + in-memory book). **Phase B** adds the **live
driver** — a dedicated always-on worker that feeds the *same* core real
`underlying_bars`/`option_quotes` and writes `signals`/`orders`/`fills`/
`positions`/`equity_snapshots`, lighting up the console & desk with zero
frontend changes.
