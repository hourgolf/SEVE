// ============================================================================
//  Fade v2 — pure VWAP-deviation reversion.
//
//  The base `fade` loses on real fills (gross −$17.6k H1, 20% win): it requires a
//  beyond-opening-range extension AND a 1.5·ATR VWAP stretch AND chop — it fades
//  EXTENSIONS, i.e. catches falling knives. v2 drops the opening-range gate and fades
//  the cleaner signal: price stretched ≥ devAtr·ATR from the SESSION VWAP with
//  momentum stalled (|mom| < weakMom·ATR), targeting a reversion back to VWAP. Still
//  chop-gated (er ≤ erMax — reversion needs a range, not a trend). DRAFT — backtest first.
//
//  VERDICT (real fills, H1-2026): NO EDGE. fade-v2 gross -$17,584 ~ base fade -$17,625;
//  29% win. Dropping the opening-range gate didn't help — intraday 0DTE stretches from
//  VWAP CONTINUE more than they revert (you're fading momentum), so mean reversion has a
//  negative GROSS edge (not just a cost problem). NOT registered live. The desk's edge is
//  momentum (breakout/power/trail), not reversion. Kept as the documented dead end.
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface FadeV2Params {
  devAtr: number;   // |close − vwap| ≥ devAtr·ATR to fire (the stretch)
  erMax: number;    // er ≤ erMax — only fade in chop
  weakMom: number;  // |mom| < weakMom·ATR — wait for the move to stall before fading
  stopAtr: number;  // further stretch (in ATRs past entry) → stop
  timeStop: number; // minutes before time-out
  flatten: number;  // minutes-to-close: no new entries / force exit
}

export const DEFAULT_FADE_V2_PARAMS: FadeV2Params = {
  devAtr: 2.0,
  erMax: 0.4,
  weakMom: 0.8,
  stopAtr: 1.5,
  timeStop: 30,
  flatten: 35,
};

export function fadeV2Evaluate(
  f: Features,
  pos: Position | null,
  p: FadeV2Params = DEFAULT_FADE_V2_PARAMS
): Intent {
  // ---- exits: target the reversion to VWAP, stop on further stretch ----
  if (pos) {
    if (f.minutesToClose <= p.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= p.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") { // faded an upside stretch → want price back DOWN to vwap
      if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close > pos.entryUnderlying + p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    } else { // faded a downside stretch → want price back UP to vwap
      if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" };
      if (f.close < pos.entryUnderlying - p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    }
    return null;
  }

  // ---- entries: stretched from VWAP, momentum stalled, in chop ----
  if (f.minutesToClose <= p.flatten || f.atr <= 0 || f.er > p.erMax) return null;
  if (Math.abs(f.mom) >= p.weakMom * f.atr) return null; // don't fade while the move is still accelerating
  const dev = (f.close - f.vwap) / f.atr;
  if (dev >= p.devAtr) return { kind: "enter", direction: "put", reason: "fade_above_vwap" };
  if (dev <= -p.devAtr) return { kind: "enter", direction: "call", reason: "fade_below_vwap" };
  return null;
}
