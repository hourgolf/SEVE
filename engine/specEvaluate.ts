// ============================================================================
//  specToEvaluate — turn a compiled StrategySpec (the .md → JSON form) into the
//  shared `Evaluate` the engine already speaks, so a spec-compiled channel is
//  indistinguishable from a hand-coded one to BOTH drivers (backtest + worker).
//
//  Only the SUPPORTED condition vocabulary is interpreted here (it maps to what
//  computeFeatures / precomputed indicators can produce). Feed-dependent kinds
//  (GEX, TICK, IV-rank, event calendar) are IGNORED — a channel is only Armable
//  when capabilityCheck() reports zero unsupported conditions, so an armed spec
//  never silently skips a gate. For the informational (non-armable) backtest the
//  gate labels the run "partial" and an entry with no supported condition at all
//  never fires (so it can't trade on thin air).
//
//  Premium-based exits (profitPct / stopPct) need the option MARK, which the
//  per-bar Evaluate doesn't see — they're extracted via specPremiumExit() and
//  applied by the driver where the quote lives (backtest sim / live worker).
//  This file is portable TS (Intl only) so it runs in Node and Deno alike.
// ============================================================================

import { ema, rsi, crossDir } from "../lib/indicators";
import type { StrategySpec, Condition, SpecEntry } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, Features, Intent, OptType, Position } from "./types";

const OPEN_RANGE_MIN = 30; // mirrors engine/engine.ts (computeFeatures' OR window)

// A registry-shaped definition built from a spec (same contract as StrategyDef).
export interface CompiledStrategy {
  slug: string;
  name: string;
  timeframeMin: number;
  warmupBars: number;
  mandate: string;
  build: (bars: Bar[], tfMin: number, levels?: { pdh?: number; pdl?: number }) => Evaluate;
}

// ---- ET wall-clock (portable: Intl works in Node + Deno) -------------------
const ET_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function etMinuteOfDay(ms: number): number {
  let h = 0;
  let m = 0;
  for (const p of ET_HM.formatToParts(new Date(ms))) {
    if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  if (h === 24) h = 0; // some envs emit "24" for midnight
  return h * 60 + m;
}
function parseET(hhmm: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Condition kinds this interpreter can actually evaluate (the rest are feed-
// dependent and ignored — see capabilityCheck in lib/desk/strategySpec.ts).
const SUPPORTED = new Set<Condition["kind"]>([
  "ma_cross", "vwap_side", "vwap_dev", "opening_range", "or_width_min",
  "rel_vol", "rsi", "time_before", "time_between",
  "efficiency_ratio", "momentum_atr",
]);

// Premium profit/stop exits (need the option mark) — applied by the driver.
export function specPremiumExit(spec: StrategySpec): { profitPct?: number; stopPct?: number } {
  const out: { profitPct?: number; stopPct?: number } = {};
  // Normalize to MAGNITUDES: the compiler may emit a stop as "-50" (the thesis
  // says "−50%") or "50". Downstream uses entry·(1 ± pct/100), so a negative
  // stopPct would invert the stop into a profit threshold. abs() makes it robust.
  for (const e of spec.exits ?? []) {
    if (out.profitPct == null && typeof e.profitPct === "number") out.profitPct = Math.abs(e.profitPct);
    if (out.stopPct == null && typeof e.stopPct === "number") out.stopPct = Math.abs(e.stopPct);
  }
  return out;
}

// Earliest time-of-day flatten across exits (minutes since ET midnight), or null.
function timeExitMinute(spec: StrategySpec): number | null {
  let best: number | null = null;
  for (const e of spec.exits ?? []) {
    if (!e.timeET) continue;
    const m = parseET(e.timeET);
    if (m != null) best = best == null ? m : Math.min(best, m);
  }
  return best;
}

// Warmup: opening range + the longest indicator lookback the spec needs.
function computeWarmup(spec: StrategySpec): number {
  let warm = OPEN_RANGE_MIN;
  for (const e of spec.entries ?? []) {
    for (const c of e.all ?? []) {
      if (c.kind === "ma_cross") warm = Math.max(warm, c.slow, c.fast);
      else if (c.kind === "rsi") warm = Math.max(warm, c.period + 1);
      else if (c.kind === "momentum_atr") warm = Math.max(warm, (c.lookback ?? 3) + 1);
      else if (c.kind === "macd") warm = Math.max(warm, c.slow + c.signal);
    }
  }
  return warm;
}

// Direction for a "both" entry: infer from the first unambiguous momentum cue.
function inferDirection(entry: SpecEntry): OptType | null {
  for (const c of entry.all ?? []) {
    if (c.kind === "ma_cross") return c.dir === "up" ? "call" : "put";
    if (c.kind === "vwap_side") return c.side === "above" ? "call" : "put";
    if (c.kind === "opening_range") return c.side === "break_above" ? "call" : "put";
    if (c.kind === "momentum_atr") return c.op === ">=" ? "call" : "put";
  }
  return null;
}

interface Ctx {
  f: Features;
  i: number;
  emaSeries: Map<number, number[]>;
  rsiSeries: Map<number, number[]>;
  etMin: number[];
  closes: number[];
  macdSeries: Map<string, number[]>; // key `${fast}-${slow}-${signal}` → histogram
  pdh?: number; // prior-day high (for `level` conditions)
  pdl?: number;
}

const macdKey = (c: { fast: number; slow: number; signal: number }) => `${c.fast}-${c.slow}-${c.signal}`;

function condHolds(c: Condition, ctx: Ctx): boolean {
  const { f, i } = ctx;
  switch (c.kind) {
    case "ma_cross": {
      const a = ctx.emaSeries.get(c.fast);
      const b = ctx.emaSeries.get(c.slow);
      if (!a || !b) return false;
      return crossDir(a, b, i) === (c.dir === "up" ? 1 : -1);
    }
    case "vwap_side":
      return c.side === "above" ? f.close > f.vwap : f.close < f.vwap;
    case "vwap_dev": {
      if (f.atr <= 0) return false;
      const dev = (f.close - f.vwap) / f.atr; // signed deviation, in ATRs
      return c.cmp === ">" ? dev >= c.atr : dev <= -c.atr;
    }
    case "opening_range": {
      // computeFeatures fixes the OR at 30m; honor side, approximate width.
      if (c.side === "break_above") return f.openRangeHi != null && f.close > f.openRangeHi;
      return f.openRangeLo != null && f.close < f.openRangeLo;
    }
    case "or_width_min": {
      if (f.openRangeHi == null || f.openRangeLo == null || f.close <= 0) return false;
      return ((f.openRangeHi - f.openRangeLo) / f.close) * 100 >= c.pct;
    }
    case "rel_vol":
      return f.relVol >= c.min;
    case "efficiency_ratio":
      return c.op === ">=" ? f.er >= c.value : f.er <= c.value;
    case "momentum_atr": {
      if (f.atr <= 0) return false;
      const lb = c.lookback ?? 3;
      const mom = i >= lb ? (ctx.closes[i] - ctx.closes[i - lb]) / f.atr : 0;
      return c.op === ">=" ? mom >= c.value : mom <= c.value;
    }
    case "macd": {
      const hist = ctx.macdSeries.get(macdKey(c));
      if (!hist) return false;
      return c.cmp === "bull" ? hist[i] > 0 : hist[i] < 0;
    }
    case "level": {
      const lvl = c.ref === "orb_hi" ? f.openRangeHi
        : c.ref === "orb_lo" ? f.openRangeLo
        : c.ref === "pdh" ? ctx.pdh
        : ctx.pdl;
      if (lvl == null || f.close <= 0) return false;
      if (c.cmp === ">") return f.close > lvl;
      if (c.cmp === "<") return f.close < lvl;
      return (Math.abs(f.close - lvl) / f.close) * 100 <= (c.withinPct ?? 0.15); // near
    }
    case "rsi": {
      const series = ctx.rsiSeries.get(c.period);
      if (!series) return false;
      const v = series[i];
      return c.cmp === ">" ? v > c.value : v < c.value;
    }
    case "time_before": {
      const t = parseET(c.et);
      return t != null && ctx.etMin[i] < t;
    }
    case "time_between": {
      const a = parseET(c.startET);
      const b = parseET(c.endET);
      return a != null && b != null && ctx.etMin[i] >= a && ctx.etMin[i] <= b;
    }
    default:
      return false; // feed-dependent kinds: handled by the caller (ignored)
  }
}

// All supported conditions of an entry hold AND it has ≥1 supported condition
// (an all-unsupported entry never fires — see header note).
function entryHolds(entry: SpecEntry, ctx: Ctx): boolean {
  let supported = 0;
  let held = 0;
  for (const c of entry.all ?? []) {
    if (!SUPPORTED.has(c.kind)) continue; // ignore feed-dependent gate
    supported++;
    if (condHolds(c, ctx)) held++;
  }
  if (supported === 0) return false;
  // Confluence: ≥ atLeast of the supported conditions (capped at how many exist);
  // omitted → strict AND (all must hold).
  const need = entry.atLeast != null ? Math.min(Math.max(1, entry.atLeast), supported) : supported;
  return held >= need;
}

// Build the per-session Evaluate for a spec (precomputes EMA/RSI over closes).
function makeSpecEvaluator(spec: StrategySpec, bars: Bar[], _tfMin: number, levels?: { pdh?: number; pdl?: number }): Evaluate {
  const closes = bars.map((b) => b.close);
  const emaSeries = new Map<number, number[]>();
  const rsiSeries = new Map<number, number[]>();
  const macdSeries = new Map<string, number[]>();
  for (const e of spec.entries ?? []) {
    for (const c of e.all ?? []) {
      if (c.kind === "ma_cross") {
        if (!emaSeries.has(c.fast)) emaSeries.set(c.fast, ema(closes, c.fast));
        if (!emaSeries.has(c.slow)) emaSeries.set(c.slow, ema(closes, c.slow));
      } else if (c.kind === "rsi" && !rsiSeries.has(c.period)) {
        rsiSeries.set(c.period, rsi(closes, c.period));
      } else if (c.kind === "macd" && !macdSeries.has(macdKey(c))) {
        const fa = ema(closes, c.fast), sl = ema(closes, c.slow);
        const line = closes.map((_, i) => fa[i] - sl[i]);
        const sig = ema(line, c.signal);
        macdSeries.set(macdKey(c), line.map((v, i) => v - sig[i])); // histogram
      }
    }
  }
  const etMin = bars.map((b) => etMinuteOfDay(b.ts));
  const warmup = computeWarmup(spec);
  const timeExit = timeExitMinute(spec);
  const entries = spec.entries ?? [];

  return (f: Features, pos: Position | null): Intent => {
    const i = f.minute;
    const ctx: Ctx = { f, i, emaSeries, rsiSeries, etMin, closes, macdSeries, pdh: levels?.pdh, pdl: levels?.pdl };

    // ---- exits (premium profit/stop handled by the driver) ----
    if (pos) {
      if (f.minutesToClose <= 1) return { kind: "exit", reason: "eod_flatten" };
      if (timeExit != null && etMin[i] >= timeExit) return { kind: "exit", reason: "time_exit" };
      return null;
    }

    // ---- entries ----
    if (i < warmup) return null;
    if (f.atr <= 0) return null;
    for (const e of entries) {
      if (!entryHolds(e, ctx)) continue;
      const dir: OptType | null = e.direction === "both" ? inferDirection(e) : e.direction;
      if (!dir) continue; // "both" with no directional cue → skip
      return { kind: "enter", direction: dir, reason: e.reason || `${spec.meta.strategyId}_entry` };
    }
    return null;
  };
}

// StrategySpec → a registry-shaped CompiledStrategy (slug/name/build/…).
export function specToStrategyDef(spec: StrategySpec): CompiledStrategy {
  return {
    slug: spec.meta.strategyId,
    name: spec.meta.name,
    timeframeMin: 1, // the desk's mandate edges all run on 1-min SPY bars
    warmupBars: computeWarmup(spec),
    mandate: spec.meta.regime || spec.meta.direction || "compiled spec",
    build: (bars, tfMin, levels) => makeSpecEvaluator(spec, bars, tfMin, levels),
  };
}
