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

// ---- Multi-account creds (cockpit P3) --------------------------------------
// Each non-default Alpaca paper account's creds live in env as ALPACA_KEY_<ref> /
// ALPACA_SECRET_<ref>, where <ref> matches the `accounts.cred_ref` column. The
// default account (cred_ref null/empty) uses ALPACA_KEY/SECRET. Channels route by
// their account's cred_ref → these creds (store.ts loads account_id; index.ts
// builds the per-account Api). A ref present in the DB but ABSENT here = that
// account simply can't go live (its channels stay shadow) — fail-safe, never a crash.
function loadAltAccounts(): Record<string, { key: string; secret: string }> {
  const out: Record<string, { key: string; secret: string }> = {};
  for (const m of Object.keys(process.env)) {
    const mm = m.match(/^ALPACA_KEY_(\w+)$/);
    if (!mm) continue;
    const ref = mm[1];
    const key = process.env[`ALPACA_KEY_${ref}`];
    const secret = process.env[`ALPACA_SECRET_${ref}`];
    if (key && secret) out[ref] = { key, secret };
  }
  return out;
}

export const config = {
  // ---- Alpaca ----
  alpacaKey: req("ALPACA_KEY"),
  alpacaSecret: req("ALPACA_SECRET"),
  // cred_ref → {key,secret} for the non-default paper accounts (cockpit P3).
  altAccounts: loadAltAccounts(),
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

  // ---- SPREAD-CAPTURE LADDER (#4 cost lever, A2 — 2026-06-22) ----
  // OFF by default → byte-identical to today's market-order fills (executeEntry/Add/
  // Exit fall straight through to alpaca.orderAndFill with the same client_order_id).
  // ON → every fill runs a marketable-limit→cross ladder (alpaca.limitLadderFill):
  // place a limit inside the spread, poll, re-price toward the cross, FINAL rung is a
  // market backstop so the order always completes. It recaptures part of the bid/ask
  // spread (the binding 0DTE cost) and LOGS the real $ captured per fill (tagged by
  // side+reason) — the shadow-first measurement before relying on it. The cost gate is
  // UNTOUCHED (decide.ts computes round-trip at the cross price), so capture can never
  // loosen the gate (the A1 gate-decoupled finding). Ladder is bounded (default ~3s of
  // limit attempts ≈ today's cancel window) so a collapsing-premium stop can't dawdle
  // into a worse fill — and negative capture on such stops shows up in the log.
  spreadCapture: flag("SPREAD_CAPTURE", false),
  spreadCaptureLadder: {
    frac: Number(opt("SPREAD_CAPTURE_FRAC", "0.5")),     // first-rung aggressiveness: 0=mid, 1=cross
    rungs: Number(opt("SPREAD_CAPTURE_RUNGS", "3")),     // total rungs incl. the final market cross
    rungSec: Number(opt("SPREAD_CAPTURE_RUNG_SEC", "1.5")), // seconds per limit rung before re-pricing
  },

  // Symbols this instance owns. SINGLE Alpaca data websocket per account/feed
  // (the 406 single-connection limit) → one socket subscribed to ALL of these,
  // routed by bar.S. Each symbol keeps its own in-memory bars + chain; the cron's
  // executor gate uses ONE 'stream' heartbeat, so this instance must reliably
  // handle EVERY symbol it lists (a silently-unhandled symbol whose channels are
  // flagged 'stream' would strand — cron defers on the fresh heartbeat while the
  // worker no-ops it). Default SPY,QQQ,IWM — IWM is the 2nd validated index (MOVE 3:
  // V3/ALT generalize 5/5 OOS). Listing it makes the worker seed[IWM] bars + snapshot
  // its 0DTE chain every cycle (data-only proof) BEFORE any IWM channel arms — the same
  // shadow gate QQQ passed. ⚠ Railway env SYMBOLS overrides this default, so to add IWM
  // live the env must be set to SPY,QQQ,IWM (or unset to fall through to this default).
  // SYMBOL (singular) kept as a back-compat alias for the first symbol.
  symbols: (process.env.SYMBOLS ?? process.env.SYMBOL ?? "SPY,QQQ,IWM")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  symbol: (process.env.SYMBOLS ?? process.env.SYMBOL ?? "SPY,QQQ,IWM").split(",")[0].trim().toUpperCase(),
  // Per-account ORPHAN safety-net (cockpit P3). When armed, auto-FLATTEN an Alpaca lot a
  // bucket holds with NO open desk row covering it (the 2026-06-24 manual-close bug stranded
  // exactly this). Default OFF = detect + page only (shadow-first; flattening live positions on
  // a held-vs-rows heuristic is where reconciliation bugs bite — arm after a clean detection day).
  orphanFlatten: flag("ORPHAN_FLATTEN", false),
  // ---- Operator alerts ("the desk summons you", 2026-06-12) ----
  // POSTs to the app's /api/push-send — the SAME route + secret the cron's ✋
  // manual-twin ping uses (x-push-secret = the app's PUSH_SEND_SECRET). Both
  // unset → alerts log to stdout only (fail-safe: missing env never blocks
  // trading, you just don't get paged).
  appUrl: opt("APP_URL", ""),
  pushSecret: process.env.PUSH_SECRET ?? process.env.PUSH_SEND_SECRET ?? "",

  // How many strikes (± $) around spot to keep quoted in the NTM window.
  strikeWindow: Number(opt("STRIKE_WINDOW", "8")),
  // Trailing 1-min bars to seed/hold in memory. ⚠ sized for EXTENDED-hours flow:
  // SIP streams pre/post-market bars into the store (only cycle triggers are
  // RTH-gated), so a calendar day ≈ 960 bars — the old 900 default held barely
  // ONE day and silently truncated the prior session's pdh/pdl window and the
  // gap's prior-close reference by Monday afternoons (found 2026-06-12). 2400 ≈
  // 2.5 calendar days incl. extended hours = full prior session always present.
  barHistory: Number(opt("BAR_HISTORY", "2400")),
} as const;

// Version tag — heartbeat note + logs (mirror the cron's banner convention).
export const WORKER_VERSION = "stream-2026-06-25a"; // + per-channel strike_offset (ITM/OTM) + per-channel premium_stop_pct (decide/execute/store); boot banner = the deploy-source proof

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
  // EOD HARD-FLATTEN (2026-06-19, the Juneteenth strand fix): a WALL-CLOCK backstop that
  // force-flattens a SAME-SESSION machine position this many minutes before the 16:00 bell.
  // The strategy's own eod_flatten is BAR-relative (minutesToClose = RTH_CLOSE − lastBarMin),
  // so when the near-bell bar gaps (06-18: no 15:59 bar) the flatten never triggers and the
  // position strands — over a 3-day weekend if a holiday follows. The fast-exit sweep (10s
  // wall-clock timer, runs even when bars stop) fires this with margin so the flatten fills
  // while the market is open. Machine channels only — manual twins keep MANUAL_BACKSTOP_MIN.
  EOD_HARD_FLATTEN_MIN: 5, // flatten at ~15:55 ET (5 min margin to fill before the close)
  // Cost-gate cost model (fed REAL bid/ask → engine/cost.ts roundTripCostUsd).
  SLIPPAGE_TICKS_PER_SIDE: 0.25,
  COMMISSION_PER_CONTRACT: 0.04,
  // EVENT STAND-DOWN (calendar-awareness, 2026-06-11): around a scheduled INTRADAY
  // binary (FOMC 14:00 statement — verified 2.40× localized vol spike, invisible to
  // gap_min), flatten holdings and block new entries. Window = [event−BEFORE,
  // event+AFTER) = 13:50→14:30 for FOMC (the probed spike window). Risk-OFF only:
  // fail-safe is a missed 40 min on ~8 days/yr. EVENT_STANDDOWN=0/false disables.
  EVENT_STANDDOWN: flag("EVENT_STANDDOWN", true),
  EVENT_FLATTEN_MIN_BEFORE: 10,
  EVENT_RESUME_MIN_AFTER: 30,
  // OPERATOR ALERT thresholds (alerts.ts — informational pages, NEVER an exit
  // path): a ripper crossing +CROSS% of entry premium; a meaningful peak
  // (≥ MIN_PEAK%) giving back ≥ FRAC of the move — the same 50%-giveback amber
  // the positions panel shows, now pushed to the phone while it's happening.
  ALERT_CROSS_PCT: 75,
  ALERT_GIVEBACK_FRAC: 0.5,
  ALERT_GIVEBACK_MIN_PEAK_PCT: 30,
} as const;
