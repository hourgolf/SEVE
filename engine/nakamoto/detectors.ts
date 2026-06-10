/**
 * Faithful TS port of Nakamoto's `detectors.py` (received verbatim in
 * matt_handoff/ground_truth_code/). Pure functions, no I/O — each mirrors the
 * Python body exactly, including iloc slice arithmetic, first-occurrence
 * argmax/argmin, strict-vs-inclusive comparisons, and insufficient-history
 * defaults. compute_macd comes from momentum-patterns.ts (the real module,
 * received in the 06-09 addendum).
 */
import { Bar, avg } from "./data";
import { computeMacd } from "./momentum-patterns";

// ---- Shape: curl-up / rollover-down -----------------------------------------

/** curl_up(bars, n=7, max_violations=1): lows non-decreasing (≤1 dip), range
 * compression last-third < first-third, last close above prior body-top. */
export function curlUp(bars: Bar[], n = 7, maxViolations = 1): boolean {
  if (bars.length < n) return false;
  const w = bars.slice(-n);
  let violations = 0;
  for (let i = 1; i < w.length; i++) {
    if (w[i].low < w[i - 1].low) {
      violations++;
      if (violations > maxViolations) return false;
    }
  }
  const k = Math.floor(n / 3); // python n // 3
  const first = avg(w.slice(0, k).map(b => b.high - b.low));
  const last = avg(w.slice(w.length - k).map(b => b.high - b.low));
  if (!(last < first)) return false; // NaN-safe: mirrors pandas mean-of-empty
  const prev = w[w.length - 2];
  const lastBar = w[w.length - 1];
  return lastBar.close > Math.max(prev.open, prev.close);
}

/** rollover_down — mirror of curl_up on highs / body-bottom. */
export function rolloverDown(bars: Bar[], n = 7, maxViolations = 1): boolean {
  if (bars.length < n) return false;
  const w = bars.slice(-n);
  let violations = 0;
  for (let i = 1; i < w.length; i++) {
    if (w[i].high > w[i - 1].high) {
      violations++;
      if (violations > maxViolations) return false;
    }
  }
  const k = Math.floor(n / 3);
  const first = avg(w.slice(0, k).map(b => b.high - b.low));
  const last = avg(w.slice(w.length - k).map(b => b.high - b.low));
  if (!(last < first)) return false;
  const prev = w[w.length - 2];
  const lastBar = w[w.length - 1];
  return lastBar.close < Math.min(prev.open, prev.close);
}

// ---- MACD state --------------------------------------------------------------

export interface MacdState {
  sign: number;
  slope_1: number;
  slope_3: number;
  line_slope_1: number;
  cross_dir: number;
  bars_since_cross: number;
  in_direction_long: boolean;
  in_direction_short: boolean;
  fresh_cross_up: boolean;
  fresh_cross_down: boolean;
}

/** macd_state(closes): requires ≥30 bars; sign deadband ±0.005; cross scan from
 * the end on hist>0 flips; fresh = flipped within last 3 bars. */
export function macdState(closes: number[]): MacdState {
  if (closes.length < 30) {
    return {
      sign: 0, slope_1: NaN, slope_3: NaN, line_slope_1: NaN, cross_dir: 0,
      bars_since_cross: 999,
      in_direction_long: false, in_direction_short: false,
      fresh_cross_up: false, fresh_cross_down: false,
    };
  }
  const [m, , h] = computeMacd(closes);
  const n = h.length;
  const curr = h[n - 1];
  const sign = curr > 0.005 ? 1 : curr < -0.005 ? -1 : 0;
  const slope_1 = h[n - 1] - h[n - 2];
  const slope_3 = n >= 4 ? h[n - 1] - h[n - 4] : slope_1;
  const line_slope_1 = m[n - 1] - m[n - 2];

  let bars_since_cross = 999;
  let cross_dir = 0;
  for (let i = n - 1; i > 0; i--) {
    if ((h[i] > 0) !== (h[i - 1] > 0)) {
      bars_since_cross = n - 1 - i;
      cross_dir = h[i] > 0 ? 1 : -1;
      break;
    }
  }
  const in_long = sign > 0 && line_slope_1 > 0;
  const in_short = sign < 0 && line_slope_1 < 0;
  return {
    sign, slope_1, slope_3, line_slope_1, cross_dir, bars_since_cross,
    in_direction_long: in_long, in_direction_short: in_short,
    fresh_cross_up: cross_dir === 1 && bars_since_cross <= 3,
    fresh_cross_down: cross_dir === -1 && bars_since_cross <= 3,
  };
}

// ---- Moving-average cross ----------------------------------------------------

export interface MaCrossState {
  direction: "up" | "down" | "flat";
  fast: number;
  slow: number;
  bars_since_cross: number;
}

/** ma_cross_state(closes, fast=20, slow=120): SMA state, eps $0.02 flat band,
 * cross scan stops at valid_start = max(fast,slow)−1. */
export function maCrossState(closes: number[], fast = 20, slow = 120): MaCrossState {
  if (closes.length < slow) {
    return { direction: "flat", fast: NaN, slow: NaN, bars_since_cross: 999 };
  }
  const sma = (w: number) => {
    const out = new Array<number>(closes.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= w) sum -= closes[i - w];
      if (i >= w - 1) out[i] = sum / w;
    }
    return out;
  };
  const f = sma(fast);
  const s = sma(slow);
  const validStart = Math.max(fast, slow) - 1;
  const fCur = f[f.length - 1];
  const sCur = s[s.length - 1];
  const diff = fCur - sCur;
  const eps = 0.02;
  const direction: MaCrossState["direction"] = diff > eps ? "up" : diff < -eps ? "down" : "flat";
  let bars_since_cross = 999;
  for (let i = closes.length - 1; i > validStart; i--) {
    if ((f[i] > s[i]) !== (f[i - 1] > s[i - 1])) {
      bars_since_cross = closes.length - 1 - i;
      break;
    }
  }
  return { direction, fast: fCur, slow: sCur, bars_since_cross };
}

// ---- Session-extreme exhaustion ------------------------------------------------

export interface ExtremeState { since_hod: number; since_lod: number; rth_bars_total: number }

/** bars_since_session_extreme(bars_rth): first-occurrence HOD/LOD (np.argmax). */
export function barsSinceSessionExtreme(barsRth: Bar[]): ExtremeState {
  if (!barsRth.length) return { since_hod: 0, since_lod: 0, rth_bars_total: 0 };
  let hodI = 0, lodI = 0;
  for (let i = 1; i < barsRth.length; i++) {
    if (barsRth[i].high > barsRth[hodI].high) hodI = i;   // strict > keeps FIRST max
    if (barsRth[i].low < barsRth[lodI].low) lodI = i;     // strict < keeps FIRST min
  }
  return {
    since_hod: barsRth.length - 1 - hodI,
    since_lod: barsRth.length - 1 - lodI,
    rth_bars_total: barsRth.length,
  };
}

// ---- Range compression (breakouts) --------------------------------------------

export interface RangeInfo { high: number; low: number; width: number; midpoint: number; width_pct: number }

/** range_compression(bars, n=8, max_width_pct=0.005): tight iff width/mid ≤ max. */
export function rangeCompression(bars: Bar[], n = 8, maxWidthPct = 0.005): RangeInfo | null {
  if (bars.length < n) return null;
  const w = bars.slice(-n);
  const rh = Math.max(...w.map(b => b.high));
  const rl = Math.min(...w.map(b => b.low));
  const width = rh - rl;
  const mid = (rh + rl) / 2;
  if (mid <= 0) return null;
  const widthPct = width / mid;
  if (widthPct > maxWidthPct) return null;
  return { high: rh, low: rl, width, midpoint: mid, width_pct: widthPct };
}

/** range_breakout_direction: close ≥ edge_margin_frac·width beyond an edge. */
export function rangeBreakoutDirection(
  currBar: Bar, rng: RangeInfo, edgeMarginFrac = 0.10,
): "up" | "down" | null {
  const margin = edgeMarginFrac * rng.width;
  if (currBar.close > rng.high + margin) return "up";
  if (currBar.close < rng.low - margin) return "down";
  return null;
}

// ---- Level proximity -----------------------------------------------------------

/** nearest_level: (level, signed distance level−spot); python min() keeps the
 * FIRST minimal element in list order. */
export function nearestLevel(spot: number, levels: number[]): [number, number] {
  if (!levels.length) return [spot, 0];
  let L = levels[0];
  let best = Math.abs(levels[0] - spot);
  for (let i = 1; i < levels.length; i++) {
    const d = Math.abs(levels[i] - spot);
    if (d < best) { best = d; L = levels[i]; }
  }
  return [L, L - spot];
}

export function nearLevel(spot: number, levels: number[], maxDist = 1.0): boolean {
  const [, d] = nearestLevel(spot, levels);
  return Math.abs(d) <= maxDist;
}

export function edgeAtLevel(edgePrice: number, levels: number[], maxDist = 1.0): number | null {
  const [L, d] = nearestLevel(edgePrice, levels);
  return Math.abs(d) <= maxDist ? L : null;
}
