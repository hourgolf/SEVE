// ============================================================================
//  Supabase store — config reads (fund_state + strategists ⋈ strategist_config),
//  open-position reads (per-channel attribution), the Realtime KILL-switch
//  subscription (so a halt bites in <1s), and shadow event writes.
//
//  Uses the service role on Railway (full read/write). Locally it falls back to
//  the anon key → READ-ONLY: config + quotes read fine (RLS allows anon SELECT),
//  writes are skipped (logged instead). See config.hasServiceRole.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "./config.js";
import { info, warn } from "./log.js";

// supabase realtime-js needs a WebSocket implementation; Node <22 has no global
// one (it throws on createClient). Provide `ws` explicitly so it works on any
// Node version. Type extracted from createClient's own options so there's no `any`.
type WSTransport = NonNullable<NonNullable<Parameters<typeof createClient>[2]>["realtime"]>["transport"];

export interface ChannelConfig {
  id: string;
  slug: string;
  name: string;
  status: "armed" | "draft" | "disabled";
  spec_json: unknown | null;
  underlying: string;           // per-channel ticker (QQQ rollout) — SPY default
  executor: "cron" | "stream";  // Phase B: who places this channel's orders
  capital_pct: number;          // two-dial model: RISK $/trade (legacy column name)
  aggression: number;           // retired knob (kept for the legacy read)
  max_contracts: number;
  daily_stop_usd: number;
  underlying_stop_pct: number;  // 0 = off (config-gated underlying initial stop)
  muted: boolean;
  soloed: boolean;
  // Per-channel event posture (33_event_policy.sql): 'standdown' (default) =
  // flatten + block entries in a scheduled-event window; 'ignore' = the channel's
  // thesis owns the event (future event-native strategies opt out here).
  event_policy: "standdown" | "ignore";
  // Per-channel entry DTE (34_entry_dte.sql): 0 = today's expiry + cutoff roll
  // (default); 1 = ALWAYS the next session's expiry (pb-ride — its edge IS the
  // 1DTE time value). Same-day flatten unchanged either way.
  entry_dte: number;
  // Per-channel TAKE-PROFIT (compound policy, 38_take_profit.sql): exit at +pct% of
  // premium, then RE-ENTER on the next signal when flat. For channels with NO convex
  // tail (PB: ridden −EV, compound +EV) compounding beats riding. 0 = off (ride to the
  // −50% stop / flatten). Mirrors the engine's premiumExit.profitPct (compound-vs-ride-probe).
  take_profit_pct: number;
  // Per-channel PYRAMID executor switch (39_pyramid_adds.sql): the MAX lots the live worker may
  // ADD to a winning V3/ALT position as it runs (same contract, never average down; whole stack
  // exits together). 0 = OFF (Phase A shadow only — byte-identical). N>0 = add up to N lots, total
  // stack capped at max_contracts. The validated "cap12" arm = pyramid_adds=3 + max_contracts=12.
  // Only ever acts on the hardcoded PYRAMID_SLUGS (V3/ALT). (pyramid-roster-faithful, 2026-06-19.)
  pyramid_adds: number;
}
export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  mode: string;
  is_halted: boolean;
}
export interface PositionRow {
  id: string;
  strategist_id: string;
  occ_symbol: string;
  opt_type: "call" | "put";
  qty: number;
  avg_entry_price: number;
  strike: number;
  expiration: string | null;
  opened_at: string | null;
  status: string;
}

const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as WSTransport },
});

export async function loadConfig(): Promise<{ fund: FundState | null; channels: ChannelConfig[] }> {
  const { data: fundRow, error: fundErr } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
  if (fundErr) warn(`store: fund_state read failed — ${fundErr.message}`);
  const { data: rows, error } = await sb
    .from("strategists")
    .select("id,slug,name,status,spec_json,underlying,executor,strategist_config(*)");
  if (error) { warn(`store: strategists read failed — ${error.message}`); return { fund: null, channels: [] }; }
  if (!fundRow) warn("store: fund_state id=1 not found (check SUPABASE_URL / service-role key point at the right project)");

  const channels: ChannelConfig[] = [];
  for (const r of (rows ?? []) as any[]) {
    const cfg = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
    if (!cfg) continue;
    channels.push({
      id: r.id,
      slug: r.slug,
      name: String(r.name ?? r.slug),
      status: (r.status ?? "armed") as ChannelConfig["status"],
      spec_json: r.spec_json ?? null,
      underlying: String(r.underlying ?? "SPY").toUpperCase(),
      executor: (r.executor === "stream" ? "stream" : "cron"),
      capital_pct: Number(cfg.capital_pct),
      aggression: Number(cfg.aggression),
      max_contracts: Number(cfg.max_contracts),
      daily_stop_usd: Number(cfg.daily_stop_usd),
      underlying_stop_pct: Number(cfg.underlying_stop_pct ?? 0),
      muted: !!cfg.muted,
      soloed: !!cfg.soloed,
      event_policy: cfg.event_policy === "ignore" ? "ignore" : "standdown",
      entry_dte: Math.max(0, Math.min(1, Number(cfg.entry_dte ?? 0))),
      take_profit_pct: Math.max(0, Number(cfg.take_profit_pct ?? 0)),
      pyramid_adds: Math.max(0, Math.floor(Number(cfg.pyramid_adds ?? 0))),
    });
  }
  const fund: FundState | null = fundRow
    ? {
        total_capital_usd: Number((fundRow as any).total_capital_usd),
        master_daily_stop_usd: Number((fundRow as any).master_daily_stop_usd),
        mode: String((fundRow as any).mode ?? "paper"),
        is_halted: !!(fundRow as any).is_halted,
      }
    : null;
  return { fund, channels };
}

// A closed position's realized P&L (for the shadow-management A/B finalize).
export async function getPositionById(id: string): Promise<{ realized_pnl: number; status: string; close_reason: string | null; closed_at: string | null } | null> {
  const { data } = await sb.from("positions").select("realized_pnl,status,close_reason,closed_at").eq("id", id).maybeSingle();
  return data ? { realized_pnl: Number((data as any).realized_pnl ?? 0), status: String((data as any).status), close_reason: (data as any).close_reason ?? null, closed_at: (data as any).closed_at ?? null } : null;
}

// Ride-to-close reconstruction — PARITY with scripts/day-report.ts reconstructRide (keep
// them in sync): hold from entry to the 15:25 flatten, exiting early only on the −50%
// premium stop. Reads the option_quotes that keep flowing AFTER an early manual close (the
// override insight). null when no quotes cover the window; rideOk=false when an off-chain
// OCC's stream stopped before the flatten (a stale last-mid would fabricate the ride).
export async function reconstructRideToClose(occ: string, entry: number, qty: number, openedAt: string, flattenIso: string): Promise<{ ride: number; rideStop: boolean; rideOk: boolean; rideExitMs: number | null } | null> {
  if (!(entry > 0) || !(qty > 0) || !openedAt) return null;
  const stopLevel = 0.5 * entry;
  const [{ data: stop }, { data: last }] = await Promise.all([
    sb.from("option_quotes").select("mid,captured_at").eq("occ_symbol", occ)
      .gte("captured_at", openedAt).lte("captured_at", flattenIso).lte("mid", stopLevel)
      .order("captured_at", { ascending: true }).limit(1).maybeSingle(),
    sb.from("option_quotes").select("mid,captured_at").eq("occ_symbol", occ)
      .gte("captured_at", openedAt).lte("captured_at", flattenIso)
      .order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!stop && (last as any)?.mid == null) return null;
  const rideStop = !!stop;
  const rideExit = rideStop ? stopLevel : Number((last as any).mid);
  const ride = (rideExit - entry) * qty * 100;
  // staleness reference = the UN-graced flatten (the +30s grace applies only to the query
  // bound) — exact parity with day-report, which splits FLATTEN_MS (reach) vs +30s (bound).
  const flattenMs = Date.parse(flattenIso) - 30_000;
  const reached = rideStop || (last != null && flattenMs - Date.parse((last as any).captured_at) < 6 * 60_000);
  const rideExitMs = rideStop ? Date.parse((stop as any).captured_at) : last ? Date.parse((last as any).captured_at) : null;
  return { ride, rideStop, rideOk: reached, rideExitMs };
}

export async function getOpenPositions(): Promise<PositionRow[]> {
  const { data } = await sb.from("positions").select("*").eq("status", "open");
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    strategist_id: p.strategist_id,
    occ_symbol: p.occ_symbol,
    opt_type: p.opt_type,
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price ?? 0),
    strike: Number(p.strike ?? 0),
    expiration: p.expiration ?? null,
    opened_at: p.opened_at ?? null,
    status: p.status,
  }));
}

// Today's realized P&L for a channel (for the Stop knob gate). closedAfterDate is
// the ET date string; we filter client-side like the cron worker.
export async function realizedTodayByChannel(strategistId: string, etDate: string): Promise<number> {
  const { data } = await sb
    .from("positions")
    .select("realized_pnl,closed_at")
    .eq("strategist_id", strategistId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(100);
  let sum = 0;
  for (const c of (data ?? []) as any[]) {
    if (c.closed_at && etDateOf(Date.parse(c.closed_at)) === etDate) sum += Number(c.realized_pnl ?? 0);
  }
  return sum;
}

// Peak option mid since `since` (for the power giveback trail). Read-only.
export async function peakMidSince(occ: string, since: string): Promise<number> {
  const { data } = await sb
    .from("option_quotes")
    .select("mid")
    .eq("occ_symbol", occ)
    .gte("captured_at", since)
    .order("mid", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number((data as any)?.mid ?? 0);
}

// Realtime KILL-switch / config subscription. Fires onChange on any fund_state /
// strategist_config / strategists mutation so a halt bites in <1s. If the
// realtime publication isn't enabled (06_realtime.sql optional), this no-ops and
// the index.ts poll fallback covers it.
export function subscribeConfig(onChange: () => void): void {
  sb.channel("seve-worker-config")
    .on("postgres_changes", { event: "*", schema: "public", table: "fund_state" }, () => { info("store: fund_state changed (realtime)"); onChange(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "strategist_config" }, () => { info("store: strategist_config changed (realtime)"); onChange(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "strategists" }, () => { info("store: strategists changed (realtime)"); onChange(); })
    .subscribe((status) => { if (status === "SUBSCRIBED") info("store: realtime config subscription active"); });
}

export async function writeShadowEvent(message: string, meta?: unknown): Promise<void> {
  if (!config.hasServiceRole || !config.shadowWriteEvents) return;
  try {
    await sb.from("events").insert({ level: "INFO", message: `stream-shadow: ${message}`, meta: meta ?? null });
  } catch { /* best-effort */ }
}

// ---- Phase B (live executor) writes -----------------------------------------
// All best-effort-logged but NOT swallowed where correctness depends on the
// result (insertPosition returns the error so the caller can journal LOUD —
// the silent-insert-failure → re-buy-loop incident is why).

export async function journal(level: "INFO" | "WARN" | "EXEC", message: string, meta?: unknown): Promise<void> {
  if (!config.hasServiceRole) { info(`journal(${level}): ${message}`); return; }
  try { await sb.from("events").insert({ level, message: `stream: ${message}`, meta: meta ?? null }); }
  catch (e) { warn(`store: journal failed — ${(e as Error).message}`); }
}

/** Heartbeat — the cron's dead-man check (30_executor_cutover.sql). ONLY called
 *  while LIVE: a shadow must never beat, or the cron would defer to a worker
 *  that places no orders. */
export async function heartbeat(note: string): Promise<void> {
  try { await sb.from("worker_heartbeat").upsert({ id: "stream", beat_at: new Date().toISOString(), note }); }
  catch (e) { warn(`store: heartbeat failed — ${(e as Error).message}`); }
}

export async function insertSignal(row: {
  strategist_id: string; signal_type: string; underlying_price: number; direction: string;
  acted_on: boolean; blocked_reason: string | null; rationale: Record<string, unknown>;
}): Promise<void> {
  try { await sb.from("signals").insert(row); }
  catch (e) { warn(`store: signal insert failed — ${(e as Error).message}`); }
}

export async function insertPosition(row: {
  strategist_id: string; occ_symbol: string; underlying: string; expiration: string;
  strike: number; opt_type: "call" | "put"; qty: number; avg_entry_price: number;
}): Promise<string | null> {
  const { error } = await sb.from("positions").insert({
    ...row, current_mark: row.avg_entry_price, unrealized_pnl: 0, status: "open",
  });
  return error ? error.message : null;
}

/** PYRAMID add (Phase B): grow the SINGLE position row to the new weighted-avg entry + summed
 *  qty — NEVER a sibling row (a 2nd row sharing the OCC would mis-net the 06-09 shared-OCC ledger).
 *  The row IS the stack, so exit/booking (realizedToBook fill-net, sell min(held,row.qty)) and
 *  restart reconstruction need NO changes — they already read this row. Returns the error to journal
 *  LOUD on failure (the silent-insert → re-buy-loop incident is why writes that gate correctness do). */
export async function updatePositionStack(id: string, newQty: number, newAvgEntry: number): Promise<string | null> {
  const { error } = await sb.from("positions")
    .update({ qty: newQty, avg_entry_price: newAvgEntry, current_mark: newAvgEntry })
    .eq("id", id);
  return error ? error.message : null;
}

export async function closePositionRow(id: string, mark: number, realized: number, reason?: string): Promise<void> {
  // close_reason (31_close_reason.sql): durable per-row exit attribution — machine
  // reasons here, `manual`/`manual:<tag>` from the close-position API. The journal
  // carries the same info but events expire (30d); this column is the dataset.
  const { error } = await sb.from("positions")
    .update({ status: "closed", closed_at: new Date().toISOString(), current_mark: mark, realized_pnl: realized, close_reason: reason ?? null })
    .eq("id", id);
  if (error) warn(`store: close update failed — ${error.message}`);
}

export async function markPositionRow(id: string, mark: number, unrealized: number): Promise<void> {
  try { await sb.from("positions").update({ current_mark: mark, unrealized_pnl: unrealized }).eq("id", id); }
  catch { /* display-only */ }
}

/** Σ realized already booked on closed rows for (channel, OCC) since sinceIso —
 *  the idempotency half of realizedToBook (cron parity). */
export async function bookedRealizedSince(strategistId: string, occ: string, sinceIso: string): Promise<number> {
  const { data } = await sb.from("positions").select("realized_pnl")
    .eq("strategist_id", strategistId).eq("occ_symbol", occ).eq("status", "closed").gte("closed_at", sinceIso);
  return ((data ?? []) as any[]).reduce((a, r) => a + Number(r.realized_pnl ?? 0), 0);
}

/** Σ open desk-row qty per OCC across ALL channels (the 09d anti-ghost gate input). */
export async function openRowQtyByOcc(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const { data } = await sb.from("positions").select("occ_symbol,qty").eq("status", "open");
  for (const r of (data ?? []) as any[]) {
    m.set(String(r.occ_symbol), (m.get(String(r.occ_symbol)) ?? 0) + Math.abs(Math.round(Number(r.qty ?? 0))));
  }
  return m;
}

export async function insertEquitySnapshot(equity: number, cash: number, unrealized: number): Promise<void> {
  if (!config.writeEquitySnapshots) return;
  try { await sb.from("equity_snapshots").insert({ strategist_id: null, net_liquidation: equity, cash, unrealized_pnl: unrealized }); }
  catch (e) { warn(`store: equity snapshot failed — ${(e as Error).message}`); }
}

// ET date helper (duplicated tiny bit to avoid a cycle with alpaca.ts).
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function etDateOf(ms: number): string { return ET_DATE.format(new Date(ms)); }
