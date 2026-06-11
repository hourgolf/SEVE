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
  // Trader Plus). Same var name as market-ingest's STOCK_FEED, by design
  // (STOCK_WS_FEED kept as a back-compat alias). The ws host path differs per
  // feed; resolved in stream.ts.
  stockFeed: (process.env.STOCK_FEED ?? process.env.STOCK_WS_FEED ?? "iex") as "iex" | "sip",
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

  // ---- Posture ----
  // Phase A (default): DRY_RUN=true → shadow only, no orders, no prod writes.
  // Phase B (live): requires a TWO-KEY turn — DRY_RUN=false AND LIVE_TRADING=true
  // AND the service role — and even then the worker only trades channels whose
  // strategists.executor='stream' (30_executor_cutover.sql). Any other combination
  // refuses to start. Per-channel migration: flip executor in the DB; rollback is
  // the same UPDATE in reverse (the cron resumes within a cycle via its heartbeat
  // check).
  dryRun: flag("DRY_RUN", true),
  liveTrading: flag("LIVE_TRADING", false),
  // Fast EXIT poll cadence (seconds) while live with open stream-owned positions:
  // premium stop/target/giveback checked on the live chain between bar closes.
  fastExitSec: Number(opt("FAST_EXIT_SEC", "10")),
  // Fund-level equity snapshots stay with the cron until full cutover (else two
  // writers double-snapshot). Flip at Phase B4 when the cron is unscheduled.
  writeEquitySnapshots: flag("WRITE_EQUITY_SNAPSHOTS", false),
  // Mirror intended signals into the `events` table (tagged `stream-shadow:`) so
  // they can be compared to the cron worker's `signals` in the dashboard log.
  // Off by default to keep prod tables un-polluted; needs the service role.
  shadowWriteEvents: flag("SHADOW_WRITE_EVENTS", false),

  // Symbols this instance owns. SINGLE Alpaca data websocket per account/feed
  // (the 406 single-connection limit) → one socket subscribed to ALL of these,
  // routed by bar.S. Each symbol keeps its own in-memory bars + chain; the cron's
  // executor gate uses ONE 'stream' heartbeat, so this instance must reliably
  // handle EVERY symbol it lists (a silently-unhandled symbol whose channels are
  // flagged 'stream' would strand — cron defers on the fresh heartbeat while the
  // worker no-ops it). Default SPY,QQQ (QQQ shadow-runs until its channels flip).
  // SYMBOL (singular) kept as a back-compat alias for the first symbol.
  symbols: (process.env.SYMBOLS ?? process.env.SYMBOL ?? "SPY,QQQ")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  symbol: (process.env.SYMBOLS ?? process.env.SYMBOL ?? "SPY,QQQ").split(",")[0].trim().toUpperCase(),
  // How many strikes (± $) around spot to keep quoted in the NTM window.
  strikeWindow: Number(opt("STRIKE_WINDOW", "8")),
  // Trailing 1-min bars to seed/hold in memory (≈ 2+ sessions for pdh/pdl).
  barHistory: Number(opt("BAR_HISTORY", "900")),
} as const;

// Version tag — heartbeat note + logs (mirror the cron's banner convention).
export const WORKER_VERSION = "stream-2026-06-11b";

// ---- Policy constants (parity with the cron dispatcher 2026-06-11a) ---------
export const policy = {
  COST_GATE_RATIO: 3.0,
  // EMPTY since cron 2026-06-09a: the power exemption was refuted by the roster
  // probe (gating halves base power's bleed). ALL channels are cost-gated.
  COST_GATE_EXEMPT: new Set<string>(),
  PREMIUM_STOP_PCT: 50,
  POWER_TRAIL_CHANNELS: new Set(["power"]),
  POWER_TRAIL_ENGAGE_MULT: 2.0, // engage once mark ≥ entry × this (+100%)
  POWER_TRAIL_GIVEBACK_PCT: 40, // exit if it gives back > this % of peak gain
  ATM_DELTA: 0.55, // ATM 0DTE delta proxy when the quote carries none
  OPEN_0DTE_CUTOFF_MIN: 31, // inside last ~30 min, roll to 1DTE (Alpaca widened the lockout ~15→~30min, 06-11 422s)
  MANUAL_BACKSTOP_MIN: 3, // `-manual` twins: forced bell backstop (human owns exits)
  // Cost-gate cost model (fed REAL bid/ask → engine/cost.ts roundTripCostUsd).
  SLIPPAGE_TICKS_PER_SIDE: 0.25,
  COMMISSION_PER_CONTRACT: 0.04,
} as const;
