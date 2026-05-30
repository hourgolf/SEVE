// ============================================================================
//  Seed desk state — the known values from trading-desk-schema.sql.
//  Used as the console's initial state (the anon key can't read these tables
//  yet). When the data seam goes live, replace seedDesk() with a Supabase read.
// ============================================================================

import type { DeskState, StrategistState } from "@/lib/desk/types";

// Maps the schema's hex accents to our PmColor tokens.
const STRATEGISTS: StrategistState[] = [
  {
    id: "",
    slug: "fade",
    name: "The Fade",
    mandate: "Mean reversion — fades range extremes back to VWAP",
    regime: "range-bound / high-IV chop",
    color: "green",
    config: {
      capital_pct: 30,
      aggression: 40,
      max_contracts: 6,
      daily_stop_usd: 90,
      muted: false,
      soloed: false,
    },
  },
  {
    id: "",
    slug: "breakout",
    name: "The Breakout",
    mandate: "Momentum — rides opening-range expansion in the break's direction",
    regime: "trending / expansion / news days",
    color: "blue",
    config: {
      capital_pct: 25,
      aggression: 62,
      max_contracts: 4,
      daily_stop_usd: 80,
      muted: false,
      soloed: false,
    },
  },
  {
    id: "",
    slug: "power",
    name: "Power Hour",
    mandate: "0DTE gamma — directional lean in the final hour only",
    regime: "any tape, 15:00–16:00 ET only",
    color: "amber",
    config: {
      capital_pct: 20,
      aggression: 75,
      max_contracts: 3,
      daily_stop_usd: 70,
      muted: false,
      soloed: false,
    },
  },
  {
    id: "",
    slug: "grind",
    name: "The Grinder",
    mandate: "Scalper — many small microstructure edges, quick in and out",
    regime: "liquid, normal-volatility intraday",
    color: "cyan",
    config: {
      capital_pct: 15,
      aggression: 30,
      max_contracts: 8,
      daily_stop_usd: 60,
      muted: false,
      soloed: false,
    },
  },
];

export function seedDesk(): DeskState {
  return {
    // deep copy so the reducer never mutates this module-level constant
    strategists: STRATEGISTS.map((s) => ({ ...s, config: { ...s.config } })),
    fund: {
      total_capital_usd: 10000,
      master_daily_stop_usd: 300,
      mode: "paper",
      is_halted: false,
      halted_reason: null,
      running: true,
    },
  };
}
