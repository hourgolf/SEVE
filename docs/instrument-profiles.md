# Instrument profiles — multi-ticker / multi-expiry co-existence (thought exercise)

> Status: **design exploration, not committed work.** Captured 2026-06-03 so the idea
> isn't lost. The desk trades SPY 0DTE/1DTE today; this scopes what it would take to let
> a different instrument class (e.g. SOFI weeklies, or just QQQ 0DTE) co-exist in the
> same desk without forking it.

## Core idea: split "what to trade on" from "how to decide"

Today a channel is implicitly `thesis × SPY-0DTE`, and the "SPY-0DTE" half is scattered
as literals across the worker, the ingest fn, and the engine. The abstraction pulls that
half into one named bundle — an **`InstrumentProfile`** — that a channel *references*.
The thesis (price-action features) stays instrument-agnostic; everything
instrument-specific moves into the profile.

```ts
interface InstrumentProfile {
  id: string;                 // 'spy-0dte' | 'qqq-0dte' | 'sofi-weekly'
  symbol: string;             // 'SPY' | 'SOFI' — drives bars query, OCC prefix, chain ingest
  expiry: ExpiryPolicy;       // which expiration to trade (the 0DTE-roll vs weekly logic)
  session: SessionModel;      // lifecycle: intraday-flatten vs multi-day hold
  strikeIncrement: number;    // $1 (SPY) | $0.5 (SOFI) — ATM rounding + valid OCC strike
  tickSize: number;           // option tick (0.01 / 0.05)
  cost: { slippageTicksPerSide: number; gateRatio: number };  // recalibrated per instrument
  atmDeltaProxy: number;      // the 0.55 ATM proxy today
}

type ExpiryPolicy =
  | { kind: '0dte-1dte'; openCutoffMin: number }       // today, roll to next session inside cutoff
  | { kind: 'weekly';  minDTE: number; maxDTE: number };   // nearest Friday in window

type SessionModel =
  | { kind: 'intraday'; flattenMinToClose: number }    // EOD flatten + minute time-stops (today)
  | { kind: 'swing';   maxHoldBars: number; dteStop: number };  // hold overnight, exit on DTE/age
```

Profiles live in a code registry (like `STRATEGY_REGISTRY` in `engine/registry.ts`),
keyed by `id`. A channel stores its `instrument_profile_id`.

## Where it plugs in, layer by layer

| Layer | Today (hardcoded) | Change |
|---|---|---|
| **Schema** | `strategists` has no ticker; `positions/orders/option_quotes/underlying_bars` already carry `underlying`/`symbol` (default `'SPY'`) | **One column:** `strategists.instrument_profile_id` (default `'spy-0dte'`). No other migration — the underlying cols already exist. |
| **Ingest** (`market-ingest.ts` ~L58, L76) | pulls `SPY` bars + `expiration_date_gte=today&lte=1DTE` | Loop over the **distinct profiles in use**; per profile, ingest `profile.symbol` bars + a chain window derived from `profile.expiry`. |
| **Worker — identity** (`paper-trader` `occSymbol()` L380, bars `.eq("symbol","SPY")` L426, insert `underlying:"SPY"` L673/722) | hardcoded `SPY` | all three read `profile.symbol`; strike rounds to `profile.strikeIncrement`. |
| **Worker — expiry** (`todayET`/`next1DTE`/`OPEN_0DTE_CUTOFF_MIN` ~L653) | hardcoded 0DTE/1DTE roll | `pickExpiry(profile.expiry, now, quotedExpirations)`. |
| **Worker — cost** (`COST_GATE_RATIO` L107, `SLIPPAGE_TICKS_PER_SIDE` L130) | calibrated to SPY 0DTE | read from `profile.cost`. |
| **Worker/engine — session/exits** | every strategy `build()` bakes `flatten`/`timeStop` in **RTH minutes** | `SessionModel` gates exits: `intraday` keeps eod-flatten + minute stops; `swing` **suppresses eod-flatten** and measures age in bars/DTE. **← deepest coupling.** |
| **Engine — sources** (`engine/realsource.ts`, `databentosource.ts`) | symbol = SPY | parameterize symbol. |
| **Dashboard** | one SPY chart/chain/`/api/spot` LED | per-channel instrument, or a ticker selector. Orthogonal to trading correctness. |

## Phasing (each independently shippable + verifiable)

- **Phase 0 — refactor, zero behavior change.** Introduce `InstrumentProfile`, define one
  profile `spy-0dte`, thread it through worker/ingest/engine replacing the SPY/0DTE
  literals. Every existing channel points at `spy-0dte`. **Verify:** identical trades to
  before (golden-test the dispatcher decisions). Load-bearing, low-risk — pays for itself
  even with no second ticker, because it kills the scattered literals.
- **Phase 1 — second *same-class* ticker (QQQ).** Add `qqq-0dte` (same
  `intraday`+`0dte-1dte`, different symbol + cost calibration), ingest QQQ, arm a QQQ
  channel. All the 0DTE machinery reuses unchanged. Proves multi-ticker end-to-end. ~days.
- **Phase 2 — new session class (the SOFI unlock).** Add the `swing` `SessionModel` +
  `weekly` `ExpiryPolicy` + a **daily/multi-day feature set** (`computeFeatures` is
  session-relative today — VWAP/opening-range/minutesToClose — so swing needs its own
  features track, not just a flag). Recalibrate the cost gate for wide single-name
  spreads. Write the actual single-name weekly thesis. **Real research + risk lives here**
  — the plumbing is small, the *edge* is unproven.
- **Phase 3 — dashboard multi-instrument.** Ticker selector / per-channel mini-charts.
  Biggest UX lift, fully decoupled from the above.

## The honest hard parts

1. **The session/exit model is the crux, not the ticker.** Symbol/OCC/strike/cost are
   clean to profile. "EOD flatten + 45-min time-stop" is woven into every strategy
   `build()` as RTH-minute constants. `swing` means those stop firing and "time" becomes
   age-in-days — the one change that touches strategy internals.
2. **Swing ≈ a second engine track.** Current features assume an intraday session. A
   weekly thesis wants daily bars + multi-day signals, so Phase 2 is "add a parallel
   feature+strategy family," with `SessionModel` as the switch — not a small flag.
3. **Data volume vs the 0.5 GB cap.** A weekly chain (more strikes × more expirations) is
   fatter than a 0DTE chain; × N tickers. Retention (`11_retention.sql`) needs per-instrument tuning.
4. **Liquidity is a strategy problem, not a code one.** SOFI's wide spreads may eat the
   edge regardless of how clean the abstraction is. Phase 1 (QQQ) de-risks the *plumbing*
   so Phase 2 is purely a *strategy* bet.

**Net:** Phase 0 + 1 is the real "multi-ticker" deliverable and it's mostly mechanical
(the data model + engine already support it). Phase 2 is the SOFI-specific lift, and most
of its cost is research, not refactor.
