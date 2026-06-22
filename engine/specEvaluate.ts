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

import { ema, sma, rsi, crossDir } from "../lib/indicators";
import { pinBar, engulfing, strongTrendBar, sessionSince, curlUp, rolloverDown, rangeCompression, rangeBreakoutDirection } from "./candle-shapes";
import type { StrategySpec, Condition, SpecEntry, SpecLeg } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, Features, Intent, OptType, Position } from "./types";

// Warmup floor (bars) before a compiled spec may fire. Lowered 30 → 15 so faster /
// opening-period strategies aren't forced to wait the full 30-min opening range. NOTE
// OR-based conditions still self-gate: computeFeatures sets the 30-min opening range
// only at bar 29, so opening_range / or_width_min / level:orb_* stay false until then
// regardless of this floor. Early relVol(20)/ER(30) are still half-formed — a spec
// leaning on them before ~20 bars is noisier (the cost gate filters wide-spread opens).
const WARMUP_FLOOR = 15;

// A registry-shaped definition built from a spec (same contract as StrategyDef).
export interface CompiledStrategy {
  slug: string;
  name: string;
  timeframeMin: number;
  warmupBars: number;
  mandate: string;
  build: (bars: Bar[], tfMin: number, levels?: { pdh?: number; pdl?: number; gap?: number; customLevels?: number[] }) => Evaluate;
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
  "ma_cross", "vwap_side", "trend_align", "vwap_dev", "opening_range", "or_width_min", "gap_min",
  "rel_vol", "rsi", "time_before", "time_between",
  "efficiency_ratio", "momentum_atr", "macd", "level",
  "pin_bar", "engulfing", "strong_trend", "stale_extreme",
  "curl", "range_break", "sma_cross",
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
// All conditions an entry references: the mandatory `all` block + the optional
// `anyOf.of` pool. Used by every scan that must see ALL conditions (warmup,
// indicator precompute, direction inference) — entryHolds keeps them separate.
function entryConds(e: SpecEntry): Condition[] {
  return [...(e.all ?? []), ...(e.anyOf?.of ?? [])];
}

function computeWarmup(spec: StrategySpec): number {
  let warm = WARMUP_FLOOR;
  for (const e of spec.entries ?? []) {
    for (const c of entryConds(e)) {
      if (c.kind === "ma_cross") warm = Math.max(warm, c.slow, c.fast);
      else if (c.kind === "trend_align") warm = Math.max(warm, c.ref === "ema50" ? 50 : 21);
      else if (c.kind === "rsi") warm = Math.max(warm, c.period + 1);
      else if (c.kind === "momentum_atr") warm = Math.max(warm, (c.lookback ?? 3) + 1);
      else if (c.kind === "macd") warm = Math.max(warm, c.slow + c.signal);
      else if (c.kind === "sma_cross") warm = Math.max(warm, c.slow ?? 120);
      else if (c.kind === "range_break") warm = Math.max(warm, (c.bars ?? 8) + 1);
      else if (c.kind === "curl") warm = Math.max(warm, c.bars ?? 7);
    }
  }
  return warm;
}

// Direction for a "both" entry: infer from the first unambiguous momentum cue.
function inferDirection(entry: SpecEntry): OptType | null {
  for (const c of entryConds(entry)) {
    if (c.kind === "ma_cross") return c.dir === "up" ? "call" : "put";
    if (c.kind === "vwap_side") return c.side === "above" ? "call" : "put";
    if (c.kind === "trend_align") return c.side === "up" ? "call" : "put";
    if (c.kind === "opening_range") return c.side === "break_above" ? "call" : "put";
    if (c.kind === "momentum_atr") return c.op === ">=" ? "call" : "put";
    if (c.kind === "pin_bar" || c.kind === "engulfing" || c.kind === "strong_trend" || c.kind === "stale_extreme"
      || c.kind === "curl" || c.kind === "range_break" || c.kind === "sma_cross")
      return c.dir === "up" ? "call" : "put";
  }
  return null;
}

interface Ctx {
  f: Features;
  i: number;
  emaSeries: Map<number, number[]>;
  rsiSeries: Map<number, number[]>;
  smaSeries: Map<number, number[]>; // for sma_cross (SMA fast/slow)
  etMin: number[];
  closes: number[];
  bars: Bar[]; // raw OHLC (for candle-shape conditions)
  sinceHod: number[]; // bars since session HOD per index (for stale_extreme)
  sinceLod: number[];
  macdSeries: Map<string, number[]>; // key `${fast}-${slow}-${signal}` → histogram
  macdLineSeries: Map<string, number[]>; // same key → macd LINE (for macd mode:"state")
  pdh?: number; // prior-day high (for `level` conditions)
  pdl?: number;
  customLevels?: number[]; // injected level set for level{ref:"custom"} (replication head-to-heads)
  gap?: number; // signed overnight gap % ((open − priorClose)/priorClose·100); session constant (for `gap_min`)
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
    case "trend_align": {
      // persistent trend STATE (every bar). ribbon (default) = EMA9 vs EMA21 (pb-ride's filter);
      // ema21/ema50 = close vs that EMA. Computed EMA → faithful live (no vwap-bug). Fail-closed.
      const up = c.side === "up";
      if (c.ref === "ema21" || c.ref === "ema50") {
        const e = ctx.emaSeries.get(c.ref === "ema21" ? 21 : 50);
        return e ? (up ? f.close > e[ctx.i] : f.close < e[ctx.i]) : false;
      }
      const e9 = ctx.emaSeries.get(9), e21 = ctx.emaSeries.get(21);
      return e9 && e21 ? (up ? e9[ctx.i] > e21[ctx.i] : e9[ctx.i] < e21[ctx.i]) : false;
    }
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
    case "gap_min":
      // overnight gap regime (gap-gate-verdict): trade only on days with a catalyst-sized
      // gap; flat-open days are chop-prone and bleed. MAGNITUDE (direction is noise). A
      // session constant → gates the whole day. No gap data (first session) ⇒ false (stand down).
      return ctx.gap != null && Math.abs(ctx.gap) >= c.pct;
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
      if (c.mode === "state") { // nakamoto macdState: (sign & line-slope agree) OR fresh cross ≤3 bars
        const line = ctx.macdLineSeries.get(macdKey(c));
        if (!line || i < 29) return false; // needs ≥30 bars (his guard)
        const sign = hist[i] > 0.005 ? 1 : hist[i] < -0.005 ? -1 : 0;
        const slope = i >= 1 ? line[i] - line[i - 1] : 0;
        const inLong = sign > 0 && slope > 0, inShort = sign < 0 && slope < 0;
        let bsc = 999, cdir = 0;
        for (let j = i; j > 0; j--) if ((hist[j] > 0) !== (hist[j - 1] > 0)) { bsc = i - j; cdir = hist[j] > 0 ? 1 : -1; break; }
        const freshUp = cdir === 1 && bsc <= 3, freshDown = cdir === -1 && bsc <= 3;
        return c.cmp === "bull" ? (inLong || freshUp) : (inShort || freshDown);
      }
      return c.cmp === "bull" ? hist[i] > 0 : hist[i] < 0;
    }
    case "level": {
      if (c.ref === "custom") { // near-only against the injected level SET (his $1.00 proximity)
        const set = ctx.customLevels;
        if (!set || !set.length || f.close <= 0) return false;
        const d = c.withinDollars ?? 1.0;
        return set.some((L) => Math.abs(f.close - L) <= d);
      }
      const lvl = c.ref === "orb_hi" ? f.openRangeHi
        : c.ref === "orb_lo" ? f.openRangeLo
        : c.ref === "pdh" ? ctx.pdh
        : ctx.pdl;
      if (lvl == null || f.close <= 0) return false;
      if (c.cmp === ">") return f.close > lvl;
      if (c.cmp === "<") return f.close < lvl;
      return c.withinDollars != null
        ? Math.abs(f.close - lvl) <= c.withinDollars
        : (Math.abs(f.close - lvl) / f.close) * 100 <= (c.withinPct ?? 0.15); // near
    }
    case "pin_bar":
      return pinBar(ctx.bars[i], c.dir);
    case "engulfing":
      return i > 0 && engulfing(ctx.bars[i - 1], ctx.bars[i], c.dir);
    case "strong_trend":
      return strongTrendBar(ctx.bars[i], c.dir);
    case "stale_extreme": {
      if (i + 1 < 12) return false; // needs ≥12 RTH bars (nakamoto gate)
      const since = c.dir === "up" ? ctx.sinceHod[i] : ctx.sinceLod[i];
      return since >= (c.sinceMin ?? 6);
    }
    case "curl": {
      const prefix = ctx.bars.slice(0, i + 1); // only bars up to now (causal)
      return c.dir === "up" ? curlUp(prefix, c.bars ?? 7) : rolloverDown(prefix, c.bars ?? 7);
    }
    case "range_break": {
      const rng = rangeCompression(ctx.bars.slice(0, i), c.bars ?? 8, c.maxWidthPct ?? 0.005); // prior bars
      if (!rng) return false;
      return rangeBreakoutDirection(ctx.bars[i], rng, c.edgeMargin ?? 0.10) === c.dir;
    }
    case "sma_cross": {
      const fast = c.fast ?? 20, slow = c.slow ?? 120;
      if (i < slow - 1) return false; // flat until both SMAs warmed (nakamoto)
      const fs = ctx.smaSeries.get(fast), sl = ctx.smaSeries.get(slow);
      if (!fs || !sl) return false;
      const diff = fs[i] - sl[i];
      if (!isFinite(diff)) return false;
      const dirNow = diff > 0.02 ? "up" : diff < -0.02 ? "down" : "flat"; // eps $0.02 flat band
      return dirNow === c.dir;
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
  // Mandatory `all` block (feed-dependent gates ignored — backtest is informational;
  // capabilityCheck flags them so an ARMED spec has none).
  let allSup = 0, allHeld = 0;
  for (const c of entry.all ?? []) {
    if (!SUPPORTED.has(c.kind)) continue;
    allSup++;
    if (condHolds(c, ctx)) allHeld++;
  }
  // Optional `anyOf` pool: require ≥ anyOf.atLeast of its supported conditions.
  let anySup = 0, anyHeld = 0;
  if (entry.anyOf) {
    for (const c of entry.anyOf.of ?? []) {
      if (!SUPPORTED.has(c.kind)) continue;
      anySup++;
      if (condHolds(c, ctx)) anyHeld++;
    }
  }
  if (allSup + anySup === 0) return false; // never fire on thin air
  // `all`: ≥atLeast of it (omitted → strict AND); empty/all-unsupported → vacuously true.
  const allNeed = entry.atLeast != null ? Math.min(Math.max(1, entry.atLeast), allSup) : allSup;
  const allPass = allSup === 0 ? true : allHeld >= allNeed;
  // pool: ≥atLeast of it (capped to supported); absent → vacuously true.
  const anyPass = !entry.anyOf ? true : (anySup === 0 ? true : anyHeld >= Math.min(Math.max(1, entry.anyOf.atLeast), anySup));
  return allPass && anyPass;
}

// Build the per-session Evaluate for a spec (precomputes EMA/RSI over closes).
function makeSpecEvaluator(spec: StrategySpec, bars: Bar[], _tfMin: number, levels?: { pdh?: number; pdl?: number; gap?: number; customLevels?: number[] }): Evaluate {
  const closes = bars.map((b) => b.close);
  const emaSeries = new Map<number, number[]>();
  const rsiSeries = new Map<number, number[]>();
  const smaSeries = new Map<number, number[]>();
  const macdSeries = new Map<string, number[]>();
  const macdLineSeries = new Map<string, number[]>();
  for (const e of spec.entries ?? []) {
    for (const c of entryConds(e)) {
      if (c.kind === "ma_cross") {
        if (!emaSeries.has(c.fast)) emaSeries.set(c.fast, ema(closes, c.fast));
        if (!emaSeries.has(c.slow)) emaSeries.set(c.slow, ema(closes, c.slow));
      } else if (c.kind === "trend_align") {
        // seed the EMA periods this ref needs (reuses emaSeries): ribbon → 9 & 21; else the one EMA
        for (const n of c.ref === "ema21" ? [21] : c.ref === "ema50" ? [50] : [9, 21]) if (!emaSeries.has(n)) emaSeries.set(n, ema(closes, n));
      } else if (c.kind === "rsi" && !rsiSeries.has(c.period)) {
        rsiSeries.set(c.period, rsi(closes, c.period));
      } else if (c.kind === "sma_cross") {
        const fast = c.fast ?? 20, slow = c.slow ?? 120;
        if (!smaSeries.has(fast)) smaSeries.set(fast, sma(closes, fast));
        if (!smaSeries.has(slow)) smaSeries.set(slow, sma(closes, slow));
      } else if (c.kind === "macd" && !macdSeries.has(macdKey(c))) {
        const fa = ema(closes, c.fast), sl = ema(closes, c.slow);
        const line = closes.map((_, i) => fa[i] - sl[i]);
        const sig = ema(line, c.signal);
        macdSeries.set(macdKey(c), line.map((v, i) => v - sig[i])); // histogram
        macdLineSeries.set(macdKey(c), line); // for mode:"state"
      }
    }
  }
  const etMin = bars.map((b) => etMinuteOfDay(b.ts));
  const { sinceHod, sinceLod } = sessionSince(bars); // for stale_extreme
  const warmup = computeWarmup(spec);
  const timeExit = timeExitMinute(spec);
  const entries = spec.entries ?? [];
  // Multi-leg: a spec whose structure isn't single-leg emits intent.legs (the
  // engine resolves them off ATM by strikeOffset). Map the spec's LegStructure to
  // the engine's intent.structure label ("vertical-spread" → "vertical").
  const structure = spec.meta.structure;
  const multiLeg = structure !== "single-leg";
  const engineStruct: NonNullable<Extract<Intent, { kind: "enter" }>["structure"]> =
    structure === "vertical-spread" ? "vertical"
    : structure === "straddle" ? "straddle"
    : structure === "strangle" ? "strangle"
    : structure === "iron-condor" ? "iron-condor"
    : "single-leg";

  return (f: Features, pos: Position | null): Intent => {
    const i = f.minute;
    const ctx: Ctx = { f, i, emaSeries, rsiSeries, smaSeries, etMin, closes, bars, sinceHod, sinceLod, macdSeries, macdLineSeries, pdh: levels?.pdh, pdl: levels?.pdl, gap: levels?.gap, customLevels: levels?.customLevels };

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
      const reason = e.reason || `${spec.meta.strategyId}_entry`;
      // Multi-leg: emit the leg geometry (defaulting each ratio to 1). Each leg's
      // strike is anchored to a LEVEL (default ATM) + its offset; we resolve the
      // anchor to its price here (where the level data lives) and convert to an
      // ATM-relative strikeOffset, so the engine leg-resolution (round(spot)+offset)
      // is unchanged. If an anchor can't be resolved (e.g. OR not set), skip the
      // entry — never place a leg on a missing level.
      if (multiLeg && e.legs?.length) {
        const atm = Math.round(f.close);
        const anchorPx = (a: SpecLeg["anchor"]): number | null => {
          switch (a) {
            case "vwap": return f.vwap > 0 ? f.vwap : null;
            case "orb_hi": return f.openRangeHi;
            case "orb_lo": return f.openRangeLo;
            case "pdh": return levels?.pdh ?? null;
            case "pdl": return levels?.pdl ?? null;
            default: return f.close; // "atm"
          }
        };
        const legs: { optType: OptType; side: "long" | "short"; strikeOffset: number; ratio: number }[] = [];
        let resolvable = true;
        for (const l of e.legs) {
          const base = anchorPx(l.anchor);
          if (base == null) { resolvable = false; break; }
          legs.push({ optType: l.optType, side: l.side, strikeOffset: Math.round(base) + l.strikeOffset - atm, ratio: l.ratio ?? 1 });
        }
        if (!resolvable) continue; // anchor missing → try the next entry / no trade
        return { kind: "enter", structure: engineStruct, legs, reason };
      }
      const dir: OptType | null = e.direction === "both" ? inferDirection(e) : e.direction;
      if (!dir) continue; // "both" with no directional cue → skip
      return { kind: "enter", direction: dir, reason };
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
