/**
 * Candle-shape detectors — first-class engine vocab (#3). Pure bar-geometry, no I/O.
 * These mirror the validated Nakamoto port (engine/nakamoto/momentum-patterns.ts +
 * detectors.ts) EXACTLY — strict comparisons, close-position requirements, first-
 * occurrence argmax/argmin — so a channel can gate on candle shapes the same way it
 * gates on ma_cross/vwap. candle-selftest.ts asserts parity vs that port.
 *
 * Direction is explicit on each condition (a single-leg entry's tradeable side):
 * "up" = bullish reversal/continuation (→ call), "down" = bearish (→ put).
 */
import type { Bar } from "./types";

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** strong trend bar: body > 65% of range AND close in the top/bottom 20%. */
export function strongTrendBar(bar: Bar, dir: "up" | "down"): boolean {
  const rng = bar.high - bar.low;
  if (rng <= 0) return false;
  const bodyFrac = Math.abs(bar.close - bar.open) / rng;
  const closePos = (bar.close - bar.low) / rng;
  return dir === "up"
    ? bodyFrac > 0.65 && closePos > 0.80 && bar.close > bar.open
    : bodyFrac > 0.65 && closePos < 0.20 && bar.close < bar.open;
}

/** pin bar: body ≤ 33% of range; rejection wick ≥ 2× body; close in the upper
 * third (up) / lower third (down). */
export function pinBar(bar: Bar, dir: "up" | "down"): boolean {
  const rng = bar.high - bar.low;
  if (rng <= 0) return false;
  const body = Math.abs(bar.close - bar.open);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const closePos = (bar.close - bar.low) / rng;
  if (body > 0.33 * rng) return false;
  return dir === "up"
    ? lowerWick >= 2 * body && closePos >= 0.66
    : upperWick >= 2 * body && closePos <= 0.33;
}

/** engulfing: current body fully covers the prior body, colors reversed. */
export function engulfing(prev: Bar, curr: Bar, dir: "up" | "down"): boolean {
  const prevHi = Math.max(prev.open, prev.close), prevLo = Math.min(prev.open, prev.close);
  const currHi = Math.max(curr.open, curr.close), currLo = Math.min(curr.open, curr.close);
  if (currHi < prevHi || currLo > prevLo) return false;
  return dir === "up"
    ? curr.close > curr.open && prev.close < prev.open
    : curr.close < curr.open && prev.close > prev.open;
}

/** Per-bar "bars since the session HOD/LOD" (strict > / < ⇒ FIRST extreme wins,
 * matching detectors.barsSinceSessionExtreme). bars MUST be the session's RTH bars
 * in order from the open; sinceHod[i]/sinceLod[i] use only bars[0..i] (causal). */
export function sessionSince(bars: Bar[]): { sinceHod: number[]; sinceLod: number[] } {
  const sinceHod = new Array<number>(bars.length);
  const sinceLod = new Array<number>(bars.length);
  let hodI = 0, lodI = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      if (bars[i].high > bars[hodI].high) hodI = i;
      if (bars[i].low < bars[lodI].low) lodI = i;
    }
    sinceHod[i] = i - hodI;
    sinceLod[i] = i - lodI;
  }
  return { sinceHod, sinceLod };
}

/** curl_up over n bars: lows non-decreasing (≤maxViolations dips), range
 * compressing (last-third avg range < first-third), last close above the prior
 * bar's body-top. Mirrors detectors.curlUp (NaN-safe mean-of-empty → false). */
export function curlUp(bars: Bar[], n = 7, maxViolations = 1): boolean {
  if (bars.length < n) return false;
  const w = bars.slice(-n);
  let v = 0;
  for (let i = 1; i < w.length; i++) if (w[i].low < w[i - 1].low) { v++; if (v > maxViolations) return false; }
  const k = Math.floor(n / 3);
  const first = avg(w.slice(0, k).map(b => b.high - b.low));
  const last = avg(w.slice(w.length - k).map(b => b.high - b.low));
  if (!(last < first)) return false;
  const prev = w[w.length - 2], lastBar = w[w.length - 1];
  return lastBar.close > Math.max(prev.open, prev.close);
}

/** rollover_down — mirror of curlUp on highs / body-bottom. */
export function rolloverDown(bars: Bar[], n = 7, maxViolations = 1): boolean {
  if (bars.length < n) return false;
  const w = bars.slice(-n);
  let v = 0;
  for (let i = 1; i < w.length; i++) if (w[i].high > w[i - 1].high) { v++; if (v > maxViolations) return false; }
  const k = Math.floor(n / 3);
  const first = avg(w.slice(0, k).map(b => b.high - b.low));
  const last = avg(w.slice(w.length - k).map(b => b.high - b.low));
  if (!(last < first)) return false;
  const prev = w[w.length - 2], lastBar = w[w.length - 1];
  return lastBar.close < Math.min(prev.open, prev.close);
}

export interface RangeInfo { high: number; low: number; width: number; midpoint: number; width_pct: number }

/** range compression over the last n bars: tight iff (high−low)/mid ≤ maxWidthPct. */
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

/** breakout direction: close ≥ edgeMarginFrac·width beyond the range edge. */
export function rangeBreakoutDirection(currBar: Bar, rng: RangeInfo, edgeMarginFrac = 0.10): "up" | "down" | null {
  const margin = edgeMarginFrac * rng.width;
  if (currBar.close > rng.high + margin) return "up";
  if (currBar.close < rng.low - margin) return "down";
  return null;
}
