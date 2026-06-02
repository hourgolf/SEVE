// ⚑ WORKER VERSION: 2026-06-02b  (POWER giveback trail: once a power position has
//   been up ≥+100%, lock gains by exiting on a >40% giveback of the peak gain —
//   engaged only after +100% so it never clips power's early convexity (the early
//   scale-outs the A/B rejected are NOT used). Peak premium reconstructed from
//   option_quotes (no schema change). Backtested tail-safe on real NBBO
//   (engine/power-probe.ts: +70% totalPnl, −23% DD). Power-only. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-02a  (STATE-PARITY FIX: per-minute position state is
//   now rebuilt from the session bars to match the engine — entryUnderlying =
//   actual close at the entry bar (was the rounded strike, ±$0.50 > grind's
//   0.5–0.6·ATR stop → grind insta-exited within a minute), and peakFavorable =
//   the running best/worst close since entry (was reset to the current close every
//   run → breakout's 1.5·ATR trailing stop could NEVER fire → winners only exited
//   on EOD/failed-break). No schema change. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-01i  (cost gate RECALIBRATED to real SPY-0DTE fills —
//   slippage 1→0.25 tick (a market order fills ~at the NBBO; the old 1-tick was a
//   backtest default that DOUBLED the cost on tight-spread setups and blocked ~90%
//   on low-ATR days) + ATM δ proxy 0.5→0.55 (live MarketData.app Greeks) ·
//   compiled-spec warmup FLOOR lowered 30→15 bars, in
//   sync with engine WARMUP_FLOOR — faster/opening-period .md strategies no longer
//   wait the full opening-range window (OR-based conditions still self-gate) ·
//   per-channel ISOLATION — one channel's throw can no longer abort the whole run ·
//   compiled-spec interpreter FULL-PARITY
//   with engine/specEvaluate.ts: efficiency_ratio · momentum_atr · macd · level
//   (pdh/pdl/orb) · atLeast confluence · cost gate EXEMPTS power · premium
//   catastrophic stop · real entry-time time-stops · 0DTE→1DTE roll · order
//   resilience · channel independence · reconciliation). If the function deployed in
//   Supabase does NOT show THIS version line at the top, the paste is stale — re-copy.
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
//    - 0DTE→1DTE ROLL: Alpaca rejects OPENING a 0DTE within ~15 min of close
//      (the 422). Inside that cutoff, channels roll new entries to the next
//      expiry (1DTE, resolved from the live chain) so the signal still fills; a
//      1DTE+ position is then allowed to ride overnight (its own stops still fire
//      and it can sell before close — only 0DTE gets the forced EOD flatten).
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

// ---- smart-layer guards (mirror engine/cost.ts + engine/manage.ts) ----------
// The A/B on REAL option_bars said: scale-outs/breakeven/trail HURT (they cap the
// 0DTE convex tail), but two pieces help — so ONLY these two are wired live:
//   (1) the COST GATE (entry veto; cut grind's churn 2263→125 positions), and
//   (2) the PREMIUM CATASTROPHIC STOP (exit; caps losers the ATR stops miss).
// Both are tunable consts. The worker has BETTER data than the backtest: the live
// option_quotes carry REAL bid+ask (+ a modeled delta) and features give ATR.
const COST_GATE_RATIO = 3.0;          // block if expectedMove < RATIO × roundTripCost
// Channels EXEMPT from the cost gate. The gate's expected-move (delta·ATR·100)
// assumes a ~linear move, so it can't see GAMMA convexity — and a real-fills probe
// (engine/power-probe.ts) showed it vetoes ~⅔ of power's final-hour entries, which
// were net +$1.1k profitable (power base −$443 → +gate −$1500). The gate is right
// for the scalper (grind) it was built for; power's edge IS the convex tail.
const COST_GATE_EXEMPT = new Set(["power"]);
const PREMIUM_STOP_PCT = 50;          // exit any open position marked ≤ −50% from entry
// POWER late-engaged giveback trail (backtested tail-safe — engine/power-probe.ts on
// real NBBO): once a power position has EVER been up ≥ +100% (the option doubled),
// LOCK gains by exiting if it gives back > 40% of its peak gain. Engaged ONLY after
// +100% so it never clips power's early convexity — the early scale-outs the
// smart-layer A/B rejected are deliberately NOT used. Power-only for now. The probe
// (64 real-NBBO days): +70% totalPnl, −23% drawdown vs base, ~19% smaller avgWin.
const POWER_TRAIL_CHANNELS = new Set(["power"]);
const POWER_TRAIL_ENGAGE_MULT = 2.0;  // engage once the mark has reached entry × this (+100%)
const POWER_TRAIL_GIVEBACK_PCT = 40;  // exit if it gives back > this % of the peak gain
const ATM_DELTA = 0.55;               // ATM 0DTE delta proxy (live MarketData.app: 758C δ≈0.567) when quote has none
const TICK = 0.01;
// Slippage the COST GATE assumes per side. A liquid SPY 0DTE market order fills ~at
// the NBBO, so real slippage beyond the spread is ~0 — the old 1-tick ($1/side) was a
// backtest default that DOUBLED the round-trip cost on 1¢-spread setups (the cheapest,
// best ones) and blocked ~90% of entries on low-ATR days. 0.25 tick is a small buffer.
const SLIPPAGE_TICKS_PER_SIDE = 0.25;
const COMMISSION_PER_CONTRACT = 0.04; // Alpaca reg pass-through per side (not a commission)

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

// ---- compiled-spec interpreter (FULL MIRROR of engine/specEvaluate.ts) ------
// A channel added via the dashboard has no REGISTRY entry — it carries a compiled
// StrategySpec (spec_json). This turns that spec into the SAME Evaluate the engine
// produces, over the SAME supported vocabulary (ma_cross/vwap_side/vwap_dev/
// opening_range/or_width_min/rel_vol/rsi/time_*/efficiency_ratio/momentum_atr/
// macd/level) WITH `atLeast` confluence — so a backtest-gated spec trades live
// IDENTICALLY. Live posture is STRICT: any unsupported/unknown condition makes the
// entry not fire (never trade an unevaluated gate) — armed channels are
// capability-checked, so this is defensive. KEEP IN SYNC with engine/specEvaluate.ts.
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
// Full parity with engine/specEvaluate.ts SUPPORTED — keep these in sync (the
// capabilityCheck in lib/desk/strategySpec.ts is the arm gate; a kind it deems
// armable MUST be runnable here, or a channel arms and silently never trades).
const SPEC_SUPPORTED = new Set(["ma_cross","vwap_side","vwap_dev","opening_range","or_width_min","rel_vol","rsi","time_before","time_between","efficiency_ratio","momentum_atr","macd","level"]);
const macdKey = (c: Spec) => `${c.fast}-${c.slow}-${c.signal}`;

interface CompiledSpec { build: (bars: Bar[], levels?: { pdh?: number; pdl?: number }) => Evaluate; tf: number; warmup: number; premiumExit: { profitPct?: number; stopPct?: number }; }
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
  let warmup = 15; // warmup FLOOR (was 30) — sync with engine/specEvaluate.ts WARMUP_FLOOR.
  for (const e of entries) for (const c of (e.all ?? [])) {
    if (c.kind === "ma_cross") warmup = Math.max(warmup, c.slow, c.fast);
    else if (c.kind === "rsi") warmup = Math.max(warmup, c.period + 1);
    else if (c.kind === "momentum_atr") warmup = Math.max(warmup, (c.lookback ?? 3) + 1);
    else if (c.kind === "macd") warmup = Math.max(warmup, c.slow + c.signal);
  }
  const build = (bars: Bar[], levels?: { pdh?: number; pdl?: number }): Evaluate => {
    const closes = bars.map((b) => b.close);
    const emaS = new Map<number, number[]>(), rsiS = new Map<number, number[]>(), macdS = new Map<string, number[]>();
    for (const e of entries) for (const c of (e.all ?? [])) {
      if (c.kind === "ma_cross") { if (!emaS.has(c.fast)) emaS.set(c.fast, emaArr(closes, c.fast)); if (!emaS.has(c.slow)) emaS.set(c.slow, emaArr(closes, c.slow)); }
      else if (c.kind === "rsi" && !rsiS.has(c.period)) rsiS.set(c.period, rsiArr(closes, c.period));
      else if (c.kind === "macd" && !macdS.has(macdKey(c))) { const fa = emaArr(closes, c.fast), sl = emaArr(closes, c.slow); const line = closes.map((_, i) => fa[i] - sl[i]); const sig = emaArr(line, c.signal); macdS.set(macdKey(c), line.map((v, i) => v - sig[i])); }
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
        case "efficiency_ratio": return c.op === ">=" ? f.er >= c.value : f.er <= c.value;
        case "momentum_atr": { if (f.atr <= 0) return false; const lb = c.lookback ?? 3; const mom = i >= lb ? (closes[i] - closes[i - lb]) / f.atr : 0; return c.op === ">=" ? mom >= c.value : mom <= c.value; }
        case "macd": { const h = macdS.get(macdKey(c)); if (!h) return false; return c.cmp === "bull" ? h[i] > 0 : h[i] < 0; }
        case "level": { const lvl = c.ref === "orb_hi" ? f.openRangeHi : c.ref === "orb_lo" ? f.openRangeLo : c.ref === "pdh" ? levels?.pdh : levels?.pdl; if (lvl == null || f.close <= 0) return false; if (c.cmp === ">") return f.close > lvl; if (c.cmp === "<") return f.close < lvl; return (Math.abs(f.close - lvl) / f.close) * 100 <= (c.withinPct ?? 0.15); }
        case "rsi": { const s = rsiS.get(c.period); if (!s) return false; return c.cmp === ">" ? s[i] > c.value : s[i] < c.value; }
        case "time_before": { const t = parseET(c.et); return t != null && etMin[i] < t; }
        case "time_between": { const a = parseET(c.startET), b = parseET(c.endET); return a != null && b != null && etMin[i] >= a && etMin[i] <= b; }
        default: return false;
      }
    };
    // Confluence: fire on ≥ `atLeast` of the conditions (capped at the count), else
    // strict AND. STRICT live posture: an unsupported (feed-dependent) gate makes
    // the entry NOT fire — never trade an unevaluated rule. Armed channels are
    // capability-checked (zero unsupported), so this only guards a force-armed spec.
    const entryHolds = (e: Spec, f: Features, i: number): boolean => {
      const all = e.all ?? []; if (!all.length) return false;
      for (const c of all) if (!SPEC_SUPPORTED.has(c.kind)) return false;
      let held = 0; for (const c of all) if (cond(c, f, i)) held++;
      const need = e.atLeast != null ? Math.min(Math.max(1, e.atLeast), all.length) : all.length;
      return held >= need;
    };
    const infer = (e: Spec): OptType | null => {
      for (const c of (e.all ?? [])) {
        if (c.kind === "ma_cross") return c.dir === "up" ? "call" : "put";
        if (c.kind === "vwap_side") return c.side === "above" ? "call" : "put";
        if (c.kind === "opening_range") return c.side === "break_above" ? "call" : "put";
        if (c.kind === "momentum_atr") return c.op === ">=" ? "call" : "put";
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
async function aPost(path: string, body: unknown) { const r = await fetch(PAPER + path, { method: "POST", headers: { ...aHdr, "content-type": "application/json" }, body: JSON.stringify(body) }); const text = await r.text(); if (!r.ok) throw new Error(`${r.status} POST ${path}: ${text.slice(0, 300)}`); return text ? JSON.parse(text) : {}; }
async function journal(level: string, message: string, meta?: unknown) { try { await sb.from("events").insert({ level, message, meta: meta ?? null }); } catch { /* */ } }
function occSymbol(etDate: string, strike: number, type: OptType) { const [y, m, d] = etDate.split("-"); return `SPY${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`; }
function aggregate(bars: Bar[], tf: number): Bar[] {
  if (tf <= 1) return bars;
  const out: Bar[] = []; let bk = -1;
  for (const b of bars) { const ms = Math.floor(b.ts / (tf * 60000)) * (tf * 60000); if (ms !== bk) { out.push({ ...b, ts: ms }); bk = ms; } else { const c = out[out.length - 1]; c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close; c.volume += b.volume; } }
  return out;
}
function etParts(ms: number) { const d = new Date(ms); const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })); return { min: et.getHours() * 60 + et.getMinutes(), date: `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}` }; }

// Effective spread (premium $/share): REAL bid/ask when usable, else modeled at
// 3% (floor $0.03). Mirrors engine/cost.ts effSpread.
function effSpreadPremium(bid: number, ask: number): number {
  if (ask > bid && bid > 0) return ask - bid;
  const mid = (ask + bid) / 2 > 0 ? (ask + bid) / 2 : ask;
  return Math.max(0.03, mid * 0.03);
}
// Round-trip cost ($/contract): both sides' half-spread + slippage + commission.
// Mirrors engine/cost.ts roundTripCostUsd, but feeds it the worker's REAL bid/ask.
function roundTripCostUsd(bid: number, ask: number): number {
  const spread = effSpreadPremium(bid, ask);
  const edgePerSideUsd = (spread / 2) * 100 + SLIPPAGE_TICKS_PER_SIDE * TICK * 100;
  return edgePerSideUsd * 2 + COMMISSION_PER_CONTRACT * 2;
}

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

    // Prior trading day's high/low — for compiled-spec `level` conditions
    // (ref:pdh/pdl). all1m holds ~2+ sessions, so the day before today is covered.
    let pdh: number | undefined, pdl: number | undefined;
    {
      const dayHL = new Map<string, { hi: number; lo: number }>();
      for (const b of all1m) {
        const d = etParts(b.ts).date;
        const e = dayHL.get(d);
        if (!e) dayHL.set(d, { hi: b.high, lo: b.low });
        else { e.hi = Math.max(e.hi, b.high); e.lo = Math.min(e.lo, b.low); }
      }
      const priors = [...dayHL.keys()].filter((d) => d < todayET).sort();
      const prior = priors.length ? dayHL.get(priors[priors.length - 1]) : undefined;
      if (prior) { pdh = prior.hi; pdl = prior.lo; }
    }

    // Alpaca rejects OPENING a 0DTE position within ~15 min of close — that was
    // the 422. So inside the cutoff, channels roll new entries to the next expiry
    // (1DTE) instead of losing the signal. Resolve that expiry from the live chain
    // (the ingest captures today + the next session), so we never guess a holiday.
    const OPEN_0DTE_CUTOFF_MIN = 16; // last ~15 min + 1 buffer
    let next1DTE: string | null = null;
    {
      const { data: exps } = await sb.from("option_quotes").select("expiration").gt("expiration", todayET).order("expiration", { ascending: true }).limit(1);
      next1DTE = ((exps ?? [])[0] as { expiration?: string } | undefined)?.expiration ?? null;
    }

    // fund-level equity snapshot
    await sb.from("equity_snapshots").insert({ strategist_id: null, net_liquidation: Number(account.equity), cash: Number(account.cash), unrealized_pnl: positions.reduce((a, p) => a + Number(p.unrealized_pl ?? 0), 0) });

    const out: Record<string, unknown>[] = [];
    for (const s of (strategists ?? [])) {
     // Per-channel isolation: a throw in compileSpec/build/evaluate (e.g. a malformed
     // armed spec_json) for ONE channel must NOT abort the whole run — every other
     // channel would be skipped that minute. Journal it and move on. (Body kept at its
     // original indent to keep the diff minimal; the try just brackets the iteration.)
     try {
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
      // Reconstruct the REAL entry bar index from opened_at (was hardcoded 0 — so
      // time-stops measured from bar 0 and fired on the FIRST evaluation = churn,
      // and no position could truly be held). A position opened before today's
      // first bar (a 1DTE held overnight) resolves to index 0 → its time-stop trips
      // at the next session's open and winds it down, which is what we want.
      let entryMinute = i; // default: brand-new this run
      if (row?.opened_at) {
        const entryMs = Date.parse(String(row.opened_at));
        const idx = bars.findIndex((b) => b.ts >= entryMs);
        entryMinute = idx >= 0 ? idx : i;
      }
      // STATE PARITY with the engine (was the cause of two live-only bugs):
      //   • entryUnderlying was the ROUNDED strike — off by up to $0.50, LARGER
      //     than grind's 0.5–0.6·ATR target/stop on 1-min ATR (~$0.08–0.24), so
      //     grind booked target/stop on the entry-rounding within a minute (the
      //     "holds ~1 min, tiny gain/loss" behavior). Use the actual close at the
      //     entry bar instead.
      //   • peakFavorable was reset to f.close every run → breakout's trail test
      //     (close < peak − 1.5·ATR) was ALWAYS false → the trailing stop never
      //     fired and winners only exited on EOD/failed-break. Rebuild the running
      //     peak (best/worst close since entry) like simulateSession does.
      // Both derive from the session bars + reconstructed entryMinute — NO schema
      // change. (A position carried overnight resolves entryMinute→0, so these span
      // this session's open onward — the engine also resets its peak per session.)
      let entryUnderlying = Number(row?.strike ?? f.close);
      let peakFavorable = f.close;
      if (row && entryMinute >= 0 && entryMinute < bars.length) {
        entryUnderlying = bars[entryMinute].close;
        peakFavorable = bars[entryMinute].close;
        for (let j = entryMinute; j <= i; j++) {
          peakFavorable = row.opt_type === "call" ? Math.max(peakFavorable, bars[j].close) : Math.min(peakFavorable, bars[j].close);
        }
      }
      const pos: Pos | null = row ? { optType: row.opt_type, entryMinute, entryUnderlying, peakFavorable } : null;

      // Build this channel's evaluator (spec evaluators precompute over `bars`;
      // pass prior-day levels for `level` pdh/pdl conditions).
      const evaluate: Evaluate = code ? code.evaluate : compiled!.build(bars, { pdh, pdl });
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
      // A 1DTE+ position may ride OVERNIGHT — don't force the 0DTE EOD flatten on
      // it. Its own stops/targets still fire (the strategy can still sell before
      // the close); tomorrow it's managed as a 0DTE. Only forced-flatten 0DTE.
      if (intent?.kind === "exit" && intent.reason === "eod_flatten" && row && String(row.expiration ?? todayET) > todayET) {
        intent = null;
      }

      // ---- PREMIUM CATASTROPHIC STOP (all channels) ----
      // A hard backstop the built-ins' ATR/structural stops lack: if the option's
      // REAL Alpaca mark has cratered ≥ PREMIUM_STOP_PCT% below entry, exit now —
      // whatever the channel's own evaluator says. Applies to code AND compiled
      // channels, and to a 1DTE held overnight (a cratered option is still
      // cratered). A genuine exit already in `intent` (incl. a compiled spec's own
      // tighter stop_premium) wins on its own — this only fires when nothing else
      // would exit. From the A/B verdict: caps the losers the ATR stops miss.
      if (pos && row && alp && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0 && markPx <= entryPx * (1 - PREMIUM_STOP_PCT / 100)) {
          intent = { kind: "exit", reason: "premium_stop" };
        }
      }

      // ---- POWER giveback trail (lock gains after +100%) ----
      // Tail-safe: engages only after the option doubled, then exits on a > 40%
      // giveback of the peak GAIN. The peak premium is reconstructed from the
      // option_quotes per-minute mark history (no schema change — same approach as
      // the underlying-peak fix). Power-only; mirrors manage.ts premium_giveback
      // with the engage-at-+100% trigger that power-probe found tail-safe.
      if (pos && row && alp && POWER_TRAIL_CHANNELS.has(s.slug) && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0) {
          const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", row.occ_symbol).gte("captured_at", row.opened_at).order("mid", { ascending: false }).limit(1).maybeSingle();
          const peak = Math.max(markPx, Number(pk?.mid ?? 0));
          if (peak >= entryPx * POWER_TRAIL_ENGAGE_MULT) {            // ever reached +100% → trail engaged
            const givebackLevel = entryPx + (peak - entryPx) * (1 - POWER_TRAIL_GIVEBACK_PCT / 100);
            if (markPx <= givebackLevel) intent = { kind: "exit", reason: "trail_giveback" };
          }
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
        try {
          if (!DRY_RUN) await aPost("/v2/orders", { symbol: row.occ_symbol, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${row.occ_symbol}-${etMin}-x` });
          // Per-channel realized P&L on its own qty (alp.unrealized_pl is the whole
          // netted lot — wrong when shared): (mark − entry) × qty × 100.
          const realized = (Number(alp.current_price ?? 0) - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 100;
          await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: Number(alp.current_price ?? 0), realized_pnl: realized }).eq("id", row.id);
          await journal("EXEC", `${s.slug}: exit ${row.occ_symbol} ×${sellQty} (${intent.reason})`);
        } catch (e) {
          // One rejected order must NOT crash the whole run — journal the Alpaca
          // reason and leave the row open to retry next minute.
          await journal("WARN", `${s.slug}: exit ${row.occ_symbol} rejected — ${(e as Error).message}`);
        }
      }

      // ---- entry ----
      if (intent?.kind === "enter" && !row) {
        const dir = intent.direction;
        const strike = Math.round(f.close);
        // Alpaca won't let us OPEN a 0DTE inside the close cutoff → roll the entry
        // to the next expiry (1DTE) so the signal still gets acted on. Otherwise
        // use today (0DTE). entryExpiry drives both the OCC symbol and the row.
        const inCutoff = minutesToClose <= OPEN_0DTE_CUTOFF_MIN;
        const entryExpiry = inCutoff ? next1DTE : todayET;
        const occ = occSymbol(entryExpiry ?? todayET, strike, dir);
        let blocked = guardBlocked;
        if (!blocked && armBlocked) blocked = "not_armed"; // draft/disabled → no new entries
        if (!blocked && !entryExpiry) blocked = "no_1dte_chain"; // in cutoff but no next expiry quoted
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
            await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: "SPY", expiration: entryExpiry ?? todayET, strike, opt_type: dir, qty: net, avg_entry_price: avg, current_mark: avg, unrealized_pnl: 0, status: "open" });
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
        let qty = 0, ask = 0, bid = 0, delta = ATM_DELTA, roundTrip = 0, expectedMove = 0;
        if (!blocked) {
          const { data: q } = await sb.from("option_quotes").select("ask,bid,delta").eq("occ_symbol", occ).order("captured_at", { ascending: false }).limit(1).maybeSingle();
          ask = Number(q?.ask ?? 0);
          bid = Number(q?.bid ?? 0);
          if (q?.delta != null && Number(q.delta) !== 0) delta = Math.abs(Number(q.delta)); // puts carry δ<0; magnitude is what we want
          if (!ask) blocked = "no_quote";
        }
        // COST GATE (entry veto): the dominant 0DTE cost is the round-trip spread.
        // Block an entry whose expected premium move on a ~1·ATR favorable move
        // doesn't clear that cost by COST_GATE_RATIO. Uses the REAL bid/ask + the
        // quote's delta (ATM 0.5 proxy when absent). Mirrors engine/manage.ts
        // costGatePass — this is what cut grind's churn in the A/B. EXEMPT for
        // gamma-convex channels (see COST_GATE_EXEMPT) where it kills the edge.
        if (!blocked && !COST_GATE_EXEMPT.has(s.slug)) {
          roundTrip = roundTripCostUsd(bid, ask);
          expectedMove = delta * Math.max(0, f.atr) * 100;
          if (expectedMove < COST_GATE_RATIO * roundTrip) blocked = "cost_gate";
        }
        if (!blocked) {
          // INDEPENDENT per-channel allocation: this channel's slice of fund equity
          const budget = Number(account.equity) * (Number(cfg.capital_pct) / 100) * (Number(cfg.aggression) / 100);
          qty = Math.max(0, Math.min(Math.floor(budget / (ask * 100)), Number(cfg.max_contracts)));
          if (qty === 0) blocked = "insufficient_capital";
        }
        await sb.from("signals").insert({ strategist_id: s.id, signal_type: intent.reason, underlying_price: f.close, direction: dir, acted_on: !blocked, blocked_reason: blocked, rationale: { occ, ask, bid, qty, delta: Number(delta.toFixed(3)), roundTrip: Number(roundTrip.toFixed(2)), expectedMove: Number(expectedMove.toFixed(2)), atr: Number(f.atr.toFixed(2)), er: Number(f.er.toFixed(2)), relVol: Number(f.relVol.toFixed(2)) } });
        if (!blocked && qty > 0 && !DRY_RUN) {
          try {
            const o = await aPost("/v2/orders", { symbol: occ, qty: String(qty), side: "buy", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${occ}-${etMin}` });
            // CRITICAL: confirm the position row was recorded. A silent insert
            // failure here is what caused the re-buy loop — if it fails, journal
            // LOUD (the per-channel guards above still prevent another buy).
            const { error: posErr } = await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: "SPY", expiration: entryExpiry ?? todayET, strike, opt_type: dir, qty, avg_entry_price: ask, current_mark: ask, unrealized_pnl: 0, status: "open" });
            if (posErr) await journal("WARN", `${s.slug}: ORDER FILLED but position insert FAILED (${posErr.message}) — reconcile manually`, { occ, order_id: o.id });
            else await journal("EXEC", `${s.slug}: buy ${qty} ${occ} (${intent.reason})`, { order_id: o.id });
          } catch (e) {
            // Order rejected (e.g. Alpaca 422) — journal the reason, don't crash
            // the run or insert a phantom position; just record the blocked signal.
            await journal("WARN", `${s.slug}: buy ${occ} rejected — ${(e as Error).message}`);
          }
        }
        out.push({ slug: s.slug, dir, blocked, qty });
      } else if (row && alp) {
        // mark-to-market the open desk row
        await sb.from("positions").update({ current_mark: Number(alp.current_price ?? 0), unrealized_pnl: Number(alp.unrealized_pl ?? 0) }).eq("id", row.id);
      }
     } catch (chErr) {
       // Isolate this channel's failure; the rest of the fleet still runs this minute.
       await journal("WARN", `dispatcher: channel ${(s as { slug?: string }).slug ?? "?"} failed — ${(chErr as Error).message}`);
       out.push({ slug: (s as { slug?: string }).slug, note: "error", error: (chErr as Error).message });
     }
    }
    return Response.json({ ok: true, dryRun: DRY_RUN, channels: out });
  } catch (e) {
    await journal("WARN", `paper-trader(dispatcher) failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
