// ============================================================================
//  paper-trader — DISPATCHER DRAFT (multi-channel "one engine, two drivers").
//
//  ⚠️ DRAFT — review + backtest before replacing index.ts. Specifically:
//    • power & grind are first-draft theses — run `npm run backtest` on real
//      option_bars and Arm them before they trade live (the safety gate).
//    • position attribution: the desk `positions` table (strategist_id ↔
//      occ_symbol) is the source of truth per channel. If two channels pick the
//      SAME 0DTE contract, Alpaca nets them into one position — rare, but a
//      known edge case (mitigation noted below).
//    • this multi-channel worker itself is untested against live Alpaca.
//
//  What changed vs the single-strategy worker:
//    - loads ALL strategists, loops them, runs each one's registered strategy
//      on session features (computeFeatures), books orders tagged per channel.
//    - each channel sizes off ITS OWN capital_pct of the fund equity (independent
//      allocation), capped by its max_contracts.
//    - strategies + computeFeatures are inlined here (paste-deploy has no bundler)
//      but MIRROR engine/* — keep them in sync; the engine stays the backtest
//      source of truth.
//
//  Add-Channel phase 2 additions (this revision):
//    - reads `status` + `spec_json` from strategists. ONLY 'armed' channels place
//      orders (draft/disabled are idle). status missing → treated as armed so the
//      built-ins keep running pre-migration.  ⚠ run 13_add_channel.sql FIRST.
//    - compiled-spec channels (no REGISTRY entry) run via compileSpec() — the
//      inlined twin of engine/specEvaluate.ts (SUPPORTED conditions only; STRICT
//      live posture: any unknown/unsupported condition makes the entry not fire).
//    - the Stop knob (daily_stop_usd) now bites: a channel stops taking NEW
//      entries once its REALIZED P&L today is at/under its loss budget.
//    - SAME-0DTE collision fix: exits sell only the CHANNEL'S own qty (not the
//      whole netted Alpaca lot), and a desk row with no matching Alpaca position
//      is RECONCILED closed (valued at the last quote) — fixes stuck "open" rows
//      when one channel's exit flattened another holding the same contract.
//    - CHANNEL INDEPENDENCE: every order carries a per-channel client_order_id
//      (`slug-occ-min`). The old account-wide "already_open" guard is gone — a
//      channel only checks ITS OWN orders, so two channels can hold the same
//      contract independently (Alpaca nets the lot; each keeps its own book).
//      Re-buy loop is still guarded per channel: a working order blocks a re-fire,
//      and a filled-but-unrecorded position is reconstructed, not re-bought.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY = Deno.env.get("ALPACA_KEY") ?? "";
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() !== "false";
const PAPER = "https://paper-api.alpaca.markets";

const sb = createClient(SB_URL, SB_SERVICE);

// ---- types (mirror engine/types.ts) ---------------------------------------
type OptType = "call" | "put";
interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number; vwap: number; }
interface Features {
  minute: number; minutesToClose: number; close: number; vwap: number;
  openRangeHi: number | null; openRangeLo: number | null; atr: number; mom: number; er: number; relVol: number;
}
interface Pos { optType: OptType; entryMinute: number; entryUnderlying: number; peakFavorable: number; }
type Intent = { kind: "enter"; direction: OptType; reason: string } | { kind: "exit"; reason: string } | null;
type Evaluate = (f: Features, pos: Pos | null) => Intent;

// ---- features (mirror engine/engine.ts — minutesToClose is patched live) ----
const OPEN_RANGE_MIN = 30, ATR_N = 14, ER_N = 30, VOL_N = 20;
function computeFeatures(bars: Bar[], i: number, minutesToClose: number): Features {
  const b = bars[i];
  let orHi: number | null = null, orLo: number | null = null;
  if (i >= OPEN_RANGE_MIN - 1) {
    orHi = -Infinity; orLo = Infinity;
    for (let j = 0; j < OPEN_RANGE_MIN; j++) { orHi = Math.max(orHi, bars[j].high); orLo = Math.min(orLo, bars[j].low); }
  }
  let atrSum = 0, atrCount = 0;
  for (let j = Math.max(0, i - ATR_N + 1); j <= i; j++) { atrSum += bars[j].high - bars[j].low; atrCount++; }
  const atr = atrCount ? atrSum / atrCount : 0;
  const mom = i >= 3 ? b.close - bars[i - 3].close : 0;
  let er = 0; const n = Math.min(ER_N, i);
  if (n > 0) { let path = 0; for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].close - bars[j - 1].close); er = path > 0 ? Math.abs(b.close - bars[i - n].close) / path : 0; }
  let relVol = 1;
  if (i >= 1) { let vSum = 0, vC = 0; for (let j = Math.max(0, i - VOL_N); j < i; j++) { vSum += bars[j].volume; vC++; } const avg = vC ? vSum / vC : 0; relVol = avg > 0 ? b.volume / avg : 1; }
  return { minute: i, minutesToClose, close: b.close, vwap: b.vwap, openRangeHi: orHi, openRangeLo: orLo, atr, mom, er, relVol };
}

// ---- strategies (mirror engine/strategies/* — keep in sync) -----------------
function breakoutEval(f: Features, pos: Pos | null): Intent {
  const P = { breakAtr: 0.5, volMult: 1.3, erMin: 0.35, momConfirm: 0.3, trailAtr: 1.5, failAtr: 0.75, flatten: 35 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call") {
      if (f.close < pos.peakFavorable - P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeHi != null && f.close < f.openRangeHi - P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    } else {
      if (f.close > pos.peakFavorable + P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeLo != null && f.close > f.openRangeLo + P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.er < P.erMin || f.relVol < P.volMult) return null;
  if (f.close > f.openRangeHi + P.breakAtr * f.atr && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "break_high" };
  if (f.close < f.openRangeLo - P.breakAtr * f.atr && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "break_low" };
  return null;
}
function fadeEval(f: Features, pos: Pos | null): Intent {
  const P = { atrMult: 1.5, weakMom: 0.6, stopAtr: 1.0, timeStop: 20, flatten: 35, erMax: 0.4 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") { if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0 || f.er > P.erMax) return null;
  if (Math.abs(f.mom) >= P.weakMom * f.atr) return null;
  if (f.close > f.openRangeHi && f.close - f.vwap > P.atrMult * f.atr) return { kind: "enter", direction: "put", reason: "fade_upside_stretch" };
  if (f.close < f.openRangeLo && f.vwap - f.close > P.atrMult * f.atr) return { kind: "enter", direction: "call", reason: "fade_downside_stretch" };
  return null;
}
function powerEval(f: Features, pos: Pos | null): Intent {
  const P = { windowMin: 60, momConfirm: 0.25, stopAtr: 1.0, flatten: 3 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call" && f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    if (pos.optType === "put" && f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    return null;
  }
  if (f.minutesToClose > P.windowMin || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.close > f.vwap && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "power_hour_long" };
  if (f.close < f.vwap && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "power_hour_short" };
  return null;
}
function grindEval(f: Features, pos: Pos | null): Intent {
  const P = { momTrigger: 0.5, volMin: 1.1, targetAtr: 0.6, stopAtr: 0.5, timeStop: 5, flatten: 10 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "call") { if (f.close >= pos.entryUnderlying + P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close <= pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close <= pos.entryUnderlying - P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close >= pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.minutesToClose <= P.flatten || f.atr <= 0 || f.relVol < P.volMin) return null;
  if (f.mom >= P.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -P.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}

// slug → { evaluate, timeframeMin, warmupBars }  (mirrors engine/registry.ts)
const REGISTRY: Record<string, { evaluate: Evaluate; tf: number; warmup: number }> = {
  breakout: { evaluate: breakoutEval, tf: 1, warmup: 30 },
  fade:     { evaluate: fadeEval,     tf: 1, warmup: 30 },
  power:    { evaluate: powerEval,    tf: 1, warmup: 30 },
  grind:    { evaluate: grindEval,    tf: 1, warmup: 30 },
};

// ---- compiled-spec interpreter (mirrors engine/specEvaluate.ts) -------------
// A channel added via the dashboard has no REGISTRY entry — it carries a compiled
// StrategySpec (spec_json). This turns that spec into the SAME Evaluate the engine
// produces, for the SUPPORTED condition vocabulary. Live posture is STRICT: any
// unsupported/unknown condition makes the entry not fire (never trade an
// unevaluated gate) — armed channels are capability-checked, so this is defensive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;
function emaArr(vals: number[], p: number): number[] {
  const out: number[] = []; const k = 2 / (p + 1); let prev = vals.length ? vals[0] : 0;
  for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
function rsiArr(vals: number[], p: number): number[] {
  const out = new Array(vals.length).fill(50); if (vals.length < 2) return out;
  let ag = 0, al = 0;
  for (let i = 1; i < vals.length; i++) {
    const ch = vals[i] - vals[i - 1]; const g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= p) { ag += g / p; al += l / p; if (i < p) { out[i] = 50; continue; } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; }
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function xdir(a: number[], b: number[], i: number): number {
  if (i < 1) return 0; const pr = a[i - 1] - b[i - 1], nw = a[i] - b[i];
  if (pr <= 0 && nw > 0) return 1; if (pr >= 0 && nw < 0) return -1; return 0;
}
function parseET(s: string): number | null { const m = /^\s*(\d{1,2}):(\d{2})/.exec(s || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
const SPEC_SUPPORTED = new Set(["ma_cross","vwap_side","vwap_dev","opening_range","or_width_min","rel_vol","rsi","time_before","time_between"]);

interface CompiledSpec { build: (bars: Bar[]) => Evaluate; tf: number; warmup: number; premiumExit: { profitPct?: number; stopPct?: number }; }
function compileSpec(spec: Spec): CompiledSpec {
  const entries: Spec[] = spec?.entries ?? [];
  let profitPct: number | undefined, stopPct: number | undefined, timeExit: number | null = null;
  // Magnitudes: a spec may state the stop as "-50" or "50"; downstream uses
  // entry·(1 ± pct/100), so abs() keeps a "-50%" stop from inverting into a gain.
  for (const e of (spec?.exits ?? [])) {
    if (profitPct == null && typeof e.profitPct === "number") profitPct = Math.abs(e.profitPct);
    if (stopPct == null && typeof e.stopPct === "number") stopPct = Math.abs(e.stopPct);
    if (e.timeET) { const t = parseET(e.timeET); if (t != null) timeExit = timeExit == null ? t : Math.min(timeExit, t); }
  }
  let warmup = 30;
  for (const e of entries) for (const c of (e.all ?? [])) {
    if (c.kind === "ma_cross") warmup = Math.max(warmup, c.slow, c.fast);
    else if (c.kind === "rsi") warmup = Math.max(warmup, c.period + 1);
  }
  const build = (bars: Bar[]): Evaluate => {
    const closes = bars.map((b) => b.close);
    const emaS = new Map<number, number[]>(), rsiS = new Map<number, number[]>();
    for (const e of entries) for (const c of (e.all ?? [])) {
      if (c.kind === "ma_cross") { if (!emaS.has(c.fast)) emaS.set(c.fast, emaArr(closes, c.fast)); if (!emaS.has(c.slow)) emaS.set(c.slow, emaArr(closes, c.slow)); }
      else if (c.kind === "rsi" && !rsiS.has(c.period)) rsiS.set(c.period, rsiArr(closes, c.period));
    }
    const etMin = bars.map((b) => etParts(b.ts).min);
    const cond = (c: Spec, f: Features, i: number): boolean => {
      switch (c.kind) {
        case "ma_cross": { const a = emaS.get(c.fast), b = emaS.get(c.slow); if (!a || !b) return false; return xdir(a, b, i) === (c.dir === "up" ? 1 : -1); }
        case "vwap_side": return c.side === "above" ? f.close > f.vwap : f.close < f.vwap;
        case "vwap_dev": { if (f.atr <= 0) return false; const d = (f.close - f.vwap) / f.atr; return c.cmp === ">" ? d >= c.atr : d <= -c.atr; }
        case "opening_range": return c.side === "break_above" ? (f.openRangeHi != null && f.close > f.openRangeHi) : (f.openRangeLo != null && f.close < f.openRangeLo);
        case "or_width_min": { if (f.openRangeHi == null || f.openRangeLo == null || f.close <= 0) return false; return ((f.openRangeHi - f.openRangeLo) / f.close) * 100 >= c.pct; }
        case "rel_vol": return f.relVol >= c.min;
        case "rsi": { const s = rsiS.get(c.period); if (!s) return false; return c.cmp === ">" ? s[i] > c.value : s[i] < c.value; }
        case "time_before": { const t = parseET(c.et); return t != null && etMin[i] < t; }
        case "time_between": { const a = parseET(c.startET), b = parseET(c.endET); return a != null && b != null && etMin[i] >= a && etMin[i] <= b; }
        default: return false;
      }
    };
    const entryHolds = (e: Spec, f: Features, i: number): boolean => {
      const all = e.all ?? []; if (!all.length) return false;
      for (const c of all) { if (!SPEC_SUPPORTED.has(c.kind)) return false; if (!cond(c, f, i)) return false; }
      return true;
    };
    const infer = (e: Spec): OptType | null => {
      for (const c of (e.all ?? [])) {
        if (c.kind === "ma_cross") return c.dir === "up" ? "call" : "put";
        if (c.kind === "vwap_side") return c.side === "above" ? "call" : "put";
        if (c.kind === "opening_range") return c.side === "break_above" ? "call" : "put";
      }
      return null;
    };
    return (f: Features, pos: Pos | null): Intent => {
      const i = f.minute;
      if (pos) {
        if (f.minutesToClose <= 1) return { kind: "exit", reason: "eod_flatten" };
        if (timeExit != null && etMin[i] >= timeExit) return { kind: "exit", reason: "time_exit" };
        return null;
      }
      if (i < warmup || f.atr <= 0) return null;
      for (const e of entries) {
        if (!entryHolds(e, f, i)) continue;
        const dir: OptType | null = e.direction === "both" ? infer(e) : e.direction;
        if (!dir) continue;
        return { kind: "enter", direction: dir, reason: e.reason || "spec_entry" };
      }
      return null;
    };
  };
  return { build, tf: 1, warmup, premiumExit: { profitPct, stopPct } };
}

// ---- helpers ---------------------------------------------------------------
const aHdr = { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET };
async function aGet(path: string) { const r = await fetch(PAPER + path, { headers: aHdr }); if (!r.ok) throw new Error(`${r.status} GET ${path}`); return r.json(); }
async function aPost(path: string, body: unknown) { const r = await fetch(PAPER + path, { method: "POST", headers: { ...aHdr, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${r.status} POST ${path}`); return r.json(); }
async function journal(level: string, message: string, meta?: unknown) { try { await sb.from("events").insert({ level, message, meta: meta ?? null }); } catch { /* */ } }
function occSymbol(etDate: string, strike: number, type: OptType) { const [y, m, d] = etDate.split("-"); return `SPY${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`; }
function aggregate(bars: Bar[], tf: number): Bar[] {
  if (tf <= 1) return bars;
  const out: Bar[] = []; let bk = -1;
  for (const b of bars) { const ms = Math.floor(b.ts / (tf * 60000)) * (tf * 60000); if (ms !== bk) { out.push({ ...b, ts: ms }); bk = ms; } else { const c = out[out.length - 1]; c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close; c.volume += b.volume; } }
  return out;
}
function etParts(ms: number) { const d = new Date(ms); const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })); return { min: et.getHours() * 60 + et.getMinutes(), date: `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}` }; }

// Alpaca order statuses that mean "still working" (not yet a fill/cancel).
const WORKING_ORDER = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated", "accepted_for_bidding"]);

Deno.serve(async () => {
  try {
    const { data: fund } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
    // status + spec_json drive the Add-Channel path (run 13_add_channel.sql BEFORE
    // deploying this — otherwise these columns don't exist and the select errors).
    const { data: strategists } = await sb.from("strategists").select("id,slug,status,spec_json,strategist_config(*)");
    const account = await aGet("/v2/account");
    // Track whether the positions read SUCCEEDED — reconciliation (closing a desk
    // row with no Alpaca match) must NEVER run on a transient API error, or it
    // would wrongly flatten every channel's books at once.
    let positions: Record<string, unknown>[] = [];
    let positionsOk = true;
    try { positions = await aGet("/v2/positions"); } catch { positionsOk = false; }
    // All recent orders. Each is tagged with a per-CHANNEL client_order_id, so a
    // channel only ever looks at its OWN orders (independence — no account-wide
    // symbol guard, so two channels can hold the same contract).
    const allOrders: Record<string, unknown>[] = await aGet("/v2/orders?status=all&limit=500&direction=desc").catch(() => []);

    // today's session 1m bars (oldest→newest), from market open
    const { data: rawBars } = await sb.from("underlying_bars").select("ts,open,high,low,close,volume,vwap").eq("symbol", "SPY").order("ts", { ascending: false }).limit(900);
    const all1m: Bar[] = (rawBars ?? []).filter((b: Record<string, number | null>) => b.close != null).reverse().map((b: Record<string, number | null>) => ({ ts: Date.parse(b.ts as unknown as string), open: Number(b.open ?? b.close), high: Number(b.high ?? b.close), low: Number(b.low ?? b.close), close: Number(b.close), volume: Number(b.volume ?? 0), vwap: Number(b.vwap ?? b.close) }));
    const nowMs = Date.now();
    const todayET = etParts(nowMs).date;
    const session1m = all1m.filter((b) => etParts(b.ts).date === todayET);

    // fund-level equity snapshot
    await sb.from("equity_snapshots").insert({ strategist_id: null, net_liquidation: Number(account.equity), cash: Number(account.cash), unrealized_pnl: positions.reduce((a, p) => a + Number(p.unrealized_pl ?? 0), 0) });

    const out: Record<string, unknown>[] = [];
    for (const s of (strategists ?? [])) {
      const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
      if (!cfg) continue;                                           // no config → idle
      // Resolve this channel's edge: a built-in CODE strategy (REGISTRY) or a
      // COMPILED spec (spec_json from the row — the Add-Channel path).
      const code = REGISTRY[s.slug];
      const compiled = !code && s.spec_json ? compileSpec(s.spec_json) : null;
      if (!code && !compiled) { out.push({ slug: s.slug, note: "no_edge" }); continue; }
      const tf = code ? code.tf : compiled!.tf;
      const warmup = code ? code.warmup : compiled!.warmup;
      // ARM gate: only 'armed' channels open NEW positions. A 'draft'/'disabled'
      // channel (e.g. one the operator deleted) still MANAGES an open position —
      // exits + reconcile run below so it winds down — it just can't enter.
      // status missing (pre-13_add_channel.sql) → treat as armed so built-ins run.
      const status = (s as { status?: string }).status ?? "armed";
      const armBlocked = status !== "armed";
      const guardBlocked = fund?.is_halted ? "halted" : cfg.muted ? "muted" : fund?.mode !== "paper" ? "not_paper" : null;

      const bars = aggregate(session1m, tf);
      if (bars.length < warmup) { out.push({ slug: s.slug, note: "warmup" }); continue; }
      const i = bars.length - 1;
      const last = bars[i];
      const { min: etMin } = etParts(last.ts);
      const minutesToClose = Math.max(0, 16 * 60 - etMin);          // real time-to-close (16:00 ET)
      const f = computeFeatures(bars, i, minutesToClose);

      // this channel's open position (desk row = source of truth) + Alpaca match
      const { data: rows } = await sb.from("positions").select("*").eq("strategist_id", s.id).eq("status", "open");
      const row = (rows ?? [])[0];
      const alp = row ? positions.find((p) => String(p.symbol) === String(row.occ_symbol)) : undefined;
      // entryUnderlying ≈ strike: the worker enters ATM, so strike = round(spot
      // at entry), within ~$0.50 — fine for the ATR stops, and needs no extra
      // column (uses the existing positions schema as-is).
      const pos: Pos | null = row ? { optType: row.opt_type, entryMinute: 0, entryUnderlying: Number(row.strike), peakFavorable: f.close } : null;

      // Build this channel's evaluator (spec evaluators precompute over `bars`).
      const evaluate: Evaluate = code ? code.evaluate : compiled!.build(bars);
      let intent = evaluate(f, pos);

      // Premium profit/stop (compiled specs) — uses the REAL Alpaca option mark
      // (the spec's % targets are on premium; the per-bar evaluator can't see it).
      const premiumExit = compiled?.premiumExit;
      if (pos && row && alp && premiumExit && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0) {
          if (premiumExit.profitPct != null && markPx >= entryPx * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && markPx <= entryPx * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        }
      }
      // ---- reconcile: desk row OPEN but Alpaca has no such position ----
      // Happens when another channel holding the SAME 0DTE sold the netted lot,
      // on expiry, or a manual close. Close the orphan so it stops showing open
      // (valued at the last option quote — best-effort; the close already
      // happened on Alpaca). Only when the positions read succeeded.
      if (row && !alp && positionsOk) {
        const { data: q } = await sb.from("option_quotes").select("mid,bid").eq("occ_symbol", row.occ_symbol).order("captured_at", { ascending: false }).limit(1).maybeSingle();
        const mark = Number(q?.mid ?? q?.bid ?? 0); // no quote → assume worthless
        const realized = (mark - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 100;
        await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: mark, realized_pnl: realized }).eq("id", row.id);
        await journal("WARN", `${s.slug}: reconciled ${row.occ_symbol} — no Alpaca position; booked ~$${realized.toFixed(0)} at last quote (estimate)`);
        out.push({ slug: s.slug, note: "reconciled" });
        continue;
      }
      const canTrade = !guardBlocked;

      // ---- exit ----
      if (intent?.kind === "exit" && row && alp && canTrade) {
        // Sell ONLY this channel's contracts — not the whole netted Alpaca lot —
        // so one channel's exit can't flatten another channel holding the SAME
        // 0DTE (the root cause of the stuck "open" rows).
        const sellQty = Math.max(1, Math.min(Math.round(Number(alp.qty)), Number(row.qty)));
        if (!DRY_RUN) await aPost("/v2/orders", { symbol: row.occ_symbol, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${row.occ_symbol}-${etMin}-x` });
        // Per-channel realized P&L on its own qty (alp.unrealized_pl is the whole
        // netted lot — wrong when shared): (mark − entry) × qty × 100.
        const realized = (Number(alp.current_price ?? 0) - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 100;
        await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: Number(alp.current_price ?? 0), realized_pnl: realized }).eq("id", row.id);
        await journal("EXEC", `${s.slug}: exit ${row.occ_symbol} ×${sellQty} (${intent.reason})`);
      }

      // ---- entry ----
      if (intent?.kind === "enter" && !row) {
        const dir = intent.direction;
        const strike = Math.round(f.close);
        const occ = occSymbol(todayET, strike, dir);
        let blocked = guardBlocked;
        if (!blocked && armBlocked) blocked = "not_armed"; // draft/disabled → no new entries
        // Per-CHANNEL idempotency (independence): look ONLY at THIS channel's own
        // orders, tagged by a slug-prefixed client_order_id — never the shared
        // account. So another channel holding `occ` does NOT block this one.
        const myOrders = allOrders.filter((o) => String(o.client_order_id ?? "").startsWith(`${s.slug}-${occ}-`));
        if (!blocked && myOrders.some((o) => WORKING_ORDER.has(String(o.status)))) blocked = "order_working";
        // Re-buy-loop guard, per channel: if THIS channel's filled orders net to a
        // long position in `occ` but there's no open desk row, the insert was lost
        // last run — RECONSTRUCT the row from the fills instead of buying again.
        if (!blocked) {
          const filled = myOrders.filter((o) => String(o.status) === "filled");
          const net = filled.reduce((q, o) => q + (String(o.side) === "buy" ? 1 : -1) * Number(o.filled_qty ?? 0), 0);
          if (net > 0) {
            const buys = filled.filter((o) => String(o.side) === "buy");
            const totBuy = buys.reduce((q, o) => q + Number(o.filled_qty ?? 0), 0);
            const avg = totBuy ? buys.reduce((s2, o) => s2 + Number(o.filled_avg_price ?? 0) * Number(o.filled_qty ?? 0), 0) / totBuy : 0;
            await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: "SPY", expiration: todayET, strike, opt_type: dir, qty: net, avg_entry_price: avg, current_mark: avg, unrealized_pnl: 0, status: "open" });
            await journal("WARN", `${s.slug}: recovered ${net} ${occ} from filled orders (lost insert) — not re-buying`);
            blocked = "reconstructed";
          }
        }
        // Stop knob (daily_stop_usd): halt NEW entries once this channel's REALIZED
        // P&L today is at/under its loss budget. Open positions keep managing their
        // own exits — this only stops ADDING risk. (Was a no-op before.)
        if (!blocked && Number(cfg.daily_stop_usd) > 0) {
          const { data: closed } = await sb.from("positions").select("realized_pnl,closed_at").eq("strategist_id", s.id).eq("status", "closed").order("closed_at", { ascending: false }).limit(100);
          let realizedToday = 0;
          for (const c of (closed ?? [])) if (c.closed_at && etParts(Date.parse(c.closed_at as string)).date === todayET) realizedToday += Number(c.realized_pnl ?? 0);
          if (realizedToday <= -Number(cfg.daily_stop_usd)) blocked = "daily_stop";
        }
        let qty = 0, ask = 0;
        if (!blocked) {
          const { data: q } = await sb.from("option_quotes").select("ask").eq("occ_symbol", occ).order("captured_at", { ascending: false }).limit(1).maybeSingle();
          ask = Number(q?.ask ?? 0);
          if (!ask) blocked = "no_quote";
        }
        if (!blocked) {
          // INDEPENDENT per-channel allocation: this channel's slice of fund equity
          const budget = Number(account.equity) * (Number(cfg.capital_pct) / 100) * (Number(cfg.aggression) / 100);
          qty = Math.max(0, Math.min(Math.floor(budget / (ask * 100)), Number(cfg.max_contracts)));
          if (qty === 0) blocked = "insufficient_capital";
        }
        await sb.from("signals").insert({ strategist_id: s.id, signal_type: intent.reason, underlying_price: f.close, direction: dir, acted_on: !blocked, blocked_reason: blocked, rationale: { occ, ask, qty, atr: Number(f.atr.toFixed(2)), er: Number(f.er.toFixed(2)), relVol: Number(f.relVol.toFixed(2)) } });
        if (!blocked && qty > 0 && !DRY_RUN) {
          const o = await aPost("/v2/orders", { symbol: occ, qty: String(qty), side: "buy", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${occ}-${etMin}` });
          // CRITICAL: confirm the position row was recorded. A silent insert
          // failure here is what caused the re-buy loop — if it fails, journal
          // LOUD (the `already_open` guard above still prevents another buy).
          const { error: posErr } = await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: "SPY", expiration: todayET, strike, opt_type: dir, qty, avg_entry_price: ask, current_mark: ask, unrealized_pnl: 0, status: "open" });
          if (posErr) await journal("WARN", `${s.slug}: ORDER FILLED but position insert FAILED (${posErr.message}) — reconcile manually`, { occ, order_id: o.id });
          else await journal("EXEC", `${s.slug}: buy ${qty} ${occ} (${intent.reason})`, { order_id: o.id });
        }
        out.push({ slug: s.slug, dir, blocked, qty });
      } else if (row && alp) {
        // mark-to-market the open desk row
        await sb.from("positions").update({ current_mark: Number(alp.current_price ?? 0), unrealized_pnl: Number(alp.unrealized_pl ?? 0) }).eq("id", row.id);
      }
    }
    return Response.json({ ok: true, dryRun: DRY_RUN, channels: out });
  } catch (e) {
    await journal("WARN", `paper-trader(dispatcher) failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
