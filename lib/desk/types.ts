// ============================================================================
//  Desk domain types — the SEVE Console (Phase 2).
//  Shaped to the eventual DB columns (trading-desk-schema.sql) so the data seam
//  can later swap local/sample state for real Supabase reads + writes without
//  touching any component. UI-first: nothing here writes to the DB yet.
// ============================================================================

import type { EventLevel, OptionType } from "@/lib/types";

// One of the four strategist accent colors (matches the schema seed).
export type PmColor = "green" | "blue" | "amber" | "cyan";

// Mirrors strategist_config — the fader/knob/mute/solo positions.
export interface StrategistConfig {
  capital_pct: number; // 0–100, % of fund this PM may deploy
  aggression: number; // 0–100 size lean per trade
  max_contracts: number; // hard per-trade cap
  daily_stop_usd: number; // per-PM loss budget (positive $)
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
  closed_at?: string | null;
}

export interface ChannelPnl {
  dayPnl: number; // realized + unrealized for the day
  openCount: number; // open positions
  exposure: number; // $ deployed
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
