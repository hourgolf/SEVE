// Shape of the three tables the dashboard reads. Mirrors 02_market_data.sql
// (option_quotes, underlying_bars) and trading-desk-schema.sql (events).
// Numerics arrive from PostgREST as JS numbers; nullable columns can be null.

export type OptionType = "call" | "put";
export type EventLevel = "OK" | "INFO" | "WARN" | "RISK" | "EXEC";

export interface OptionQuote {
  id: string;
  occ_symbol: string;
  underlying: string;
  expiration: string; // date, e.g. "2026-05-29"
  strike: number;
  opt_type: OptionType;
  underlying_price: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  bid_size: number | null;
  ask_size: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  captured_at: string; // timestamptz ISO string
}

export interface UnderlyingBar {
  ts: string; // timestamptz ISO string
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  vwap: number | null;
}

export interface MarketEvent {
  id: string;
  level: EventLevel;
  strategist_id: string | null;
  message: string;
  meta: unknown;
  created_at: string; // timestamptz ISO string
}

// 'live'  — fresh snapshot (≤ 3 min old)
// 'stale' — no data, or latest snapshot older than 3 min (market closed / cron paused)
// 'err'   — a read failed
export type FeedStatus = "live" | "stale" | "err";
