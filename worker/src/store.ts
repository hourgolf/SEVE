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
  account_id: string | null;    // cockpit P3: which Alpaca paper account routes this channel's orders (null = default acct 1)
  capital_pct: number;          // two-dial model: RISK $/trade (legacy column name)
  aggression: number;           // retired knob (kept for the legacy read)
  max_contracts: number;
  daily_stop_usd: number;
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
}
export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  mode: string;
  is_halted: boolean;
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
  opt_type: "call" | "put";
  qty: number;
  avg_entry_price: number;
  strike: number;
  expiration: string | null;
  opened_at: string | null;
  status: string;
  peak_mark: number | null; // durable MFE source — the running MAX option mark over the hold (44_trade_forensics)
  trough_mark: number | null; // durable MAE twin — the running MIN option mark over the hold (58_trough_mark; stop-calibration instrumentation)
}

const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as WSTransport },
});

export async function loadConfig(): Promise<{ fund: FundState | null; channels: ChannelConfig[]; accounts: AccountRow[] }> {
  const { data: fundRow, error: fundErr } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
  if (fundErr) warn(`store: fund_state read failed — ${fundErr.message}`);
  const { data: rows, error } = await sb
    .from("strategists")
    .select("id,slug,name,status,spec_json,underlying,executor,account_id,strategist_config(*)");
  if (error) { warn(`store: strategists read failed — ${error.message}`); return { fund: null, channels: [], accounts: [] }; }
  if (!fundRow) warn("store: fund_state id=1 not found (check SUPABASE_URL / service-role key point at the right project)");
  // Accounts (cockpit P3) — optional; a project without the table just runs single-account.
  const { data: acctRows, error: acctErr } = await sb
    .from("accounts")
    .select("id,name,cred_ref,is_armed,is_halted,master_daily_stop_usd");
  if (acctErr) warn(`store: accounts read failed — ${acctErr.message}; single-account fallback`);

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
      capital_pct: Number(cfg.capital_pct),
      aggression: Number(cfg.aggression),
      max_contracts: Number(cfg.max_contracts),
      daily_stop_usd: Number(cfg.daily_stop_usd),
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
  const accounts: AccountRow[] = ((acctRows ?? []) as any[]).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? a.id),
    cred_ref: a.cred_ref ?? null,
    is_armed: !!a.is_armed,
    is_halted: !!a.is_halted,
    master_daily_stop_usd: Number(a.master_daily_stop_usd ?? 0),
  }));
  return { fund, channels, accounts };
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
    peak_mark: p.peak_mark != null ? Number(p.peak_mark) : null,
    trough_mark: p.trough_mark != null ? Number(p.trough_mark) : null,
  }));
}

/** Durable MFE: persist the running peak option mark (the fast-exit sweep ratchets it).
 *  The in-memory peak is already monotonic, so a direct write is correct. Display-only. */
export async function markPeak(id: string, peak: number): Promise<void> {
  try { await sb.from("positions").update({ peak_mark: peak }).eq("id", id); }
  catch { /* forensics only — never block the trade path */ }
}

/** Durable MAE twin (58_trough_mark): persist the running MIN option mark (the fast-exit sweep
 *  ratchets it, NEW-low-only). Stop-calibration instrumentation — display/analysis only. */
export async function markTrough(id: string, trough: number): Promise<void> {
  try { await sb.from("positions").update({ trough_mark: trough }).eq("id", id); }
  catch { /* forensics only — never block the trade path */ }
}

// Today's realized P&L for a channel (for the Stop knob gate). closedAfterDate is
// the ET date string; we filter client-side like the cron worker.
export async function realizedTodayByChannel(strategistId: string, etDate: string): Promise<number> {
  // Server-side date floor + a wide cap (audit L2): the old newest-100 window under-counted a
  // churny channel's realized past 100 closes/day → the daily-stop latched LATE. 00:00Z on the
  // ET date = the prior evening ET — a safe superset; the client-side ET filter below is exact.
  const { data } = await sb
    .from("positions")
    .select("realized_pnl,closed_at")
    .eq("strategist_id", strategistId)
    .eq("status", "closed")
    .gte("closed_at", `${etDate}T00:00:00Z`)
    .order("closed_at", { ascending: false })
    .limit(1000);
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
    .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, () => { info("store: accounts changed (realtime)"); onChange(); })
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
  // durable per-trade forensics (44_trade_forensics) — the entry side of the dataset.
  entry_reason?: string; entry_features?: Record<string, unknown> | null; entry_delta?: number | null;
}): Promise<string | null> {
  const { entry_reason, entry_features, entry_delta, ...core } = row;
  const { error } = await sb.from("positions").insert({
    ...core, current_mark: core.avg_entry_price, unrealized_pnl: 0, status: "open",
    peak_mark: core.avg_entry_price, // MFE ratchet starts at entry
    trough_mark: core.avg_entry_price, // MAE ratchet starts at entry (58_trough_mark)
    entry_reason: entry_reason ?? null, entry_features: entry_features ?? null, entry_delta: entry_delta ?? null,
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
