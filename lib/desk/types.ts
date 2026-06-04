// ============================================================================
//  Desk domain types — the SEVE Console (Phase 2).
//  Shaped to the eventual DB columns (trading-desk-schema.sql) so the data seam
//  can later swap local/sample state for real Supabase reads + writes without
//  touching any component. UI-first: nothing here writes to the DB yet.
// ============================================================================

import type { EventLevel, OptionType } from "@/lib/types";

// A strategist accent color — 12-token LED/909 palette (lib/desk/colors.ts owns
// the ordered list; app/console.css owns the matching --pm-<token> vars + classes).
export type PmColor =
  | "green" | "blue" | "amber" | "cyan"
  | "red" | "orange" | "yellow" | "lime" | "teal" | "indigo" | "violet" | "magenta";

// Channel lifecycle: 'draft' = compiled/stored but never trades; 'armed' =
// backtest-gated + live in the dispatcher; 'disabled' = parked. The dispatcher
// only places orders for 'armed' channels.
export type ChannelStatus = "draft" | "armed" | "disabled";

// Mirrors strategist_config — the fader/knob/mute/solo positions.
// Two-dial model (2026-06-04): the operator-facing knobs are RISK $/trade + STOP
// $/day. `capital_pct` is the LEGACY column name but now holds RISK $/trade (the worker
// sizes risk-based: qty = riskUsd ÷ the −50% premium stop, capped by max_contracts).
// `aggression` is retired (reserved for a future conviction scaler); `max_contracts`
// is the hidden hard ceiling. No schema migration — just reinterpreted values.
export interface StrategistConfig {
  capital_pct: number; // RISK $/trade (legacy column name — holds dollars, not a %)
  aggression: number; // RETIRED — unused by sizing; kept for the column / future use
  max_contracts: number; // hidden hard per-trade ceiling
  daily_stop_usd: number; // STOP $/day — halts new entries at this realized loss (wired)
  muted: boolean;
  soloed: boolean;
}

// A strategist + its live config (strategists ⋈ strategist_config).
export interface StrategistState {
  id: string; // strategists.id (uuid) — target for strategist_config writes
  slug: string;
  name: string;
  mandate: string;
  regime: string;
  color: PmColor;
  // Lifecycle status — 'armed' channels trade; 'draft'/'disabled' do not.
  status: ChannelStatus;
  config: StrategistConfig;
  // Factory defaults for this trader — what the channel's RESET restores. Carried
  // per-strategist so future pluggable traders ship their own default behaviour.
  defaults: StrategistConfig;
}

// Mirrors fund_state — the master strip. `running` is a UI transport flag.
export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  mode: "paper" | "live";
  is_halted: boolean;
  halted_reason: string | null;
  running: boolean;
}

export interface DeskState {
  strategists: StrategistState[];
  fund: FundState;
}

// --- sample/live feed shapes (positions, P&L, signals) ---------------------
// Shaped to the positions / signals / equity_snapshots tables.

export interface Position {
  id: string;
  strategist_slug: string;
  occ_symbol: string;
  expiration: string;
  strike: number;
  opt_type: OptionType;
  qty: number; // signed (+ long / − short)
  avg_entry_price: number;
  current_mark: number;
  unrealized_pnl: number;
  // closed trades carry realized P&L; open ones carry unrealized. Day P&L sums
  // realized (closed-today) + unrealized (open) so fast scalps still show up.
  status?: "open" | "closed";
  realized_pnl?: number;
  opened_at?: string | null;
  closed_at?: string | null;
}

// Drill-down detail for one trade — what triggered it + how it exited. Fetched
// lazily (on click) by useTradeInsight, NOT carried in the always-polled feed.
export interface TradeInsight {
  trigger: {
    signal_type: string;
    direction?: string | null;
    underlying_price?: number;
    rationale?: Record<string, unknown> | null; // {atr, er, relVol, delta, roundTrip, expectedMove, ask, bid, …}
    created_at?: string;
  } | null;
  exitReason: string | null; // parsed from the EXEC exit event, e.g. "time_stop", "premium_stop"
}

export interface ChannelPnl {
  dayPnl: number; // realized + unrealized for the day
  openCount: number; // open positions
  exposure: number; // $ deployed
  trades: number; // CLOSED trades counted in the window (for win-rate)
  wins: number; // of those, how many were realized > 0
}

export interface Signal {
  id: string;
  strategist_slug: string;
  level: EventLevel; // reuse the event-log color palette
  signal_type: string; // e.g. 'MR-FADE', 'ORB-L'
  message: string;
  created_at: string;
}

// One cell of the 16-step sequencer row.
export interface Step {
  lit: boolean;
  color?: PmColor;
  pulse?: boolean;
}
