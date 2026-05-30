// ============================================================================
//  The Breakout — momentum. Same opening 30-min range. On a decisive break-and-
//  hold of the high (or low) WITH expanding volume and a trending tape (high
//  efficiency ratio), buy in the break's direction and RIDE with a trailing
//  stop. Fewer trades, bigger swings — the trend-day counterpart to The Fade,
//  built to win exactly when the Fade bleeds. All thresholds parameterized.
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface BreakoutParams {
  breakAtr: number; // close must clear the range edge by this many ATRs
  volMult: number; // relVol ≥ volMult (volume expansion) to confirm
  erMin: number; // regime gate: only trade when efficiencyRatio ≥ erMin (trend)
  momConfirm: number; // |mom| ≥ momConfirm·ATR in the break direction
  trailAtr: number; // exit if underlying retraces trailAtr·ATR off its peak
  failAtr: number; // failed-break stop: snaps back inside the range by failAtr·ATR
  flattenBeforeClose: number; // minutes-to-close: no new entries / force exit
}

export const DEFAULT_BREAKOUT_PARAMS: BreakoutParams = {
  breakAtr: 0.5,
  volMult: 1.3,
  erMin: 0.35,
  momConfirm: 0.3,
  trailAtr: 1.5,
  failAtr: 0.75,
  flattenBeforeClose: 35,
};

export function breakoutEvaluate(
  f: Features,
  pos: Position | null,
  p: BreakoutParams = DEFAULT_BREAKOUT_PARAMS
): Intent {
  // ---- exits (when we hold) — trailing stop rides the trend ----
  if (pos) {
    if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call") {
      // long the up-break: trail below the peak; bail if it falls back in-range
      if (f.close < pos.peakFavorable - p.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeHi != null && f.close < f.openRangeHi - p.failAtr * f.atr)
        return { kind: "exit", reason: "failed_break" };
    } else {
      if (f.close > pos.peakFavorable + p.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeLo != null && f.close > f.openRangeLo + p.failAtr * f.atr)
        return { kind: "exit", reason: "failed_break" };
    }
    return null;
  }

  // ---- entries (when flat) ----
  if (f.openRangeHi == null || f.openRangeLo == null) return null; // range not built yet
  if (f.minutesToClose <= p.flattenBeforeClose) return null;
  if (f.atr <= 0) return null;

  if (f.er < p.erMin) return null; // skip chop — Breakout wants trend
  if (f.relVol < p.volMult) return null; // need volume expansion

  const upBreak =
    f.close > f.openRangeHi + p.breakAtr * f.atr && f.mom > p.momConfirm * f.atr;
  const downBreak =
    f.close < f.openRangeLo - p.breakAtr * f.atr && f.mom < -p.momConfirm * f.atr;

  if (upBreak) return { kind: "enter", direction: "call", reason: "break_high" };
  if (downBreak) return { kind: "enter", direction: "put", reason: "break_low" };
  return null;
}
