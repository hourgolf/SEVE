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
