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
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";

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

  // Scalper — many small microstructure momentum bursts, quick in and out.
  grind: {
    slug: "grind",
    name: "The Grinder",
    timeframeMin: 1,
    warmupBars: 30,
    mandate: "Scalper — many small microstructure edges, quick in and out.",
    build: () => (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS),
  },
};

export function getStrategy(slug: string): StrategyDef | null {
  return STRATEGY_REGISTRY[slug] ?? null;
}

/** Slugs the dispatcher will actually evaluate (have a registered edge). */
export function activeStrategySlugs(): string[] {
  return Object.keys(STRATEGY_REGISTRY);
}
