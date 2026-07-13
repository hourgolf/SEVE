// ============================================================================
//  one-account-shadow — the live-transition rehearsal (2026-07-07).
//
//  THE QUESTION IT ANSWERS: when the proven "dream team" one day trades REAL
//  money, it lives in ONE account with ONE buying-power pool — no more 3-bucket
//  luxury. Every per-channel verdict is an INDIVIDUAL read; nobody has measured
//  the PORTFOLIO: budget contention (who starves when cash binds), shared-strike
//  stack concentration (70% of trades land on shared OCCs), correlated drawdown.
//
//  WHAT IT DOES: replays the armed FIRST-TEAM roster's ACTUAL live trades (real
//  fills, real exits, real timestamps — positions table, NO engine re-derivation)
//  from the era-4 epoch through one shared cash pool, chronologically:
//   · entry admits at actual size if cash affords it; else DOWNSIZES to the
//     affordable qty; else REJECTS (starved) — time priority, exits release first
//   · pyramid children (runner_of) admit only if their parent was admitted
//   · stack depth per OCC is metered always; --stack-cap N enforces a C1-style
//     cap (default OFF — C1 enforcement is sequenced behind the A6 read)
//   · NAV = cash (era-4 book is all same-day round trips; an overnight hold
//     would carry at entry cost and be flagged)
//
//  V1 SEMANTICS (stated so the numbers can't overclaim): actual per-trade sizes
//  (no re-sizing — RISK dollars are already human-scale), realized P&L scaled
//  per-contract when downsized, per-channel daily stops as they fired on paper,
//  fills as they printed (no self-cross/coalescing model yet). It measures the
//  CAPITAL layer, not fill physics.
//
//    npm run one-account-shadow                        # era-4 → today, $50k, FIRST-TEAM
//    npm run one-account-shadow -- --equity 25000      # stress the pool
//    npm run one-account-shadow -- --stack-cap 3       # enforce a C1-style cap
//    npm run one-account-shadow -- --all-armed         # whole armed roster, all buckets
//  Read-only vs the DB. day-report folds the default run into the nightly
//  forensics payload (payload.oneAccountShadow) → the would-be NAV curve accrues.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "../engine/pageAll";
import { isPositionExcludedFromStrategyResearch } from "../lib/research/positionAnnotations";

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}

const ERA4_EPOCH = "2026-06-30"; // LOCK/RIDE + stop-aware sizing live (the registry's clean-data epoch)
// The dream team's live RISK dials produce trades sized for ~this much buying power (peak
// concurrent deployment ~$17.5k; cash never binds at $50k). --rescale sizes every position
// by equity/REF so a smaller pool runs the SAME roster proportionally instead of cramming
// full-size trades in (which just rejects/downsizes and inflates % on a base you can't run).
const REF_EQUITY = 50_000;
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET_DAY.format(new Date(iso));

export interface ShadowOpts {
  equity?: number;      // starting cash for the one account (default 50_000)
  from?: string;        // ET date, default era-4 epoch
  to?: string;          // ET date, default today
  allArmed?: boolean;   // default false → FIRST-TEAM bucket (accounts.cred_ref '2') only
  stackCap?: number;    // 0/undefined = meter only; N = reject entries stacking an OCC past N channels
  rescale?: boolean;    // size each position by equity/REF_EQUITY (runnable small-pool roster)
  dailyTarget?: number; // per-channel/day PROFIT halt: once a channel's realized-so-far today ≥ $N,
                        // block its further entries (the win-side mirror of daily_stop_usd). 0 = off.
  // CONCENTRATION budgets (docs/concentration-allocator-spec.md, go-live item 2b) — 0/undef = off.
  // Admission: qty′ = min(target, cashRoom, occ-contract room, occ-premium room, underlying-premium
  // room); a cap that zeroes the room rejects ("occ-cap"/"und-cap"); a cap that shaves counts capBound.
  occMaxCt?: number;    // desk-wide contract ceiling per OCC
  occMaxUsd?: number;   // desk-wide premium $ ceiling per OCC
  undMaxUsd?: number;   // premium $ ceiling per underlying (SPY/QQQ/IWM umbrella)
}

interface PosRow {
  id: string; runner_of: string | null; occ_symbol: string; qty: number;
  avg_entry_price: number; realized_pnl: number; opened_at: string; closed_at: string;
  slug: string;
}

export interface ShadowDay {
  date: string; navEnd: number; dayPnl: number;
  entries: number; admitted: number; downsized: number; rejected: number;
  rejectReasons: Record<string, number>;
  peakDeployedUsd: number; minCashUsd: number;
  peakOcc: { occ: string; channels: number; contracts: number; usd: number } | null;
}

export interface ShadowResult {
  params: { equity: number; from: string; to: string; bucket: string; stackCap: number; rescale: boolean; occMaxCt: number; occMaxUsd: number; undMaxUsd: number };
  days: ShadowDay[];
  navEnd: number; totalPnl: number; actualPnl: number;
  maxStackChannels: number;
  maxDDusd: number; maxDDpct: number; // day-end peak-to-trough (see caveat: intraday is deeper)
  perChannel: { slug: string; trades: number; admitted: number; downsized: number; rejected: number; shadowPnl: number; actualPnl: number }[];
  openCarry: number; // positions still open at the end (carried at cost in NAV)
  // concentration-cap accounting (0s when caps off): entries a cap shaved/zeroed + contracts it removed
  capStats: { capBound: number; capRejected: number; shavedCt: number };
}

export async function runOneAccountShadow(opts: ShadowOpts = {}): Promise<ShadowResult> {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const equity = opts.equity ?? 50_000;
  const from = opts.from ?? ERA4_EPOCH;
  const to = opts.to ?? ET_DAY.format(new Date());
  const stackCap = opts.stackCap ?? 0;
  const rescale = opts.rescale ?? false;
  const scaleRatio = rescale ? equity / REF_EQUITY : 1;
  const dailyTarget = opts.dailyTarget ?? 0;
  const occMaxCt = opts.occMaxCt ?? 0, occMaxUsd = opts.occMaxUsd ?? 0, undMaxUsd = opts.undMaxUsd ?? 0;
  const undOf = (occ: string) => occ.match(/^([A-Z]+)\d/)?.[1] ?? occ; // OCC root = underlying
  // per-(channel, ET day) realized-so-far, for the daily-target profit halt. Increments on each
  // EXIT; checked at each ENTRY (events are ts-sorted, exits-before-entries on ties → the value
  // at an entry reflects only trades already CLOSED that day, the honest "banked so far").
  const realizedCD = new Map<string, number>();

  // roster: armed channels, FIRST-TEAM bucket unless --all-armed
  const { data: stratRaw, error: se } = await sb.from("strategists")
    .select("id,slug,status,accounts(cred_ref)").eq("status", "armed");
  if (se) throw new Error("strategists read: " + se.message);
  const roster = new Map<string, string>(); // strategist_id → slug
  for (const s of (stratRaw ?? []) as any[]) {
    const ref = (Array.isArray(s.accounts) ? s.accounts[0] : s.accounts)?.cred_ref ?? null;
    if (opts.allArmed || ref === "2") roster.set(s.id, s.slug);
  }
  if (!roster.size) throw new Error("no armed channels matched the bucket filter");

  // era-4 closed positions for the roster, chronological. pageAll past PostgREST's silent 1000-row
  // cap — the era-4 window grows monotonically from a fixed epoch across all 3 accounts (the roster
  // filter is client-side below), so it WILL cross the cap. id tiebreak (audit [18]): opened_at alone
  // is not a total order, so a same-minute cluster straddling a page edge could drop/double a
  // position and silently skew shadow cash / NAV / the concentration-cap read.
  const rows: PosRow[] = [];
  for (const p of await pageAll<any>((off) => sb.from("positions")
    .select("id,runner_of,occ_symbol,qty,avg_entry_price,realized_pnl,opened_at,closed_at,strategist_id")
    .eq("status", "closed")
    .gte("opened_at", `${from}T04:00:00Z`).lte("opened_at", `${to}T23:59:59Z`)
    .order("opened_at", { ascending: true }).order("id", { ascending: true }))) {
    if (isPositionExcludedFromStrategyResearch(p.id)) continue;
    const slug = roster.get(p.strategist_id);
    if (!slug || p.closed_at == null) continue;
    rows.push({ id: p.id, runner_of: p.runner_of, occ_symbol: p.occ_symbol, qty: Number(p.qty),
      avg_entry_price: Number(p.avg_entry_price), realized_pnl: Number(p.realized_pnl),
      opened_at: p.opened_at, closed_at: p.closed_at, slug });
  }

  // event stream — exits release cash before entries consume it on timestamp ties
  interface Ev { ts: number; kind: "exit" | "entry"; pos: PosRow }
  const events: Ev[] = [];
  for (const p of rows) {
    events.push({ ts: Date.parse(p.opened_at), kind: "entry", pos: p });
    events.push({ ts: Date.parse(p.closed_at), kind: "exit", pos: p });
  }
  events.sort((a, b) => a.ts - b.ts || (a.kind === "exit" ? -1 : 1) - (b.kind === "exit" ? -1 : 1));

  let cash = equity;
  const admittedQty = new Map<string, number>(); // position id → shadow qty
  const openCost = new Map<string, number>();    // position id → deployed $
  const occOpen = new Map<string, Map<string, { contracts: number }>>(); // occ → slug → lot
  // concentration-cap meters (incremental; only consulted when a cap is on)
  const occCt = new Map<string, number>();   // occ → open contracts (desk-wide)
  const occUsd = new Map<string, number>();  // occ → open premium $ (desk-wide)
  const undUsd = new Map<string, number>();  // underlying → open premium $
  const capStats = { capBound: 0, capRejected: 0, shavedCt: 0 };
  const perChannel = new Map<string, { trades: number; admitted: number; downsized: number; rejected: number; shadowPnl: number; actualPnl: number }>();
  const chan = (slug: string) => {
    let c = perChannel.get(slug);
    if (!c) { c = { trades: 0, admitted: 0, downsized: 0, rejected: 0, shadowPnl: 0, actualPnl: 0 }; perChannel.set(slug, c); }
    return c;
  };

  const days: ShadowDay[] = [];
  let d: ShadowDay | null = null;
  let navPrev = equity;
  let maxStackChannels = 0;
  const deployed = () => [...openCost.values()].reduce((a, v) => a + v, 0);
  const roll = (date: string) => {
    if (d) { d.navEnd = Math.round(cash + deployed()); d.dayPnl = Math.round(d.navEnd - navPrev); navPrev = d.navEnd; days.push(d); }
    d = { date, navEnd: 0, dayPnl: 0, entries: 0, admitted: 0, downsized: 0, rejected: 0, rejectReasons: {}, peakDeployedUsd: 0, minCashUsd: Math.round(cash), peakOcc: null };
  };

  for (const ev of events) {
    const date = etDate(ev.pos[ev.kind === "entry" ? "opened_at" : "closed_at"]);
    if (!d || date > d.date) roll(date);
    const p = ev.pos;
    const c = chan(p.slug);
    if (ev.kind === "entry") {
      c.trades++; c.actualPnl += p.realized_pnl; d!.entries++;
      const costPerCt = p.avg_entry_price * 100;
      // --rescale: the proportionally-sized target for this pool; else the real qty.
      // floor to whole contracts — a sub-1-contract target means this pool is too small
      // to express the trade at all (an honest small-account effect, not a cash bind).
      const targetQty = rescale ? Math.floor(p.qty * scaleRatio) : p.qty;
      let reason = "";
      let q = 0;
      if (p.runner_of && !(admittedQty.get(p.runner_of) ?? 0)) reason = "parent-rejected";
      else if (rescale && targetQty <= 0) reason = "sub-1ct";
      else if (dailyTarget > 0 && (realizedCD.get(`${p.slug}|${date}`) ?? 0) >= dailyTarget) reason = "daily-target";
      else if (stackCap > 0 && (occOpen.get(p.occ_symbol)?.size ?? 0) >= stackCap && !occOpen.get(p.occ_symbol)?.has(p.slug)) reason = "stack-cap";
      else {
        const cashRoom = Math.floor(cash / costPerCt);
        // CONCENTRATION admission (spec item 3): qty′ = min(target, cash, occ-ct, occ-$, und-$ room)
        let room = cashRoom;
        if (occMaxCt > 0) room = Math.min(room, occMaxCt - (occCt.get(p.occ_symbol) ?? 0));
        if (occMaxUsd > 0) room = Math.min(room, Math.floor((occMaxUsd - (occUsd.get(p.occ_symbol) ?? 0)) / costPerCt));
        if (undMaxUsd > 0) room = Math.min(room, Math.floor((undMaxUsd - (undUsd.get(undOf(p.occ_symbol)) ?? 0)) / costPerCt));
        q = Math.min(targetQty, Math.max(0, room));
        if (q <= 0) {
          if (cashRoom <= 0) reason = "no-cash";
          else { reason = (occMaxCt > 0 && occMaxCt - (occCt.get(p.occ_symbol) ?? 0) <= 0) || (occMaxUsd > 0 && occMaxUsd - (occUsd.get(p.occ_symbol) ?? 0) < costPerCt) ? "occ-cap" : "und-cap"; capStats.capRejected++; }
        } else if (room < cashRoom && q < Math.min(targetQty, cashRoom)) {
          // a cap (not cash, not the target) shaved this entry
          capStats.capBound++;
          capStats.shavedCt += Math.min(targetQty, cashRoom) - q;
        }
      }
      if (reason) {
        c.rejected++; d!.rejected++;
        d!.rejectReasons[reason] = (d!.rejectReasons[reason] ?? 0) + 1;
        admittedQty.set(p.id, 0);
      } else {
        if (q < targetQty) { c.downsized++; d!.downsized++; } // short of the (possibly rescaled) target = a cash bind
        d!.admitted++;
        admittedQty.set(p.id, q);
        const cost = q * costPerCt;
        cash -= cost;
        openCost.set(p.id, cost);
        occCt.set(p.occ_symbol, (occCt.get(p.occ_symbol) ?? 0) + q);
        occUsd.set(p.occ_symbol, (occUsd.get(p.occ_symbol) ?? 0) + cost);
        undUsd.set(undOf(p.occ_symbol), (undUsd.get(undOf(p.occ_symbol)) ?? 0) + cost);
        let m = occOpen.get(p.occ_symbol);
        if (!m) { m = new Map(); occOpen.set(p.occ_symbol, m); }
        const lot = m.get(p.slug) ?? { contracts: 0 };
        lot.contracts += q; m.set(p.slug, lot);
        // concentration meters
        const dep = deployed();
        if (dep > d!.peakDeployedUsd) d!.peakDeployedUsd = Math.round(dep);
        if (cash < d!.minCashUsd) d!.minCashUsd = Math.round(cash);
        const occContracts = [...m.values()].reduce((a, l) => a + l.contracts, 0);
        if (m.size > maxStackChannels) maxStackChannels = m.size;
        if (!d!.peakOcc || m.size > d!.peakOcc.channels || (m.size === d!.peakOcc.channels && occContracts > d!.peakOcc.contracts)) {
          const usd = rows.reduce((a, x) => a + (x.occ_symbol === p.occ_symbol ? (openCost.get(x.id) ?? 0) : 0), 0);
          d!.peakOcc = { occ: p.occ_symbol, channels: m.size, contracts: occContracts, usd: Math.round(usd) };
        }
      }
    } else {
      const q = admittedQty.get(p.id) ?? 0;
      if (q > 0) {
        const pnlPerCt = p.realized_pnl / p.qty;
        const cost = openCost.get(p.id) ?? 0;
        cash += cost + q * pnlPerCt;
        c.shadowPnl += q * pnlPerCt;
        // bank into the channel's day-realized (drives the daily-target halt on later same-day entries)
        const key = `${p.slug}|${etDate(p.closed_at)}`;
        realizedCD.set(key, (realizedCD.get(key) ?? 0) + q * pnlPerCt);
        openCost.delete(p.id);
        occCt.set(p.occ_symbol, Math.max(0, (occCt.get(p.occ_symbol) ?? 0) - q));
        occUsd.set(p.occ_symbol, Math.max(0, (occUsd.get(p.occ_symbol) ?? 0) - cost));
        undUsd.set(undOf(p.occ_symbol), Math.max(0, (undUsd.get(undOf(p.occ_symbol)) ?? 0) - cost));
        const m = occOpen.get(p.occ_symbol);
        if (m) {
          const lot = m.get(p.slug);
          if (lot) { lot.contracts -= q; if (lot.contracts <= 0) m.delete(p.slug); }
          if (!m.size) occOpen.delete(p.occ_symbol);
        }
      }
    }
  }
  roll("9999-12-31"); // sentinel: pushes the final real day; the sentinel itself stays in `d`, never pushed

  const totalPnl = Math.round(cash + deployed() - equity);
  const actualPnl = Math.round([...perChannel.values()].reduce((a, c) => a + c.actualPnl, 0));
  // day-end peak-to-trough drawdown (⚠ intraday is deeper — this is EOD-NAV granularity).
  let peakNav = equity, maxDDusd = 0, maxDDpct = 0;
  for (const day of days) {
    peakNav = Math.max(peakNav, day.navEnd);
    const draw = peakNav - day.navEnd;
    if (draw > maxDDusd) { maxDDusd = draw; maxDDpct = peakNav > 0 ? (100 * draw) / peakNav : 0; }
  }
  return {
    params: { equity, from, to, bucket: opts.allArmed ? "all-armed" : "FIRST-TEAM", stackCap, rescale, occMaxCt, occMaxUsd, undMaxUsd },
    days, navEnd: Math.round(cash + deployed()), totalPnl, actualPnl, maxStackChannels,
    maxDDusd: Math.round(maxDDusd), maxDDpct: Math.round(maxDDpct * 10) / 10,
    perChannel: [...perChannel.entries()].map(([slug, c]) => ({ slug, ...c,
      shadowPnl: Math.round(c.shadowPnl), actualPnl: Math.round(c.actualPnl) }))
      .sort((a, b) => b.shadowPnl - a.shadowPnl),
    openCarry: openCost.size,
    capStats,
  };
}

// ── HANDS-OFF reconstruction ────────────────────────────────────────────────────
// "How would the dream team do if I closed NOTHING by hand?" For each MANUAL-closed
// trade, replay the channel's OWN programmed exit (take_profit_pct → premium_stop_pct →
// EOD flatten) over the real option_quotes mid path (DB + archive), then swap that P&L
// for the manual one. Programmed exits (mostly the LOCK take-profits) already do 84% of
// the earning; this prices the 16% manual overlay. ⚠ PER-TRADE: it swaps P&L only, holding
// entries/slot-timing as-lived (a real programmed exit fires at a different time → different
// re-entries — unmodelable here since pb-ride, the dream-team engine, has no engine
// evaluator). underlying_stop leg omitted (premium TP/stop/EOD only) — a documented minor
// bias (pb's 0.35% ustop would cut some losers earlier than the −30% premium stop).
const archCache = new Map<string, { occ: string; m: number; t: string }[]>();
function archiveDay(date: string): { occ: string; m: number; t: string }[] | null {
  if (archCache.has(date)) return archCache.get(date)!;
  const f = `data/quotes-archive/${date}.json.gz`;
  if (!existsSync(f)) return null;
  try {
    const rows = (JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) as any[])
      .map((r) => ({ occ: String(r.occ_symbol), m: Number(r.mid), t: String(r.captured_at) })).filter((r) => r.m > 0);
    archCache.set(date, rows); return rows;
  } catch { return null; }
}
async function quotePath(sb: SupabaseClient, occ: string, openedAt: string): Promise<{ m: number; t: string }[]> {
  const date = String(openedAt).slice(0, 10), dayEnd = `${date}T23:59:59Z`;
  const out: { m: number; t: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("option_quotes").select("mid,captured_at").eq("occ_symbol", occ)
      .gte("captured_at", openedAt).lte("captured_at", dayEnd).order("captured_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
    for (const r of (data ?? []) as any[]) if (Number(r.mid) > 0) out.push({ m: Number(r.mid), t: String(r.captured_at) });
    if ((data ?? []).length < 1000) break;
  }
  if (out.length) return out;
  const day = archiveDay(date);
  return day ? day.filter((r) => r.occ === occ && r.t >= openedAt && r.t <= dayEnd).sort((a, b) => a.t.localeCompare(b.t)).map((r) => ({ m: r.m, t: r.t })) : [];
}
// programmed exit on a mid path: TP → premium-stop → (optional) underlying-stop, first to fire in
// TIME order (live-sweep ordering); else last mid. ustop = the pb/momo 0.30-0.50% underlying leg —
// when SPY moves ustopPct% adverse to the entry underlying, exit at that quote's mid.
function programmedExit(entry: number, path: { m: number; t: string }[], tpPct: number, stopPct: number,
    ustop?: { pct: number; optType: string; entryU: number; spyAt: (ms: number) => number | null }): number | null {
  if (!path.length) return null;
  const tp = tpPct > 0 ? entry * (1 + tpPct / 100) : null, stop = stopPct > 0 ? entry * (1 - stopPct / 100) : null;
  for (const q of path) {
    if (tp != null && q.m >= tp) return tp;
    if (stop != null && q.m <= stop) return stop;
    if (ustop && ustop.pct > 0 && ustop.entryU > 0) {
      const u = ustop.spyAt(Date.parse(q.t));
      if (u != null) {
        const adverse = (ustop.optType === "call" ? (ustop.entryU - u) : (u - ustop.entryU)) / ustop.entryU * 100;
        if (adverse >= ustop.pct) return q.m; // ustop fires → exit at the concurrent option mid
      }
    }
  }
  return path[path.length - 1].m;
}

async function handsOff(to: string): Promise<void> {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: strat } = await sb.from("strategists").select("id,slug,underlying,accounts(cred_ref),strategist_config(take_profit_pct,premium_stop_pct,underlying_stop_pct,entry_dte)").eq("status", "armed");
  const ft = new Map<string, { slug: string; underlying: string; tp: number; stop: number; ustop: number; dte: number }>();
  for (const s of (strat ?? []) as any[]) {
    if (((Array.isArray(s.accounts) ? s.accounts[0] : s.accounts)?.cred_ref) !== "2") continue;
    const c = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    ft.set(s.id, { slug: s.slug, underlying: (s.underlying ?? "SPY").toUpperCase(), tp: Number(c?.take_profit_pct ?? 0), stop: c?.premium_stop_pct == null ? 50 : Number(c.premium_stop_pct), ustop: Number(c?.underlying_stop_pct ?? 0), dte: Number(c?.entry_dte ?? 0) });
  }
  // pageAll + id tiebreak (audit [6]): the era-4→to window grows monotonically from a fixed epoch
  // across ~13 FIRST-TEAM channels. The old un-paginated, UN-ORDERED read silently capped at ~1000
  // rows in ARBITRARY (physical) order — dropping some `manual` closes — so asLivedTotal / actManual /
  // progManual and the printed hands-off overlay (the go-live read's input) were computed on a
  // partial book with no warning. opened_at is not a total order → id disambiguates page edges.
  const rows = await pageAll<any>((off) => sb.from("positions")
    .select("id,strategist_id,occ_symbol,qty,avg_entry_price,realized_pnl,close_reason,opened_at,opt_type,entry_features")
    .eq("status", "closed").gte("opened_at", `${ERA4_EPOCH}T04:00:00Z`).lte("opened_at", `${to}T23:59:59Z`)
    .in("strategist_id", [...ft.keys()])
    .order("opened_at", { ascending: true }).order("id", { ascending: true }));
  const manual = rows.filter((r) => String(r.close_reason ?? "").startsWith("manual"));
  const asLivedTotal = Math.round(rows.reduce((a, r) => a + Number(r.realized_pnl), 0));
  // Load underlying minute bars for the ustop leg (all ustop>0 dream-team channels are SPY, but
  // key by symbol so it generalizes). spyAt(symbol, ms) = last close at-or-before ms (forward-fill).
  const barsBySym = new Map<string, { ms: number; c: number }[]>();
  const symbols = new Set([...ft.values()].filter((v) => v.ustop > 0).map((v) => v.underlying));
  for (const sym of symbols) {
    const arr: { ms: number; c: number }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("underlying_bars").select("ts,close").eq("symbol", sym)
        .gte("ts", `${ERA4_EPOCH}T04:00:00Z`).lte("ts", `${to}T23:59:59Z`)
        .order("ts", { ascending: true }).order("id", { ascending: true }).range(from, from + 999); // id tiebreak (audit [18])
      for (const b of (data ?? []) as any[]) if (b.close != null) arr.push({ ms: Date.parse(b.ts), c: Number(b.close) });
      if ((data ?? []).length < 1000) break;
    }
    barsBySym.set(sym, arr);
  }
  const spyAtFor = (sym: string) => (ms: number): number | null => {
    const arr = barsBySym.get(sym); if (!arr || !arr.length) return null;
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].ms <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? arr[ans].c : null;
  };
  let progManual = 0, actManual = 0, uncovered = 0, ustopFires = 0;
  const byChan = new Map<string, { n: number; act: number; prog: number; uncov: number }>();
  for (const r of manual) {
    const cfg = ft.get(r.strategist_id)!;
    const path = await quotePath(sb, r.occ_symbol, r.opened_at);
    const e = byChan.get(cfg.slug) ?? { n: 0, act: 0, prog: 0, uncov: 0 };
    e.n++; e.act += Number(r.realized_pnl); actManual += Number(r.realized_pnl);
    const entryU = Number(r.entry_features?.spotClose ?? 0);
    const ustop = cfg.ustop > 0 && entryU > 0 ? { pct: cfg.ustop, optType: String(r.opt_type), entryU, spyAt: spyAtFor(cfg.underlying) } : undefined;
    const exitMid = programmedExit(Number(r.avg_entry_price), path, cfg.tp, cfg.stop, ustop);
    if (exitMid == null) { e.uncov++; uncovered++; e.prog += Number(r.realized_pnl); progManual += Number(r.realized_pnl); } // no quotes → hold as-lived
    else {
      // did the ustop leg drive this exit? (diagnostic: exit mid is neither TP nor premium-stop level)
      const tpL = cfg.tp > 0 ? Number(r.avg_entry_price) * (1 + cfg.tp / 100) : Infinity;
      const stL = cfg.stop > 0 ? Number(r.avg_entry_price) * (1 - cfg.stop / 100) : -Infinity;
      if (ustop && exitMid < tpL - 1e-6 && exitMid > stL + 1e-6 && exitMid !== path[path.length - 1].m) ustopFires++;
      const pnl = (exitMid - Number(r.avg_entry_price)) * 100 * Number(r.qty); e.prog += pnl; progManual += pnl;
    }
    byChan.set(cfg.slug, e);
  }
  const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const handsOffTotal = asLivedTotal - Math.round(actManual) + Math.round(progManual);
  console.log(`\nHANDS-OFF — the dream team with ZERO manual closes (${ERA4_EPOCH}→${to})`);
  console.log(`  every manual close swapped for the channel's programmed exit (TP→premium-stop→underlying-stop→EOD) on the real quote path\n`);
  console.log(`  as-lived (your hands on):   ${sgn(asLivedTotal)}   (${rows.length} trades)`);
  console.log(`  hands-off (programmed):     ${sgn(handsOffTotal)}   (${manual.length} manual trades reconstructed, ${uncovered} held as-lived: quotes pruned)`);
  console.log(`  your manual overlay adds:   ${sgn(asLivedTotal - handsOffTotal)}   (manual ${sgn(actManual)} vs those trades programmed ${sgn(progManual)}) · ustop drove ${ustopFires} exits\n`);
  // which channels are 1DTE (their quote path truncates at day-1 EOD → programmed exit unreliable)
  const dteBySlug = new Map([...ft.values()].map((v) => [v.slug, v.dte]));
  console.log(`  by channel (manual trades — your close vs its programmed exit; ⚠1DTE = reconstruction truncates at day-1 EOD):`);
  for (const [slug, e] of [...byChan.entries()].sort((a, b) => (b[1].act - b[1].prog) - (a[1].act - a[1].prog)))
    console.log(`    ${slug.padEnd(22)} ${String(e.n).padStart(2)}t  you ${sgn(e.act).padStart(8)}  programmed ${sgn(e.prog).padStart(8)}  Δyou ${sgn(e.act - e.prog).padStart(8)}${(dteBySlug.get(slug) ?? 0) >= 1 ? " ⚠1DTE" : ""}${e.uncov ? ` (${e.uncov} uncov)` : ""}`);
  console.log(`\n  ⚠ ustop leg modeled but fired 0× — the −30% premium stop is TIGHTER than the 0.35% underlying stop for near-ATM (30% premium ≈ 0.20% SPY < 0.35%), so it dominates; the ustop omission did NOT bias the number.`);
  console.log(`  ⚠ 1DTE channels (pb-ride/pb-ride-itm) truncate at day-1 EOD (no engine evaluator; quote path is opened-day only) → their programmed loss is OVERSTATED; trust the 0DTE reads (momo/pb-ride-2/breakout/trails). Slot timing held as-lived; one era = noise.\n`);
}

// ── SELF-CROSS / COALESCING detector (go-live infra item 0 — SAFE, measurement only) ──────────
// In one live account the dream team's shared strikes (70% of trades) collide: channel A's exit-SELL
// and channel B's entry-BUY on the same OCC in the same minute cross against each other (pay the
// spread twice), and multiple channels' same-minute BUYs on one OCC could be ONE combined order.
// This flags both from actual trades → the number that decides if coalescing is worth a worker change.
// No trade-path change. Cost = modeled half-spread (3% of mid) crossed unnecessarily.
async function crossAudit(to: string): Promise<void> {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: strat } = await sb.from("strategists").select("id,slug,accounts(cred_ref)").eq("status", "armed");
  const ft = new Map<string, string>();
  for (const s of (strat ?? []) as any[]) if (((Array.isArray(s.accounts) ? s.accounts[0] : s.accounts)?.cred_ref) === "2") ft.set(s.id, s.slug);
  // pageAll + id tiebreak (audit [6]): same growing era-4→to window as handsOff — un-paginated it
  // silently caps at ~1000 arbitrary rows and UNDER-counts the self-cross / coalescing cost (the
  // infra-item-1 decision input). opened_at is not a total order.
  const pos = await pageAll<any>((off) => sb.from("positions").select("strategist_id,occ_symbol,qty,avg_entry_price,current_mark,opened_at,closed_at")
    .eq("status", "closed").gte("opened_at", `${ERA4_EPOCH}T04:00:00Z`).lte("opened_at", `${to}T23:59:59Z`)
    .in("strategist_id", [...ft.keys()])
    .order("opened_at", { ascending: true }).order("id", { ascending: true }));
  const minute = (iso: string) => String(iso).slice(0, 16); // to the minute (UTC)
  // BUY events (entries) and SELL events (exits), keyed occ|minute
  const buys = new Map<string, { slug: string; qty: number; px: number }[]>();
  const sells = new Map<string, { slug: string; qty: number }[]>();
  for (const p of (pos ?? []) as any[]) {
    const slug = ft.get(p.strategist_id)!;
    const bk = `${p.occ_symbol}|${minute(p.opened_at)}`;
    (buys.get(bk) ?? buys.set(bk, []).get(bk)!).push({ slug, qty: Number(p.qty), px: Number(p.avg_entry_price) });
    if (p.closed_at) { const sk = `${p.occ_symbol}|${minute(p.closed_at)}`; (sells.get(sk) ?? sells.set(sk, []).get(sk)!).push({ slug, qty: Number(p.qty) }); }
  }
  const halfSpread = (px: number) => Math.max(0.01, px * 0.015); // 3% modeled spread → half = 1.5%
  // self-cross: same occ|minute has BOTH a buy and a sell (from different channels)
  let scEvents = 0, scContracts = 0, scCost = 0;
  for (const [k, bs] of buys) {
    const ss = sells.get(k); if (!ss) continue;
    const buyers = new Set(bs.map((b) => b.slug)), sellers = new Set(ss.map((s) => s.slug));
    const crossChans = [...buyers].some((b) => !sellers.has(b)) && sellers.size > 0;
    if (!crossChans) continue;
    const crossed = Math.min(bs.reduce((a, b) => a + b.qty, 0), ss.reduce((a, s) => a + s.qty, 0));
    scEvents++; scContracts += crossed; scCost += 2 * halfSpread(bs[0].px) * 100 * crossed; // both sides cross needlessly
  }
  // coalescing opportunity: same occ|minute has ≥2 BUYS across different channels (one combined order)
  let coEvents = 0, coContracts = 0, coSave = 0;
  for (const [, bs] of buys) {
    if (new Set(bs.map((b) => b.slug)).size < 2) continue;
    const extra = bs.reduce((a, b) => a + b.qty, 0) - Math.max(...bs.map((b) => b.qty)); // contracts beyond the largest single order
    coEvents++; coContracts += bs.reduce((a, b) => a + b.qty, 0); coSave += halfSpread(bs[0].px) * 100 * extra; // one crossing saved on the merged excess
  }
  const sgn = (v: number) => `$${Math.round(v).toLocaleString()}`;
  console.log(`\nSELF-CROSS / COALESCING AUDIT — dream team in one account (${ERA4_EPOCH}→${to}, ${(pos ?? []).length} trades)`);
  console.log(`  the go-live collision the 3 paper buckets hide — same OCC, same minute, one pool\n`);
  console.log(`  SELF-CROSS (A sells while B buys the same strike): ${scEvents} events · ${scContracts} contracts crossed · ~${sgn(scCost)} wasted spread`);
  console.log(`  COALESCE opp (≥2 channels buy the same strike/min): ${coEvents} events · ${coContracts} contracts · ~${sgn(coSave)} saved by one combined order`);
  console.log(`\n  → total ~${sgn(scCost + coSave)} of execution friction one account would incur that coalescing/self-cross-prevention (infra item 1) recovers.`);
  console.log(`  ⚠ modeled 3% half-spread (real NBBO tighter → likely an OVER-estimate); minute-bucketed; the decision input for whether the worker change is worth it.\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argNum = (name: string, dflt: number) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt; };
const argStr = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toLocaleString()}`;

async function cli() {
  if (process.argv.includes("--hands-off")) { await handsOff(argStr("to", ET_DAY.format(new Date()))); return; }
  if (process.argv.includes("--cross-audit")) { await crossAudit(argStr("to", ET_DAY.format(new Date()))); return; }
  // --target-sweep: scope the daily profit-target halt DESKWIDE — baseline (no halt) vs a ladder
  // of per-channel/day profit caps, showing the NAV effect + how many entries each halt would skip.
  if (process.argv.includes("--target-sweep")) {
    const base = await runOneAccountShadow({ to: argStr("to", ET_DAY.format(new Date())) });
    console.log(`\nDAILY PROFIT-TARGET HALT — deskwide scope ($${base.params.equity.toLocaleString()} · ${base.params.bucket} · ${base.params.from}→${base.params.to})`);
    console.log(`  per-channel/day: once a channel banks ≥ $target realized that day, block its further entries (win-side mirror of daily_stop)\n`);
    console.log(`  ${"target/ch/day".padEnd(16)}${"NAV".padStart(10)}${"Δ vs base".padStart(11)}${"skipped".padStart(9)}`);
    console.log(`  ${"none (base)".padEnd(16)}${("$" + base.navEnd.toLocaleString()).padStart(10)}${"—".padStart(11)}${"0".padStart(9)}`);
    for (const t of [500, 750, 1000, 1500, 2000]) {
      const r = await runOneAccountShadow({ to: argStr("to", ET_DAY.format(new Date())), dailyTarget: t });
      const skipped = r.days.reduce((a, day) => a + (day.rejectReasons["daily-target"] ?? 0), 0);
      console.log(`  ${("$" + t).padEnd(16)}${("$" + r.navEnd.toLocaleString()).padStart(10)}${sgn(r.totalPnl - base.totalPnl).padStart(11)}${String(skipped).padStart(9)}`);
    }
    console.log(`\n  ⚠ flat deskwide target (channels differ in size — the real design scales it per-channel, ~k×RISK); actual-trade replay, one era = noise.\n`);
    return;
  }
  const r = await runOneAccountShadow({
    equity: argNum("equity", 50_000),
    from: argStr("from", ERA4_EPOCH),
    to: argStr("to", ET_DAY.format(new Date())),
    allArmed: process.argv.includes("--all-armed"),
    stackCap: argNum("stack-cap", 0),
    rescale: process.argv.includes("--rescale"),
    dailyTarget: argNum("daily-target", 0),
    // concentration budgets (spec 2b): --occ-cap-ct 36 --occ-cap-usd 12000 --und-cap-usd 30000
    occMaxCt: argNum("occ-cap-ct", 0),
    occMaxUsd: argNum("occ-cap-usd", 0),
    undMaxUsd: argNum("und-cap-usd", 0),
  });
  console.log(`\nONE-ACCOUNT SHADOW — the dream team in a single $${r.params.equity.toLocaleString()} account${r.params.rescale ? " (RESCALED — RISK sized to pool)" : ""}`);
  const capLbl = [r.params.occMaxCt && `occ≤${r.params.occMaxCt}ct`, r.params.occMaxUsd && `occ≤$${r.params.occMaxUsd / 1000}k`, r.params.undMaxUsd && `und≤$${r.params.undMaxUsd / 1000}k`].filter(Boolean).join(" ");
  console.log(`${r.params.bucket} bucket · ${r.params.from} → ${r.params.to} · actual live trades through one cash pool · stack cap ${r.params.stackCap || "OFF (metered)"}${capLbl ? ` · CONC CAPS ${capLbl}` : ""}\n`);
  console.log(`  date        NAV       day P&L   entries adm/dwn/rej   peak deployed   min cash   deepest stack`);
  for (const day of r.days) {
    const po = day.peakOcc ? `${day.peakOcc.channels}ch/${day.peakOcc.contracts}ct ${day.peakOcc.occ.replace(/^SPY|^QQQ|^IWM/, (m) => m + " ")}` : "—";
    console.log(`  ${day.date}  $${day.navEnd.toLocaleString().padEnd(8)} ${sgn(day.dayPnl).padStart(8)}   ${String(day.entries).padStart(3)}   ${day.admitted}/${day.downsized}/${day.rejected}      $${day.peakDeployedUsd.toLocaleString().padStart(7)}    $${day.minCashUsd.toLocaleString().padStart(7)}   ${po}`);
  }
  console.log(`\n  Σ shadow ${sgn(r.totalPnl)} on $${r.params.equity.toLocaleString()} (${((100 * r.totalPnl) / r.params.equity).toFixed(1)}%) vs the same trades' paper P&L ${sgn(r.actualPnl)} · max OCC stack ${r.maxStackChannels} channels${r.openCarry ? ` · ⚠ ${r.openCarry} open carried at cost` : ""}`);
  console.log(`  max drawdown ${sgn(-r.maxDDusd)} (${r.maxDDpct}% of peak, day-end NAV — intraday is deeper)`);
  const contested = r.days.filter((day) => day.rejected + day.downsized > 0).length;
  console.log(`  contention: ${contested}/${r.days.length} sessions had a downsize/rejection${contested ? "" : " — cash never bound at this equity"}`);
  if (r.params.occMaxCt || r.params.occMaxUsd || r.params.undMaxUsd)
    console.log(`  concentration caps: shaved ${r.capStats.capBound} entr${r.capStats.capBound === 1 ? "y" : "ies"} (−${r.capStats.shavedCt}ct) · zeroed ${r.capStats.capRejected}`);
  console.log("");
  console.log(`  per-channel (shadow vs paper):`);
  for (const c of r.perChannel) console.log(`    ${c.slug.padEnd(28)} ${String(c.trades).padStart(3)}t  ${sgn(c.shadowPnl).padStart(9)}  (paper ${sgn(c.actualPnl)})${c.rejected ? `  · ${c.rejected} rejected` : ""}${c.downsized ? ` · ${c.downsized} downsized` : ""}`);
  console.log(`\n  ⚠ capital layer only: actual sizes/fills/exits as lived on paper; no self-cross or fill-impact model; per-channel daily stops as they fired at paper scale.\n`);
}
if (process.argv[1]?.endsWith("one-account-shadow.ts")) cli().catch((e) => { console.error(e); process.exit(1); });
