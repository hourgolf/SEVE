// ============================================================================
//  Desk domain types — the SEVE Console (Phase 2).
//  Shaped to the eventual DB columns (trading-desk-schema.sql) so the data seam
//  can later swap local/sample state for real Supabase reads + writes without
//  touching any component. UI-first: nothing here writes to the DB yet.
// ============================================================================

import type { EventLevel, OptionType } from "@/lib/types";
import type { StrategySpec } from "@/lib/desk/strategySpec";

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
// Two-dial model (2026-06-04): the operator-facing knobs are RISK $/trade + ENTRY
// LATCH $/day. `capital_pct` is the LEGACY column name but now holds RISK $/trade (the worker
// sizes risk-based: qty = riskUsd ÷ the −50% premium stop, capped by max_contracts).
// `aggression` is retired (reserved for a future conviction scaler); `max_contracts`
// is the hidden hard ceiling. No schema migration — just reinterpreted values.
export interface StrategistConfig {
  capital_pct: number; // RISK $/trade (legacy column name — holds dollars, not a %)
  aggression: number; // RETIRED — unused by sizing; kept for the column / future use
  max_contracts: number; // hidden hard per-trade ceiling
  daily_stop_usd: number; // ENTRY LATCH $/day — halts new entries at this realized loss (wired)
  muted: boolean;
  soloed: boolean; // DORMANT — replaced by `boosted`; nothing sets it true now, so solo-ducking never fires
  boosted?: boolean; // BOOST: 2× sizing for the day (RISK + cap + daily-stop); replaces SOLO; auto-cleared nightly
  // Live channel attributes now exposed as strip controls (optional = back-compat with
  // the seed; load.ts fills them from the DB, the UI reads with defaults).
  underlying_stop_pct?: number; // 0 = off; exits when the underlying moves X% against entry
  event_policy?: "standdown" | "ignore"; // scheduled-event (FOMC) posture
  entry_dte?: number; // 0 = today's expiry + cutoff roll; 1 = always next session's expiry
  take_profit_pct?: number; // 0 = off (ride); >0 = exit at +pct% premium then re-enter (compound)
  premium_stop_pct?: number | null; // per-trade premium STOP % (null/0 → policy default 50); the binding downside
  pyramid_adds?: number; // 0 = off (Phase A shadow); N>0 = the worker adds up to N lots to a winning V3/ALT position (stack capped at max_contracts → the cap12 arm = 3 + max_contracts 12). Only V3/ALT act on it.
  strike_offset?: number; // signed strike steps from ATM (e.g. −1 = one strike ITM for a long call)
  gap_min?: number; // config-level overnight-gap threshold; compiled specs may carry their own gate
  stall_minutes?: number; // 0 = off; exit a stranded trade after N minutes
  stall_max_favor_pct?: number; // stall exit only if peak favor never cleared this %
  daily_target_usd?: number; // win-and-done entry latch; 0 = off
}

// A strategist + its live config (strategists ⋈ strategist_config).
export interface StrategistState {
  id: string; // strategists.id (uuid) — target for strategist_config writes
  slug: string;
  underlying: string; // the ticker this channel trades (SPY default; QQQ, …) — strategists.underlying
  name: string;
  mandate: string;
  regime: string;
  color: PmColor;
  // Lifecycle status — 'armed' channels trade; 'draft'/'disabled' do not.
  status: ChannelStatus;
  // Which engine places this channel's orders ('cron' minute worker | 'stream' Railway
  // worker). Editable from the strip; optional = back-compat (default 'cron').
  executor?: "cron" | "stream";
  // Which account this channel belongs to (multi-account cockpit, 36_accounts_foundation).
  // Optional = back-compat; the desk filters the visible roster by the selected account.
  account_id?: string | null;
  /** Compiled thesis when this is a spec channel. Built-ins resolve through engine/registry. */
  spec?: StrategySpec | null;
  config: StrategistConfig;
  // Factory defaults for this trader — what the channel's RESET restores. Carried
  // per-strategist so future pluggable traders ship their own default behaviour.
  defaults: StrategistConfig;
}

// Mirrors the `accounts` table (multi-account cockpit). One broker login the desk drives.
export interface Account {
  id: string;
  name: string;
  mode: "paper" | "live";
  is_active: boolean;
  accent: PmColor | string;
  sort_order: number;
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
  // Durable exit attribution (31_close_reason.sql): machine reason (stop_premium /
  // eod_flatten / …), 'manual' for an operator close, 'manual:<tag>' once tagged.
  close_reason?: string | null;
  // Peak instrumentation (61_peak_marks.sql / A7): best mark since entry + when it printed —
  // the avg-peak lens per trade (peak% + time-to-peak on the closed-trade detail row).
  peak_mark?: number | null;
  peak_at?: string | null;
  // Runner/remainder lineage. A root plus its runner rows is one logical trade;
  // the rows remain separate immutable tranche evidence.
  runner_of?: string | null;
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
  pkSum: number; // Σ peak% ((peak_mark/entry − 1)·100) over closed trades with peak data — the harvest lens
  pkN: number;   // closed trades carrying peak_mark (denominator for avg peak)
}

export interface Signal {
  id: string;
  strategist_slug: string;
  level: EventLevel; // reuse the event-log color palette
  signal_type: string; // e.g. 'MR-FADE', 'ORB-L'
  message: string;
  created_at: string;
  direction?: "call" | "put" | null;
  acted_on?: boolean;
  blocked_reason?: string | null;
}

// One cell of the 16-step sequencer row.
export interface Step {
  lit: boolean;
  color?: PmColor;
  pulse?: boolean;
}
