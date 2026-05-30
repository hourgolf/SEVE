// ============================================================================
//  The Fade — mean reversion. Build the opening 30-min range + VWAP; when price
//  stretches ≥atrMult ATR beyond the band on weak (decelerating) momentum AND
//  the tape is range-bound (low efficiency ratio — its intended habitat), buy
//  the reverting side (puts into an upside stretch, calls into a downside one).
//  Target = revert to VWAP; stop = stretch extends; time-stop; flatten near close.
//  All thresholds are parameterized so the sweep can tune them.
// ============================================================================

import type { Features, OptType, Position } from "../types";

export interface FadeParams {
  atrMult: number; // stretch beyond VWAP (in ATRs) to trigger
  weakMom: number; // |mom| < weakMom·ATR → decelerating
  stopAtr: number; // adverse continuation (in ATRs) that stops us out
  timeStop: number; // minutes held before time-stop
  flattenBeforeClose: number; // minutes-to-close: no new entries / force exit
  erMax: number; // regime gate: only fade when efficiencyRatio ≤ erMax
}

// Defaults = the original naive Fade + a range-only regime gate (erMax).
export const DEFAULT_FADE_PARAMS: FadeParams = {
  atrMult: 1.5,
  weakMom: 0.6,
  stopAtr: 1.0,
  timeStop: 20,
  flattenBeforeClose: 35,
  erMax: 0.4,
};

export interface EntryIntent {
  kind: "enter";
  direction: OptType;
  reason: string;
}
export interface ExitIntent {
  kind: "exit";
  reason: string;
}
export type FadeIntent = EntryIntent | ExitIntent | null;

export function fadeEvaluate(
  f: Features,
  pos: Position | null,
  p: FadeParams = DEFAULT_FADE_PARAMS
): FadeIntent {
  // ---- exits (when we hold) ----
  if (pos) {
    if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
    const held = f.minute - pos.entryMinute;
    if (held >= p.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") {
      if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close > pos.entryUnderlying + p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    } else {
      if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close < pos.entryUnderlying - p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    }
    return null;
  }

  // ---- entries (when flat) ----
  if (f.openRangeHi == null || f.openRangeLo == null) return null; // range not built yet
  if (f.minutesToClose <= p.flattenBeforeClose) return null;
  if (f.atr <= 0) return null;

  // Regime gate: skip trending tape — fading a trend is what bled the naive
  // version (it stopped out 64% of the time). Only fade range-bound chop.
  if (f.er > p.erMax) return null;

  const weakMom = Math.abs(f.mom) < p.weakMom * f.atr;
  if (!weakMom) return null;

  const upStretch = f.close > f.openRangeHi && f.close - f.vwap > p.atrMult * f.atr;
  const downStretch = f.close < f.openRangeLo && f.vwap - f.close > p.atrMult * f.atr;

  if (upStretch) return { kind: "enter", direction: "put", reason: "fade_upside_stretch" };
  if (downStretch) return { kind: "enter", direction: "call", reason: "fade_downside_stretch" };
  return null;
}
