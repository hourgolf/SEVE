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
import { mapOpenPositions } from "./exitGuard.js";
import { pageAll } from "../../engine/pageAll.js";
import { BOOT_ID, STARTED_AT, INSTANCE_ID, GIT_SHA, PID, HOSTNAME, RAILWAY_DEPLOYMENT, getPhase, setPhase, rssMb } from "./runId.js";
import { classifyPriorOpenRun } from "./runReconcile.js";
import type { DurableShadowRow } from "./shadowPersistence.js";
import type { PolicyEpochDraft, PositionPlanDraft } from "./planShadowModel.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import type { PositionOutcomeDraft } from "./positionOutcomeModel.js";
import type { FamilyAdmissionObservationDraft } from "./familyAdmissionModel.js";
import {
  MANAGER_SHADOW_BOOK_VERSION,
  encodeManagerShadowRun,
  type ManagerShadowDbRow,
  type ManagerShadowRun,
} from "./managerShadowBookModel.js";

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
  account_id: string | null;    // cockpit P3: which Alpaca paper account routes this channel's orders (null = default acct 1)
  is_active: boolean;           // false = soft-deleted (07-03 morgue twins) — no entry evaluation, no signal spam; exits still handled
  capital_pct: number;          // two-dial model: RISK $/trade (legacy column name)
  aggression: number;           // retired knob (kept for the legacy read)
  max_contracts: number;
  daily_stop_usd: number;
  daily_target_usd: number;     // A15 win-and-done: halt new entries once realized ≥ this ($/day); 0 = off
  underlying_stop_pct: number;  // 0 = off (config-gated underlying initial stop)
  muted: boolean;
  soloed: boolean;
  boosted: boolean;             // BOOST (54_boost.sql): 2× sizing for the day (replaces SOLO); auto-cleared nightly by cron
  // Per-channel event posture (33_event_policy.sql): 'standdown' (default) =
  // flatten + block entries in a scheduled-event window; 'ignore' = the channel's
  // thesis owns the event (future event-native strategies opt out here).
  event_policy: "standdown" | "ignore";
  // Per-channel entry DTE (34_entry_dte.sql): 0 = today's expiry + cutoff roll
  // (default); 1 = ALWAYS the next session's expiry (pb-ride — its edge IS the
  // 1DTE time value). Same-day flatten unchanged either way.
  entry_dte: number;
  // Per-channel STRIKE OFFSET (moneyness, 46_strike_offset.sql): shift the entry strike off ATM by N
  // dollars (= N strikes) toward OTM — 0 = ATM (default, byte-identical), −1 = one strike ITM (more
  // delta + intrinsic, less theta/giveback; the strike-moneyness finding). Applied identically in
  // decide (the occ) AND execute (the row.strike) so the order and the booked row agree.
  strike_offset: number;
  // Per-channel PREMIUM-STOP override (47_premium_stop_pct.sql): null → policy default (50,
  // byte-identical); 0 → OFF (the channel runs its underlying_stop instead — the ORB stop finding).
  premium_stop_pct: number | null;
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
  // STRAND-4 STALL-EXIT (43_stall_exit.sql, desk-doctrine.md): cut a NON-MOVER held ≥ stall_minutes
  // whose PEAK mark never popped past stall_max_favor_pct above entry → free the one-at-a-time slot.
  // 0 = OFF (default, byte-identical). Applied in the fast-exit sweep (premiumExitReason), lowest
  // priority. Calibrated PATIENT; live field-test = pb-ride (1DTE). NOT for tail channels (V3/ALT/QQQ).
  stall_minutes: number;
  stall_max_favor_pct: number;
  // Per-channel GAP_MIN regime gate (62_gap_min_knob.sql): 0 = OFF (default, byte-identical);
  // >0 = block entries when the worker-computed |overnight gap %| < gap_min. FAIL-CLOSED when the
  // gap is uncomputable (mirrors the spec `gap_min` condition — gap-regime verdict, 5/5-window).
  // Lets BUILTIN channels (breakout base) carry the validated V3/ALT gate without a spec rebuild.
  // DARK as of 2026-07-03 (all channels 0); arming on base = the pre-registered A9 decision at A6.
  gap_min: number;
  // RUNNER (R1, 64_runner_tranche — DARK, both 0): at the take-profit, retain runner_frac of the
  // position as a NEW runner row that rides a peak ratchet (exit when mark ≤ peak×(1−giveback/100)).
  // 0 = all-out LOCK behavior, byte-identical. The A/B twins get configured at the A6 read.
  runner_frac: number;
  runner_giveback_pct: number;
}
export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  mode: string;
  is_halted: boolean;
  // C1 STACK CAP (64_stack_cap.sql, pre-registered): max OPEN desk-wide positions on one
  // underlying+direction before a NEW entry blocks ('stack_cap'). 0 = OFF (dark — arming
  // is the post-A6 decision; the pre-registered value is 4 = block the 5th).
  stack_cap_n: number;
}
// One Alpaca paper account = one hypothesis-bucket (cockpit P3). cred_ref maps to
// config.altAccounts (null/empty = the default ALPACA_KEY/SECRET). is_armed is the
// SHADOW-FIRST gate: a non-armed account is fully decided + logged but places NO
// orders, exactly like the global two-key turn — flip it true after one clean
// shadow cycle proves routing. is_halted = a per-bucket kill switch.
export interface AccountRow {
  id: string;
  name: string;
  cred_ref: string | null;
  is_armed: boolean;
  is_halted: boolean;
  master_daily_stop_usd: number;
}
export interface PositionRow {
  id: string;
  strategist_id: string;
  occ_symbol: string;
  underlying: string;
  opt_type: "call" | "put";
  qty: number;
  avg_entry_price: number;
  strike: number;
  expiration: string | null;
  opened_at: string | null;
  status: string;
  peak_mark: number | null; // durable MFE source — the running MAX option mark over the hold (44_trade_forensics)
  trough_mark: number | null; // durable MAE twin — the running MIN option mark over the hold (58_trough_mark; stop-calibration instrumentation)
  runner_of: string | null; // R1 (64_runner_tranche): parent row id when this row is a runner remainder — rides, never re-tranches
  entry_features?: Record<string, unknown> | null;
}

const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as WSTransport },
});

export async function loadConfig(): Promise<{ fund: FundState | null; channels: ChannelConfig[]; accounts: AccountRow[]; accountsFresh: boolean }> {
  const { data: fundRow, error: fundErr } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
  if (fundErr) warn(`store: fund_state read failed — ${fundErr.message}`);
  const { data: rows, error } = await sb
    .from("strategists")
    .select("id,slug,name,status,spec_json,underlying,executor,account_id,is_active,strategist_config(*)");
  if (error) { warn(`store: strategists read failed — ${error.message}`); return { fund: null, channels: [], accounts: [], accountsFresh: false }; }
  if (!fundRow) warn("store: fund_state id=1 not found (check SUPABASE_URL / service-role key point at the right project)");
  // Accounts (cockpit P3) — optional; a project without the table just runs single-account.
  // ⚠ Distinguish MISSING TABLE (genuine single-account project → accounts=[] is correct)
  // from a TRANSIENT read failure (audit 2026-07-10, critical): conflating them replaced a
  // good routing table with [] — every channel regrouped onto the DEFAULT account (wrong-
  // account live orders) while the real acct-2/3 lots rode unmanaged and their rows got
  // phantom-reconcile-closed. accountsFresh=false → reloadConfig keeps the prior table.
  const { data: acctRows, error: acctErr } = await sb
    .from("accounts")
    .select("id,name,cred_ref,is_armed,is_halted,master_daily_stop_usd");
  const acctMissingTable = !!acctErr && (acctErr.code === "42P01" || /does not exist|could not find the table|schema cache/i.test(acctErr.message ?? ""));
  if (acctErr) warn(`store: accounts read failed — ${acctErr.message}${acctMissingTable ? "; single-account fallback" : "; STALE (transient) — caller keeps prior routing"}`);

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
      account_id: r.account_id ?? null,
      is_active: r.is_active !== false, // null/undefined (legacy) → active

      capital_pct: Number(cfg.capital_pct),
      aggression: Number(cfg.aggression),
      max_contracts: Number(cfg.max_contracts),
      daily_stop_usd: Number(cfg.daily_stop_usd),
      daily_target_usd: Number(cfg.daily_target_usd ?? 0),
      underlying_stop_pct: Number(cfg.underlying_stop_pct ?? 0),
      muted: !!cfg.muted,
      soloed: !!cfg.soloed,
      boosted: !!cfg.boosted,
      event_policy: cfg.event_policy === "ignore" ? "ignore" : "standdown",
      entry_dte: Math.max(0, Math.min(1, Number(cfg.entry_dte ?? 0))),
      strike_offset: Math.round(Number(cfg.strike_offset ?? 0)),
      premium_stop_pct: cfg.premium_stop_pct == null ? null : Number(cfg.premium_stop_pct),
      take_profit_pct: Math.max(0, Number(cfg.take_profit_pct ?? 0)),
      pyramid_adds: Math.max(0, Math.floor(Number(cfg.pyramid_adds ?? 0))),
      stall_minutes: Math.max(0, Math.floor(Number(cfg.stall_minutes ?? 0))),
      stall_max_favor_pct: Math.max(0, Number(cfg.stall_max_favor_pct ?? 0)),
      gap_min: Math.max(0, Number(cfg.gap_min ?? 0)),
      runner_frac: Math.min(0.9, Math.max(0, Number(cfg.runner_frac ?? 0))),
      runner_giveback_pct: Math.max(0, Number(cfg.runner_giveback_pct ?? 0)),
    });
  }
  const fund: FundState | null = fundRow
    ? {
        total_capital_usd: Number((fundRow as any).total_capital_usd),
        master_daily_stop_usd: Number((fundRow as any).master_daily_stop_usd),
        mode: String((fundRow as any).mode ?? "paper"),
        is_halted: !!(fundRow as any).is_halted,
        stack_cap_n: Math.max(0, Math.floor(Number((fundRow as any).stack_cap_n ?? 0))),
      }
    : null;
  const accounts: AccountRow[] = ((acctRows ?? []) as any[]).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? a.id),
    cred_ref: a.cred_ref ?? null,
    is_armed: !!a.is_armed,
    is_halted: !!a.is_halted,
    master_daily_stop_usd: Number(a.master_daily_stop_usd ?? 0),
  }));
  return { fund, channels, accounts, accountsFresh: !acctErr || acctMissingTable };
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

// ⚠ THROWS on a read error (audit 2026-07-11, 1b #5): the old `const { data }` swallowed a
// Supabase failure into [] and the worker believed itself FLAT — executeEntry's lost-insert
// recovery inserted a DUPLICATE row, the orphan sweep read every held lot as uncovered (the
// mass-flatten class under ORPHAN_FLATTEN), and the fast sweep exited nothing. Both callers
// catch safely: cycle() skips the whole pass BEFORE any decide/execute (never act on
// fabricated flat state — exits are keyed off these rows, so there is nothing to "fail toward
// exit" with), and fastExitSweep logs + retries ~10s later. Mapping + the throw are pure in
// exitGuard.mapOpenPositions (selftest-covered, the realizedTodayByChannel pattern).
export async function getOpenPositions(): Promise<PositionRow[]> {
  const { data, error } = await sb.from("positions").select("*").eq("status", "open");
  if (error) {
    warn(`store: open-positions read failed — ${error.message}; caller skips this pass (row state unknown)`);
    void journal("WARN", `open-positions read FAILED — ${error.message}; cycle/sweep skipped (never act on a fabricated flat book)`);
  }
  return mapOpenPositions({ data: data as unknown[] | null, error });
}

/** Durable MFE: persist the running peak option mark (the fast-exit sweep ratchets it).
 *  The in-memory peak is already monotonic, so a direct write is correct. Display-only. */
export async function markPeak(id: string, peak: number): Promise<void> {
  // peak_at (61_peak_trough_at): NEW-high-only writes ⇒ the last write's timestamp IS the
  // time of the running max (~10s granularity) → time-to-MFE is one query, no archive replay.
  try { await sb.from("positions").update({ peak_mark: peak, peak_at: new Date().toISOString() }).eq("id", id); }
  catch { /* forensics only — never block the trade path */ }
}

/** Durable MAE twin (58_trough_mark): persist the running MIN option mark (the fast-exit sweep
 *  ratchets it, NEW-low-only). Stop-calibration instrumentation — display/analysis only. */
export async function markTrough(id: string, trough: number): Promise<void> {
  try { await sb.from("positions").update({ trough_mark: trough, trough_at: new Date().toISOString() }).eq("id", id); }
  catch { /* forensics only — never block the trade path */ }
}

// Today's realized P&L for a channel (for the Stop knob gate). closedAfterDate is
// the ET date string; we filter client-side like the cron worker.
// ⚠ THROWS on a read error (audit 2026-07-10): swallowing it returned 0, which read as "no
// realized P&L today" and let BOTH the daily_stop loss floor and the daily_target win-and-done
// fail OPEN during a transient DB fault. The caller (decide.ts) fails CLOSED on the throw.
export async function realizedTodayByChannel(strategistId: string, etDate: string): Promise<number> {
  // Server-side date floor + a wide cap (audit L2): the old newest-100 window under-counted a
  // churny channel's realized past 100 closes/day → the daily-stop latched LATE. 00:00Z on the
  // ET date = the prior evening ET — a safe superset; the client-side ET filter below is exact.
  // pageAll (audit 2026-07-11, 1b #11): a churny channel can close >1000 rows/day; .limit(1000)
  // silently capped at PostgREST's max and UNDER-counted the day's realized → the daily-stop /
  // win-and-done latch read a too-small loss/gain and fired LATE (or never). pageAll fetches every
  // page or THROWS on a page error — preserving the 10b fail-closed contract (the caller's try/catch
  // in decide.ts blocks the entry on the throw). id tiebreak: closed_at is not a total order.
  const data = await pageAll<{ realized_pnl: number | null; closed_at: string | null }>((from) => sb
    .from("positions")
    .select("realized_pnl,closed_at,id")
    .eq("strategist_id", strategistId)
    .eq("status", "closed")
    .gte("closed_at", `${etDate}T00:00:00Z`)
    .order("closed_at", { ascending: false })
    .order("id", { ascending: true }));
  let sum = 0;
  for (const c of data) {
    if (c.closed_at && etDateOf(Date.parse(c.closed_at)) === etDate) sum += Number(c.realized_pnl ?? 0);
  }
  return sum;
}

// Peak option BID since `since` (for the power/A13 giveback trail). Read-only.
// audit 2026-07-11 (1b #6): reads the BID column (was mid) — the trail arms and gives back on
// REALIZABLE prices, one basis with decide.ts's bid mark and the sweep's bid-based peak ratchet
// (a mid-history peak against a bid mark would arm high and trip the giveback line early).
// nullsFirst:false so a null-bid capture row can't shadow the real max under `.desc`.
// ⚠ Returns NULL on a read error (audit 2026-07-11, 1b #5 secondary): the old swallowed →0
// read as "peak never engaged" and silently UNDER-ARMED the giveback trail through a DB
// fault. The caller (decide.ts) skips the trail evaluation that cycle with a warn — it must
// NOT throw, or decideChannel's catch would drop the channel's OTHER exits with it.
export async function peakBidSince(occ: string, since: string): Promise<number | null> {
  const { data, error } = await sb
    .from("option_quotes")
    .select("bid")
    .eq("occ_symbol", occ)
    .gte("captured_at", since)
    .order("bid", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) { warn(`store: peakBidSince ${occ} read failed — ${error.message}`); return null; }
  return Number((data as any)?.bid ?? 0);
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
    .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, () => { info("store: accounts changed (realtime)"); onChange(); })
    .subscribe((status) => { if (status === "SUBSCRIBED") info("store: realtime config subscription active"); });
}

export async function writeShadowEvent(message: string, meta?: unknown): Promise<void> {
  if (!config.hasServiceRole || !config.shadowWriteEvents) return;
  try {
    await sb.from("events").insert({ level: "INFO", message: `stream-shadow: ${message}`, meta: meta ?? null });
  } catch { /* best-effort */ }
}

// ---- Restart-safe management counterfactual state --------------------------
// Feature-detected so a worker built before Phase 1B stays byte-identical:
// a missing table disables persistence once per boot without log spam or impact
// to the in-memory shadow simulation.
let shadowStateAvailable: boolean | null = null;
const missingRelation = (e: { code?: string; message?: string } | null): boolean =>
  !!e && (e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? ""));

export async function loadShadowManagementStates(): Promise<DurableShadowRow[]> {
  if (!config.hasServiceRole || shadowStateAvailable === false) return [];
  const { data, error } = await sb.from("shadow_management_state").select("position_id,slug,occ_symbol,underlying,managed_state,managed_pnl,managed_closed,last_reason,actual_pnl,truncated,source_boot_id");
  if (error) {
    if (missingRelation(error)) shadowStateAvailable = false;
    else warn(`store: shadow state load failed — ${error.message}`);
    return [];
  }
  shadowStateAvailable = true;
  return (data ?? []) as DurableShadowRow[];
}

export async function saveShadowManagementState(row: DurableShadowRow): Promise<void> {
  if (!config.hasServiceRole || shadowStateAvailable === false) return;
  const { error } = await sb.from("shadow_management_state").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "position_id" });
  if (!error) { shadowStateAvailable = true; return; }
  if (missingRelation(error)) shadowStateAvailable = false;
  else warn(`store: shadow state save failed — ${error.message}`);
}

export async function deleteShadowManagementState(positionId: string): Promise<void> {
  if (!config.hasServiceRole || shadowStateAvailable === false) return;
  const { error } = await sb.from("shadow_management_state").delete().eq("position_id", positionId);
  if (!error) { shadowStateAvailable = true; return; }
  if (missingRelation(error)) shadowStateAvailable = false;
  else warn(`store: shadow state delete failed — ${error.message}`);
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
  const ph = note.split(" ").pop(); if (ph) setPhase(ph);   // "cycle" | "sweep" | "pre-open"
  void runHeartbeat();                                       // freshen the run row alongside the dead-man beat
  try { await sb.from("worker_heartbeat").upsert({ id: "stream", beat_at: new Date().toISOString(), note }); }
  catch (e) { warn(`store: heartbeat failed — ${(e as Error).message}`); }
}

// ---- worker_runs: per-boot lifecycle for crash attribution (external-review P4) -------------
// ALL fail-open — instrumentation must NEVER crash the worker it diagnoses. Each write no-ops
// gracefully if 67_worker_runs.sql isn't applied yet (the catch swallows the missing-table error).
// A process killed by OOM/SIGKILL can't record its own exit, so the successor reconciles stale
// predecessors. Distinct Railway deployments near the successor boot are `superseded_deploy`;
// same-deployment/old gaps remain abrupt. Anon/local skips this live-worker ledger.
export async function openRun(version: string): Promise<void> {
  if (!config.hasServiceRole) return;
  try {
    await sb.from("worker_runs").insert({
      boot_id: BOOT_ID, instance_id: INSTANCE_ID, version, git_sha: GIT_SHA,
      pid: PID, hostname: HOSTNAME, railway_deployment: RAILWAY_DEPLOYMENT,
      started_at: STARTED_AT, last_heartbeat_at: STARTED_AT,
      last_phase: getPhase(), memory_rss_mb: rssMb(),
    });
    await reconcilePriorRuns();
  } catch (e) { warn(`store: openRun failed — ${(e as Error).message}`); }
}

async function reconcilePriorRuns(): Promise<void> {
  const { data, error } = await sb.from("worker_runs")
    .select("boot_id,railway_deployment,last_heartbeat_at")
    .is("ended_at", null).neq("boot_id", BOOT_ID);
  if (error) return;
  const nowMs = Date.now();
  for (const row of (data ?? []) as Array<{ boot_id: string; railway_deployment: string | null; last_heartbeat_at: string | null }>) {
    const termination = classifyPriorOpenRun({
      bootId: row.boot_id,
      railwayDeployment: row.railway_deployment,
      lastHeartbeatAt: row.last_heartbeat_at,
    }, {
      bootId: BOOT_ID,
      railwayDeployment: RAILWAY_DEPLOYMENT,
      startedAt: STARTED_AT,
    }, nowMs);
    if (!termination) continue;
    await sb.from("worker_runs").update({
      ended_at: row.last_heartbeat_at ?? new Date(nowMs).toISOString(),
      termination_kind: termination,
      superseded_by_boot_id: termination === "superseded_deploy" ? BOOT_ID : null,
      classified_at: new Date(nowMs).toISOString(),
    }).eq("boot_id", row.boot_id).is("ended_at", null);
  }
}

export async function runHeartbeat(): Promise<void> {
  if (!config.hasServiceRole) return;
  try {
    await sb.from("worker_runs")
      .update({ last_heartbeat_at: new Date().toISOString(), last_phase: getPhase(), memory_rss_mb: rssMb() })
      .eq("boot_id", BOOT_ID);
    await reconcilePriorRuns();
  } catch { /* fail-open — telemetry only */ }
}

// Best-effort epitaph for the paths a handler CAN catch (graceful SIGTERM, uncaughtException,
// fatal boot). Bounded by the caller so shutdown never hangs; if it doesn't land, the next boot's
// openRun still marks this run abrupt — so this only UPGRADES attribution, never gates it.
export async function closeRun(kind: string, exitCode: number | null, signal: string | null, err?: unknown): Promise<void> {
  if (!config.hasServiceRole) return;
  setPhase("shutdown");
  try {
    await sb.from("worker_runs").update({
      shutdown_started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      termination_kind: kind, exit_code: exitCode, signal, last_phase: getPhase(),
      last_error: err ? String(err instanceof Error ? (err.stack ?? err.message) : err).slice(0, 800) : null,
    }).eq("boot_id", BOOT_ID);
  } catch { /* fail-open */ }
}

export async function insertSignal(row: {
  strategist_id: string; signal_type: string; underlying_price: number; direction: string;
  acted_on: boolean; blocked_reason: string | null; rationale: Record<string, unknown>;
}): Promise<void> {
  try { await sb.from("signals").insert(row); }
  catch (e) { warn(`store: signal insert failed — ${(e as Error).message}`); }
}

let planTablesAvailable: boolean | null = null;
const duplicate = (error: { code?: string } | null): boolean => error?.code === "23505";

/** Phase 1C immutable epoch insert. A deterministic id makes retries and
 *  restarts idempotent; duplicate means the exact epoch is already durable. */
export async function insertObservedPolicyEpoch(row: PolicyEpochDraft): Promise<boolean> {
  if (!config.hasServiceRole || planTablesAvailable === false) return false;
  const { error } = await sb.from("policy_epochs").insert({ ...row, created_by_boot_id: BOOT_ID });
  if (!error || duplicate(error)) { planTablesAvailable = true; return true; }
  if (missingRelation(error)) planTablesAvailable = false;
  else warn(`store: policy epoch insert failed — ${error.message}`);
  return false;
}

/** Phase 1C observed initial-allocation plan. It is mode=observe and remains
 *  unreferenced by execution; opportunity_id makes retries idempotent. */
export async function insertObservedPositionPlan(row: PositionPlanDraft): Promise<boolean> {
  if (!config.hasServiceRole || planTablesAvailable === false) return false;
  const { error } = await sb.from("position_plans").insert({ ...row, position_id: null });
  if (!error || duplicate(error)) { planTablesAvailable = true; return true; }
  if (missingRelation(error)) planTablesAvailable = false;
  else warn(`store: position plan insert failed — ${error.message}`);
  return false;
}

let executionObservationTableAvailable: boolean | null = null;

/** Phase 1D append-only market/decision/order/fill evidence. Deterministic ids
 *  make retries idempotent. No execution path awaits this function. */
export async function insertExecutionObservation(row: ExecutionObservationDraft): Promise<boolean> {
  if (!config.hasServiceRole || executionObservationTableAvailable === false) return false;
  try {
    const { error } = await sb.from("execution_observations").insert({ ...row, source_boot_id: BOOT_ID });
    if (!error || duplicate(error)) { executionObservationTableAvailable = true; return true; }
    if (missingRelation(error)) executionObservationTableAvailable = false;
    else warn(`store: execution observation insert failed — ${error.message}`);
  } catch (e) {
    warn(`store: execution observation rejected — ${(e as Error).message}`);
  }
  return false;
}

let familyAdmissionTableAvailable: boolean | null = null;

/** Phase 1I append-only family collision evidence. Best effort and never
 * awaited by the order path; a missing table can only lose dark evidence. */
export async function insertFamilyAdmissionObservation(row: FamilyAdmissionObservationDraft): Promise<boolean> {
  if (!config.hasServiceRole || familyAdmissionTableAvailable === false) return false;
  try {
    const { error } = await sb.from("family_admission_observations").insert({ ...row, source_boot_id: BOOT_ID });
    if (!error || duplicate(error)) { familyAdmissionTableAvailable = true; return true; }
    if (missingRelation(error)) familyAdmissionTableAvailable = false;
    else warn(`store: family admission observation insert failed — ${error.message}`);
  } catch (e) {
    warn(`store: family admission observation rejected — ${(e as Error).message}`);
  }
  return false;
}

// ---- Phase 1G-B durable portable-manager shadow book ----------------------
// This adapter is backend-only research persistence. It is never imported by
// execute.ts and none of its failures can alter an order or desk position row.
let managerShadowTableAvailable: boolean | null = null;

export async function loadManagerShadowRows(): Promise<ManagerShadowDbRow[] | null> {
  if (!config.hasServiceRole || managerShadowTableAvailable === false) return null;
  // Load retained terminals/censors too so an open actual position cannot
  // re-enroll a manager that already reached its deterministic first terminal.
  const { data, error } = await sb.from("manager_shadow_runs").select("*")
    .eq("shadow_book_version", MANAGER_SHADOW_BOOK_VERSION);
  if (!error) { managerShadowTableAvailable = true; return (data ?? []) as ManagerShadowDbRow[]; }
  if (missingRelation(error)) managerShadowTableAvailable = false;
  else warn(`store: manager shadow hydration failed — ${error.message}`);
  return null;
}

export async function insertManagerShadowRuns(runs: readonly ManagerShadowRun[]): Promise<boolean> {
  if (!config.hasServiceRole || managerShadowTableAvailable === false || !runs.length) return false;
  const rows = runs.map((run) => encodeManagerShadowRun(run, { sourceBootId: BOOT_ID }));
  if (rows.some((row) => row == null)) return false;
  const { error } = await sb.from("manager_shadow_runs")
    .upsert(rows as ManagerShadowDbRow[], { onConflict: "id", ignoreDuplicates: true });
  if (!error) { managerShadowTableAvailable = true; return true; }
  if (missingRelation(error)) managerShadowTableAvailable = false;
  else warn(`store: manager shadow enrollment failed — ${error.message}`);
  return false;
}

/** Optimistic active→active/terminal/censored update. The active predicate is
 *  the first-terminal-wins guard; a stale retry cannot rewrite a terminal. */
export async function saveManagerShadowRun(
  run: ManagerShadowRun,
  sourceBootId: string,
): Promise<boolean> {
  if (!config.hasServiceRole || managerShadowTableAvailable === false) return false;
  const row = encodeManagerShadowRun(run, {
    sourceBootId,
    terminalBootId: run.status === "terminal" ? BOOT_ID : null,
  });
  if (!row) return false;
  const { id, ...payload } = row;
  const { data, error } = await sb.from("manager_shadow_runs")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "active").select("id").maybeSingle();
  if (!error) { managerShadowTableAvailable = true; return !!data; }
  if (missingRelation(error)) managerShadowTableAvailable = false;
  else warn(`store: manager shadow state save failed — ${error.message}`);
  return false;
}

export interface ManagerShadowActualPosition {
  id: string;
  status: string;
  closed_at: string | null;
  close_reason: string | null;
  realized_pnl: number;
}

export async function loadManagerShadowActualPositions(ids: readonly string[]): Promise<ManagerShadowActualPosition[] | null> {
  if (!ids.length) return [];
  const out: ManagerShadowActualPosition[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("positions")
      .select("id,status,closed_at,close_reason,realized_pnl")
      .in("id", ids.slice(i, i + 100));
    if (error) { warn(`store: manager shadow actual-close read failed — ${error.message}`); return null; }
    for (const row of data ?? []) out.push({
      id: String((row as any).id), status: String((row as any).status),
      closed_at: (row as any).closed_at ?? null, close_reason: (row as any).close_reason ?? null,
      realized_pnl: Number((row as any).realized_pnl ?? 0),
    });
  }
  return out;
}

let positionOutcomeTableAvailable: boolean | null = null;

/** Phase 1E append-only lineage/booking evidence. Never awaited by execution. */
export async function insertPositionOutcome(row: PositionOutcomeDraft): Promise<boolean> {
  if (!config.hasServiceRole || positionOutcomeTableAvailable === false) return false;
  try {
    const { error } = await sb.from("position_outcome_events").insert({ ...row, source_boot_id: BOOT_ID });
    if (!error || duplicate(error)) { positionOutcomeTableAvailable = true; return true; }
    if (missingRelation(error)) positionOutcomeTableAvailable = false;
    else warn(`store: position outcome insert failed — ${error.message}`);
  } catch (e) {
    warn(`store: position outcome rejected — ${(e as Error).message}`);
  }
  return false;
}

export interface PositionInsertResult { id: string | null; error: string | null }

export async function insertPosition(row: {
  strategist_id: string; occ_symbol: string; underlying: string; expiration: string;
  strike: number; opt_type: "call" | "put"; qty: number; avg_entry_price: number;
  // durable per-trade forensics (44_trade_forensics) — the entry side of the dataset.
  entry_reason?: string; entry_features?: Record<string, unknown> | null; entry_delta?: number | null;
}): Promise<PositionInsertResult> {
  const { entry_reason, entry_features, entry_delta, ...core } = row;
  const { data, error } = await sb.from("positions").insert({
    ...core, current_mark: core.avg_entry_price, unrealized_pnl: 0, status: "open",
    peak_mark: core.avg_entry_price, // MFE ratchet starts at entry
    trough_mark: core.avg_entry_price, // MAE ratchet starts at entry (58_trough_mark)
    peak_at: new Date().toISOString(), trough_at: new Date().toISOString(), // extremes = entry at t0 (61)
    entry_reason: entry_reason ?? null, entry_features: entry_features ?? null, entry_delta: entry_delta ?? null,
  }).select("id").single();
  return { id: data?.id ?? null, error: error ? error.message : null };
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

/** Partial-qty close (R1 runner tranche + 1b #2 partial exits): close the parent on the
 *  SOLD qty — the remainder becomes its own row via insertRunnerRow / insertPartialRemainderRow.
 *  Status-guarded like closePositionRow (books at most once); qty is rewritten to the sold
 *  share so the closed row's realized and qty agree (the parent+remainder pair sums to the
 *  original share exactly). closeReason: 'target_tranche' (the R1 default) or 'partial_exit'
 *  (audit 2026-07-11, 1b #2 — a partial sell fill no longer closes the whole row). */
export async function trancheClosePositionRow(id: string, soldQty: number, mark: number, realized: number, closeReason: string = "target_tranche"): Promise<boolean> {
  const { data, error } = await sb.from("positions")
    .update({ status: "closed", closed_at: new Date().toISOString(), qty: soldQty, current_mark: mark, realized_pnl: realized, close_reason: closeReason })
    .eq("id", id).eq("status", "open").select("id");
  if (error) { warn(`store: tranche close failed — ${error.message}`); return false; }
  return (data ?? []).length > 0;
}

/** RUNNER remainder row (R1): a NEW open row continuing the parent's contract — same
 *  entry basis + opened_at (hold-clock/stall/EOD semantics preserved), carried peak/
 *  trough marks (the ratchet anchors on the true MFE), runner_of = parent id. Returns
 *  the insert error message (null = ok) so the caller journals LOUD on failure — an
 *  uncovered remainder is the orphan-sweep's job to catch. */
export async function insertRunnerRow(parent: PositionRow, remainQty: number, mark: number): Promise<PositionInsertResult> {
  return insertRemainderRow(parent, remainQty, mark, { runnerOf: parent.id, entryReason: "runner_tranche" });
}

/** PARTIAL-EXIT remainder row (audit 2026-07-11, 1b #2): a partial sell fill closes the
 *  parent on the SOLD qty only; the unsold contracts re-row HERE so they stay a managed
 *  position (the old whole-row close left them row-less — only the orphan sweep caught
 *  them, late). UNLIKE a runner, runner_of stays NULL: the remainder keeps NORMAL
 *  take-profit/stop semantics, not ride mode. The fresh row id gives it a fresh
 *  deterministic exit coid (x<rowid8>), so the next sweep re-fires its exit cleanly. */
export async function insertPartialRemainderRow(parent: PositionRow, remainQty: number, mark: number): Promise<PositionInsertResult> {
  return insertRemainderRow(parent, remainQty, mark, { runnerOf: null, entryReason: "partial_exit_remainder" });
}

async function insertRemainderRow(parent: PositionRow, remainQty: number, mark: number, o: { runnerOf: string | null; entryReason: string }): Promise<PositionInsertResult> {
  const { data, error } = await sb.from("positions").insert({
    strategist_id: parent.strategist_id, occ_symbol: parent.occ_symbol,
    underlying: parent.underlying || parent.occ_symbol.slice(0, parent.occ_symbol.length - 15),
    expiration: parent.expiration ?? new Date().toISOString().slice(0, 10),
    strike: parent.strike, opt_type: parent.opt_type, qty: remainQty,
    avg_entry_price: parent.avg_entry_price, current_mark: mark, unrealized_pnl: 0, status: "open",
    opened_at: parent.opened_at ?? new Date().toISOString(),
    // Peak floor = the exit fill (review hardening): the parent's DB peak_mark can be a
    // sweep stale (markPeak is fire-and-forget; the in-memory row never updates), and a runner
    // whose peak ≤ entry NEVER arms its ratchet. The tranche filled at/near the TP level, so
    // flooring on it guarantees the ratchet is armed above water from birth. For a 1b #2
    // partial-exit remainder the fill is a real traded price too (a stop fill sits below the
    // parent peak, so max() just carries the parent's honest MFE).
    peak_mark: Math.max(parent.peak_mark ?? parent.avg_entry_price, mark), trough_mark: parent.trough_mark ?? parent.avg_entry_price,
    peak_at: new Date().toISOString(), trough_at: new Date().toISOString(),
    entry_reason: o.entryReason, entry_features: parent.entry_features ?? null, runner_of: o.runnerOf,
  }).select("id").single();
  return { id: data?.id ?? null, error: error ? error.message : null };
}

export async function closePositionRow(id: string, mark: number, realized: number, reason?: string): Promise<boolean> {
  // close_reason (31_close_reason.sql): durable per-row exit attribution — machine
  // reasons here, `manual`/`manual:<tag>` from the close-position API. The journal
  // carries the same info but events expire (30d); this column is the dataset.
  // STATUS-GUARDED (review 2026-06-24): .eq('status','open') makes the close book AT MOST ONCE — a row
  // already closed by another path (manual route, a raced cycle) is a no-op → returns false, so the
  // caller skips re-journaling a phantom second booking. Mirrors the manual close-position route.
  const { data, error } = await sb.from("positions")
    .update({ status: "closed", closed_at: new Date().toISOString(), current_mark: mark, realized_pnl: realized, close_reason: reason ?? null })
    .eq("id", id).eq("status", "open").select("id");
  if (error) { warn(`store: close update failed — ${error.message}`); return false; }
  return Array.isArray(data) && data.length > 0;
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

// ---- Forward-data durability backstop (Supabase Storage) --------------------
// The Railway worker (always-on, service-role) uploads each COMPLETE day's option_quotes
// here post-close so the irreplaceable tape survives the operator's Mac being off/dead past
// the 7d DB prune. Files are gz per ET day under quotes/<date>.json.gz, FORMAT-IDENTICAL to
// the local export-quotes archive (a verbatim array of rows) so they're interchangeable.
const FORWARD_BUCKET = "forward-data";

/** ET dates already archived to Storage (so we skip complete days; restart-safe). */
export async function listArchivedQuoteDays(): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await sb.storage.from(FORWARD_BUCKET).list("quotes", { limit: 2000 });
  if (error) { warn(`store: storage list failed — ${error.message}`); return out; }
  for (const o of data ?? []) { const m = o.name.match(/^(\d{4}-\d{2}-\d{2})\.json\.gz$/); if (m) out.add(m[1]); }
  return out;
}

/** Verbatim option_quotes rows for one UTC/ET calendar day (RTH option quotes ⇒ UTC date ==
 *  ET date), keyset-paginated on the pkey (OFFSET dies on this table). One day ≈ ~85k rows. */
export async function fetchQuotesForDay(etDate: string): Promise<unknown[]> {
  const startISO = `${etDate}T00:00:00Z`;
  const end = new Date(Date.parse(startISO) + 86_400_000).toISOString();
  const rows: Array<{ id: string | number }> = [];
  let lastId: string | number | null = null;
  for (;;) {
    let q = sb.from("option_quotes").select("*").gte("captured_at", startISO).lt("captured_at", end).order("id", { ascending: true }).limit(1000);
    if (lastId != null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`option_quotes[${etDate}]: ${error.message}`);
    const batch = (data ?? []) as Array<{ id: string | number }>;
    rows.push(...batch);
    if (batch.length < 1000) break;
    lastId = batch[batch.length - 1].id;
  }
  return rows;
}

/** Upload a gzipped day archive (upsert = idempotent / re-do a partial). Returns the error msg. */
export async function uploadQuotesArchive(etDate: string, gz: Uint8Array): Promise<string | null> {
  const { error } = await sb.storage.from(FORWARD_BUCKET).upload(`quotes/${etDate}.json.gz`, gz, {
    contentType: "application/gzip", upsert: true,
  });
  return error ? error.message : null;
}

export async function insertEquitySnapshot(equity: number, cash: number, unrealized: number, accountId: string | null = null): Promise<void> {
  // The desk-TOTAL row (account_id NULL) conflicts with the cron's snapshot writer (it also writes
  // strategist_id/account_id NULL), so it stays gated behind WRITE_EQUITY_SNAPSHOTS — flip that at
  // full cron cutover. PER-ACCOUNT rows (account_id set) are conflict-free NEW data → always write,
  // so each bucket's forward NAV (cockpit P3) is captured now without touching the cron.
  if (accountId == null && !config.writeEquitySnapshots) return;
  try { await sb.from("equity_snapshots").insert({ strategist_id: null, account_id: accountId, net_liquidation: equity, cash, unrealized_pnl: unrealized }); }
  catch (e) { warn(`store: equity snapshot failed — ${(e as Error).message}`); }
}

// ET date helper (duplicated tiny bit to avoid a cycle with alpaca.ts).
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function etDateOf(ms: number): string { return ET_DATE.format(new Date(ms)); }
