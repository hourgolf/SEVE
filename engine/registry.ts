// ============================================================================
//  Strategy registry — the seam that makes channels pluggable.
//
//  Maps a strategist `slug` → a strategy definition (timeframe, warmup, and a
//  `build()` that returns the shared `Evaluate` the engine already speaks). Both
//  drivers use it: the backtest engine (engine/backtest.ts) and the live worker
//  (supabase/functions/paper-trader) loop `computeFeatures → evaluate(f,pos)`
//  exactly the same way — "one engine, two drivers".
//
//  Each of the four desk channels now runs the strategy that matches its OWN
//  mandate (not a shared placeholder). Adding a channel = add an entry here
//  (code strategy) OR register a spec-compiled Evaluate produced from an uploaded
//  .md thesis (see docs/strategy-channels.md → StrategySpec). A slug with no
//  entry shows in the console but stays idle.
//
//  NOTE: power & grind are first-draft theses — backtest them on real option_bars
//  (npm run backtest) and Arm them before they trade live (the safety gate).
// ============================================================================

import type { Bar, Evaluate } from "./types";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { fadeEvaluate, DEFAULT_FADE_PARAMS } from "./strategies/fade";
import { powerEvaluate, DEFAULT_POWER_PARAMS, DEFAULT_POWER_MOM30 } from "./strategies/power";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { grindV2Evaluate, DEFAULT_GRIND_V2_PARAMS, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { buildPullback } from "./strategies/pullback";

export interface StrategyDef {
  slug: string;
  name: string;
  /** Bar size the edge is evaluated on (the dispatcher aggregates to this).
   *  These mandate strategies read session features, so they run on 1-min bars. */
  timeframeMin: number;
  /** Completed bars required before the strategy may fire (≈ opening range). */
  warmupBars: number;
  /** One-line thesis (shown in the console / used as the .md seed). */
  mandate: string;
  /** Build a per-run evaluator. Stateless strategies ignore `bars`; factory
   *  strategies (e.g. an EMA-cross) precompute over the series. Mirrors
   *  engine/backtest.ts. */
  build: (bars: Bar[], tfMin: number) => Evaluate;
}

export const STRATEGY_REGISTRY: Record<string, StrategyDef> = {
  // Momentum — opening-range breakout, ride the trend (its true mandate).
  breakout: {
    slug: "breakout",
    name: "The Breakout",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Momentum — rides opening-range expansion in the break's direction.",
    build: () => (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS),
  },

  // Mean reversion — fade ≥1.5-ATR stretches beyond VWAP back to the mean in chop.
  fade: {
    slug: "fade",
    name: "The Fade",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Mean reversion — fades range extremes back to VWAP.",
    build: () => (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS),
  },

  // 0DTE gamma — final-hour directional lean with the day's trend.
  power: {
    slug: "power",
    name: "Power Hour",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "0DTE gamma — directional lean in the final hour only.",
    build: () => (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS),
  },

  // Power Hour, retuned — the FINAL 30 MIN only, pure momentum lean (no VWAP gate). The
  // window sweep (real fills H1) flipped power's gross from −$8.4k (60m) to +$8.9k (30m):
  // the 15:00–15:30 half was dragging it negative. DRAFT — the live A/B vs base power.
  "power-final30": {
    slug: "power-final30",
    name: "Power Final 30",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "0DTE gamma — momentum lean in the FINAL 30 MIN only, hard flatten by the bell.",
    build: () => (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM30),
  },

  // Scalper — many small microstructure momentum bursts, quick in and out.
  grind: {
    slug: "grind",
    name: "The Grinder",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Scalper — many small microstructure edges, quick in and out.",
    build: () => (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS),
  },

  // Scalper v2 — data-driven rework: afternoon curfew + efficiency-ratio gate + a
  // chandelier trail so winners run (vs grind's insta-exit). DRAFT — backtest first.
  "grind-v2": {
    slug: "grind-v2",
    name: "The Grinder v2",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Scalper, timed+trailed — midday momentum bursts, curfew the afternoon, ride the runner.",
    build: () => (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V2_PARAMS),
  },

  // Scalper v3 — v2's entry discipline (curfew + er-gate + bigger burst) with grind's
  // FAST fixed-target exit. Backtest: best per-trade gross of the grind family; the v2
  // trail backfired in chop. Still cost-walled ungated — validate live (gated). DRAFT.
  "grind-v3": {
    slug: "grind-v3",
    name: "The Grinder v3",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Disciplined scalper — midday-only momentum bursts (trend-gated), fast fixed-target exit, afternoon curfew.",
    build: () => (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V3_PARAMS),
  },

  // Pullback-continuation (PB-ride) — generative-inventory survivor (2026-06-12):
  // killed at 0DTE (gamma = 67% premium-stop rate), resurrected at 1DTE (+$4,632,
  // 4/5 windows positive). ⚠ REQUIRES strategist_config.entry_dte=1 — the 0DTE
  // variant is REFUTED; the edge IS the time value. Paper-lab DRAFT; arm bar unchanged.
  "pb-ride": {
    slug: "pb-ride",
    name: "Pullback Rider (1DTE)",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Trend pullback-continuation — ribbon-stacked trend, band-tag retrace, with-trend bounce entry on 1DTE time value; ride with the catastrophic stop.",
    build: (bars, tfMin) => buildPullback(bars, tfMin),
  },
};

export function getStrategy(slug: string): StrategyDef | null {
  return STRATEGY_REGISTRY[slug] ?? null;
}

/** Slugs the dispatcher will actually evaluate (have a registered edge). */
export function activeStrategySlugs(): string[] {
  return Object.keys(STRATEGY_REGISTRY);
}
