/**
 * Faithful TS port of Nakamoto's `momentum_patterns.py` (received in the
 * 06-09 addendum — replaces the earlier stub module). Only the functions the
 * entry stack imports are ported: compute_macd, volume_z, is_pin_bar,
 * is_engulfing, is_strong_trend_bar, trend_structure.
 *
 * Stub-vs-real deltas (for the record): compute_macd was already exact
 * (ewm adjust=False, 12/26/9); is_engulfing was functionally identical;
 * is_pin_bar / is_strong_trend_bar gained close-position requirements;
 * trend_structure is a polyfit-slope test, not HH/HL counting.
 */
import { Bar, avg } from "./data";

// ---- EMA / MACD (exact: pandas ewm(span, adjust=False)) ----------------------

function emaAdjustFalse(vals: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out = new Array<number>(vals.length);
  let y = vals[0];
  out[0] = y;
  for (let i = 1; i < vals.length; i++) {
    y = a * vals[i] + (1 - a) * y;
    out[i] = y;
  }
  return out;
}

/** compute_macd(closes, 12, 26, 9) → [macd, signal, hist]. */
export function computeMacd(closes: number[]): [number[], number[], number[]] {
  const fast = emaAdjustFalse(closes, 12);
  const slow = emaAdjustFalse(closes, 26);
  const macd = fast.map((f, i) => f - slow[i]);
  const signal = emaAdjustFalse(macd, 9);
  const hist = macd.map((m, i) => m - signal[i]);
  return [macd, signal, hist];
}

// ---- Volume ------------------------------------------------------------------

/** volume_z(bars, lookback): z of current bar's volume vs prior lookback bars
 * (population std); sd ≤ 1e-9 → 0. */
export function volumeZ(bars: Bar[], lookback = 10): number {
  if (bars.length < lookback + 1) return 0;
  const prior = bars.slice(-(lookback + 1), -1).map(b => b.volume);
  const curr = bars[bars.length - 1].volume;
  const mu = avg(prior);
  const sd = Math.sqrt(avg(prior.map(v => (v - mu) ** 2)));
  return sd > 1e-9 ? (curr - mu) / sd : 0;
}

// ---- Single-bar shapes ----------------------------------------------------------

/** is_strong_trend_bar: body > 65% of range AND close in top/bottom 20%. */
export function isStrongTrendBar(bar: Bar, direction: "up" | "down"): boolean {
  const rng = bar.high - bar.low;
  if (rng <= 0) return false;
  const bodyFrac = Math.abs(bar.close - bar.open) / rng;
  const closePos = (bar.close - bar.low) / rng;
  if (direction === "up") return bodyFrac > 0.65 && closePos > 0.80 && bar.close > bar.open;
  return bodyFrac > 0.65 && closePos < 0.20 && bar.close < bar.open;
}

/** is_pin_bar: body ≤ 33% of range; rejection wick ≥ 2× body; close in the
 * upper third (up) / lower third (down). */
export function isPinBar(bar: Bar, direction: "up" | "down"): boolean {
  const rng = bar.high - bar.low;
  if (rng <= 0) return false;
  const body = Math.abs(bar.close - bar.open);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const closePos = (bar.close - bar.low) / rng;
  if (body > 0.33 * rng) return false;
  if (direction === "up") return lowerWick >= 2 * body && closePos >= 0.66;
  return upperWick >= 2 * body && closePos <= 0.33;
}

/** is_engulfing: current body fully engulfs prior body, colors reversed. */
export function isEngulfing(prev: Bar, curr: Bar, direction: "up" | "down"): boolean {
  const prevHi = Math.max(prev.open, prev.close);
  const prevLo = Math.min(prev.open, prev.close);
  const currHi = Math.max(curr.open, curr.close);
  const currLo = Math.min(curr.open, curr.close);
  if (currHi < prevHi || currLo > prevLo) return false;
  if (direction === "up") return curr.close > curr.open && prev.close < prev.open;
  return curr.close < curr.open && prev.close > prev.open;
}

// ---- Trend structure --------------------------------------------------------------

/** trend_structure: least-squares slope of highs AND lows over the last n bars;
 * both must exceed ±5% of avg bar range per bar. np.polyfit(t,y,1)[0] mirror. */
export function trendStructure(bars: Bar[], n = 10): "up" | "down" | "chop" {
  if (bars.length < n) return "chop";
  const w = bars.slice(-n);
  const slope = (ys: number[]): number => {
    const m = ys.length;
    const tBar = (m - 1) / 2;
    const yBar = avg(ys);
    let num = 0, den = 0;
    for (let t = 0; t < m; t++) {
      num += (t - tBar) * (ys[t] - yBar);
      den += (t - tBar) ** 2;
    }
    return num / den;
  };
  const highSlope = slope(w.map(b => b.high));
  const lowSlope = slope(w.map(b => b.low));
  const avgRange = avg(w.map(b => b.high - b.low));
  const threshold = avgRange * 0.05;
  if (highSlope > threshold && lowSlope > threshold) return "up";
  if (highSlope < -threshold && lowSlope < -threshold) return "down";
  return "chop";
}
