// ============================================================================
//  The Fade — mean reversion. Build the opening 30-min range + VWAP; when price
//  stretches ≥1.5 ATR beyond the band on weak (decelerating) momentum, buy the
//  reverting side (puts into an upside stretch, calls into a downside one).
//  Target = revert to VWAP; stop = stretch extends another ATR; time-stop;
//  hard flatten near the close. Deterministic — the backtestable hot path.
// ============================================================================

import type { Features, OptType, Position } from "../types";

const ATR_MULT = 1.5; // stretch beyond VWAP to trigger
const WEAK_MOM = 0.6; // |mom| < WEAK_MOM·ATR  → decelerating
const STOP_ATR = 1.0; // adverse continuation that stops us out
const TIME_STOP = 20; // minutes
const FLATTEN_BEFORE_CLOSE = 35; // minutes to close: no new entries / force exit

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

export function fadeEvaluate(f: Features, pos: Position | null): FadeIntent {
  // ---- exits (when we hold) ----
  if (pos) {
    if (f.minutesToClose <= FLATTEN_BEFORE_CLOSE) return { kind: "exit", reason: "eod_flatten" };
    const held = f.minute - pos.entryMinute;
    if (held >= TIME_STOP) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") {
      // faded an UP stretch: win if price reverts down to/under VWAP
      if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close > pos.entryUnderlying + STOP_ATR * f.atr)
        return { kind: "exit", reason: "stop" };
    } else {
      // faded a DOWN stretch: win if price reverts up to/over VWAP
      if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close < pos.entryUnderlying - STOP_ATR * f.atr)
        return { kind: "exit", reason: "stop" };
    }
    return null;
  }

  // ---- entries (when flat) ----
  if (f.openRangeHi == null || f.openRangeLo == null) return null; // range not built yet
  if (f.minutesToClose <= FLATTEN_BEFORE_CLOSE) return null;
  if (f.atr <= 0) return null;

  const weakMom = Math.abs(f.mom) < WEAK_MOM * f.atr;
  if (!weakMom) return null;

  const upStretch = f.close > f.openRangeHi && f.close - f.vwap > ATR_MULT * f.atr;
  const downStretch = f.close < f.openRangeLo && f.vwap - f.close > ATR_MULT * f.atr;

  if (upStretch) return { kind: "enter", direction: "put", reason: "fade_upside_stretch" };
  if (downStretch) return { kind: "enter", direction: "call", reason: "fade_downside_stretch" };
  return null;
}
