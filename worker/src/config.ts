// ============================================================================
//  Worker config — env + tunable policy constants.
//
//  The policy constants (cost gate / premium stop / power trail / cutoffs) are
//  the SAME values the cron worker uses (supabase/functions/paper-trader/
//  index.dispatcher.draft.ts). They are POLICY, not engine code, so they live
//  here; the SPEC interpreter + cost model are IMPORTED from engine/* (no inlined
//  twin), which is the whole point of the streaming driver — see
//  docs/streaming-worker.md and the add-channel-vocab-parity memory.
// ============================================================================

import dotenv from "dotenv";

// Load env without overriding anything already set (Railway's real env wins).
// Local dev convenience: also read the repo-root .env.local (ALPACA_KEY/SECRET +
// the anon key live there) when running from the worker/ dir.
dotenv.config();
dotenv.config({ path: "../.env.local" });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

export const config = {
  // ---- Alpaca ----
  alpacaKey: req("ALPACA_KEY"),
  alpacaSecret: req("ALPACA_SECRET"),
  // Paper trading + paper account data. (Algo Trader Plus is a DATA sub on the
  // same account — it unlocks sip/opra; the paper REST host is unchanged.)
  alpacaPaperHost: opt("ALPACA_PAPER_HOST", "https://paper-api.alpaca.markets"),
  alpacaDataHost: opt("ALPACA_DATA_HOST", "https://data.alpaca.markets"),
  // Stock-bar websocket feed: "iex" (free, runs NOW) → "sip" (real-time, on Algo
  // Trader Plus). The ws host path differs per feed; resolved in stream.ts.
  stockFeed: opt("STOCK_WS_FEED", "iex") as "iex" | "sip",
  // Option-quote REST snapshot feed: "indicative" (free, ~15-min delayed) →
  // "opra" (real-time NBBO, on Algo Trader Plus). v1 polls REST snapshots on
  // bar-close; the OPRA *websocket* push is a later latency optimization.
  optFeed: opt("OPT_FEED", "indicative") as "indicative" | "opra",

  // ---- Supabase ----
  // SUPABASE_URL on Railway; NEXT_PUBLIC_SUPABASE_URL is the same value in the
  // repo's .env.local (accepted for local runs).
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? req("SUPABASE_URL"),
  // Service role for writes (Railway). Locally this is usually absent → the worker
  // runs READ-ONLY shadow: it reads config/quotes via the anon key and LOGS
  // intents to stdout instead of writing tables. (NEXT_PUBLIC_* is the anon key in
  // .env.local, accepted as a convenience for local runs.)
  supabaseServiceKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,

  // ---- Posture (Phase A = SHADOW) ----
  // DRY_RUN true (default + ONLY supported value in v1) = place NO orders, log
  // intended signals. Live order placement is Phase B (a deliberate follow-on,
  // gated on the user; see README). The worker refuses to go live in v1.
  dryRun: flag("DRY_RUN", true),
  // Mirror intended signals into the `events` table (tagged `stream-shadow:`) so
  // they can be compared to the cron worker's `signals` in the dashboard log.
  // Off by default to keep prod tables un-polluted; needs the service role.
  shadowWriteEvents: flag("SHADOW_WRITE_EVENTS", false),

  symbol: opt("SYMBOL", "SPY"),
  // How many strikes (± $) around spot to keep quoted in the NTM window.
  strikeWindow: Number(opt("STRIKE_WINDOW", "8")),
  // Trailing 1-min bars to seed/hold in memory (≈ 2+ sessions for pdh/pdl).
  barHistory: Number(opt("BAR_HISTORY", "900")),
} as const;

// ---- Policy constants (parity with the cron dispatcher) --------------------
export const policy = {
  COST_GATE_RATIO: 3.0,
  COST_GATE_EXEMPT: new Set(["power"]),
  PREMIUM_STOP_PCT: 50,
  POWER_TRAIL_CHANNELS: new Set(["power"]),
  POWER_TRAIL_ENGAGE_MULT: 2.0, // engage once mark ≥ entry × this (+100%)
  POWER_TRAIL_GIVEBACK_PCT: 40, // exit if it gives back > this % of peak gain
  ATM_DELTA: 0.55, // ATM 0DTE delta proxy when the quote carries none
  OPEN_0DTE_CUTOFF_MIN: 16, // inside last ~15 min, roll new entries to 1DTE
  // Cost-gate cost model (fed REAL bid/ask → engine/cost.ts roundTripCostUsd).
  SLIPPAGE_TICKS_PER_SIDE: 0.25,
  COMMISSION_PER_CONTRACT: 0.04,
} as const;
