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
}

// A strategist's intent (mirrors signals).
export interface Signal {
  slug: string;
  signalType: string;
  direction: OptType; // call = bullish, put = bearish
  strike: number; // chosen contract strike
  reason: string;
}

// An open position the engine tracks (mirrors positions).
export interface Position {
  slug: string;
  strike: number;
  optType: OptType;
  qty: number; // contracts (long, +)
  entryPrice: number; // per-contract fill
  entryMinute: number; // bar index at entry (for the time-stop)
  entryUnderlying: number; // spot at entry (for the price stop)
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
  pnl: number; // $ (signed), net of fees
  exitReason: string;
}
