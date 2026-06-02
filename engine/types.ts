// ============================================================================
//  SEVE engine — core types (Phase A, backtest-only).
//  Portable TS (no Node/Deno/browser APIs) so the same engine core runs in a
//  Node backtest today and a Deno live worker later — "one engine, two drivers".
// ============================================================================

export type OptType = "call" | "put";

// A 1-minute underlying bar (mirrors underlying_bars).
export interface Bar {
  ts: number; // epoch ms (bar close)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number; // cumulative session VWAP at this bar
}

// One option contract quote at a moment (mirrors option_quotes).
export interface Quote {
  strike: number;
  optType: OptType;
  bid: number;
  ask: number;
  mid: number;
}

// The operator's mixer settings (mirrors strategist_config).
export interface StrategistConfig {
  slug: string;
  capital_pct: number; // 0–100
  aggression: number; // 0–100
  max_contracts: number;
  daily_stop_usd: number;
  muted: boolean;
  soloed: boolean;
}

export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  is_halted: boolean;
}

// Features the strategists read each tick.
export interface Features {
  minute: number; // minutes since session open
  minutesToClose: number;
  close: number;
  vwap: number;
  openRangeHi: number | null; // first 30m
  openRangeLo: number | null;
  atr: number; // 1-min ATR proxy
  mom: number; // close - close[3] (signed momentum)
  er: number; // efficiency ratio over ~30m (0 = chop, ~1 = clean trend)
  relVol: number; // current volume / trailing-average volume (expansion > 1)
}

// One leg of a multi-leg structure (straddle/strangle/vertical/condor). Strikes
// are expressed as an offset (in $1 SPY strikes) from the ATM strike at entry, so
// a strategy describes geometry once and the engine resolves real strikes live.
export interface LegSpec {
  optType: OptType;
  side: "long" | "short"; // long = bought (debit), short = sold (credit)
  strikeOffset: number; // 0 = ATM, +n = n strikes above, −n = below
  ratio: number; // qty multiplier vs the position size (1 = same)
}

// A strategist's intent for a given bar (shared by every strategy). A single-leg
// strategy sets `direction`; a multi-leg one sets `legs` (+ a `structure` label).
export interface EntryIntent {
  kind: "enter";
  direction?: OptType; // single-leg
  structure?: "single-leg" | "straddle" | "strangle" | "vertical" | "iron-condor";
  legs?: LegSpec[]; // multi-leg geometry (resolved to strikes at entry)
  reason: string;
}
export interface ExitIntent {
  kind: "exit";
  reason: string;
}
export type Intent = EntryIntent | ExitIntent | null;

// A strategy is a pure function of features + current position.
export type Evaluate = (f: Features, pos: Position | null) => Intent;

// A strategist's intent (mirrors signals).
export interface Signal {
  slug: string;
  signalType: string;
  direction: OptType; // call = bullish, put = bearish
  strike: number; // chosen contract strike
  reason: string;
}

// A resolved leg of an open multi-leg position.
export interface PositionLeg {
  strike: number;
  optType: OptType;
  side: "long" | "short";
  qty: number; // contracts for THIS leg (ratio × position qty)
  entryPrice: number; // per-contract fill
}

// An open position the engine tracks (mirrors positions). Single-leg uses
// strike/optType; multi-leg additionally carries `legs` (then entryPrice is the
// net debit per unit and strike/optType are the ATM reference).
export interface Position {
  slug: string;
  strike: number;
  optType: OptType;
  qty: number; // contracts (long, +) / structures for multi-leg
  entryPrice: number; // per-contract fill (single) / net debit per unit (multi)
  entryMinute: number; // bar index at entry (for the time-stop)
  entryUnderlying: number; // spot at entry (for the price stop)
  peakFavorable: number; // best favorable underlying since entry (trailing stop)
  legs?: PositionLeg[]; // present → multi-leg structure
  entryEdgeUsd?: number; // entry-side spread+slippage cost ($, total over legs×qty)
}

// A completed round-trip (for metrics).
export interface Trade {
  slug: string;
  strike: number;
  optType: OptType;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  entryTs: number;
  exitTs: number;
  pnl: number; // $ (signed), net of cost
  exitReason: string;
  cost?: number; // total round-trip transaction cost ($) for this trade
}
