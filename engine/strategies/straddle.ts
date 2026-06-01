// ============================================================================
//  Catalyst Long Straddle (thesis #2) — the first MULTI-LEG strategy.
//  Long an ATM call AND an ATM put (same strike/expiry): non-directional, pays
//  off when REALIZED movement exceeds the implied (priced-in) move. Max loss =
//  the net debit. The real edge is timing it around a scheduled catalyst — that
//  gate needs the event-calendar + IV-rank feeds (phase 4b); until those land,
//  this entry is a mechanics proxy (enter early, ride for a move) so we can
//  validate multi-leg PRICING + P&L on real chains, not claim an edge yet.
//
//  Exits are feature-based (the engine evaluator can't see option premium):
//    • move_target — |spot − entry| ≥ targetAtr·ATR (realized move paid off)
//    • time_stop   — held too long (theta bleed on a 0DTE straddle)
//    • eod_flatten — near the close
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface StraddleParams {
  entryByMin: number; // only open in the first N minutes (proxy for a catalyst window)
  targetAtr: number; // take profit once the underlying has moved this many ATRs
  timeStop: number; // minutes held before theta forces an exit
  flatten: number; // minutes-to-close to flatten by
}

export const DEFAULT_STRADDLE_PARAMS: StraddleParams = {
  entryByMin: 8,
  targetAtr: 8, // a straddle wants a BIG move to overcome two debits — not a scalp
  timeStop: 90,
  flatten: 20,
};

export function straddleEvaluate(
  f: Features,
  pos: Position | null,
  P: StraddleParams = DEFAULT_STRADDLE_PARAMS
): Intent {
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (Math.abs(f.close - pos.entryUnderlying) >= P.targetAtr * f.atr)
      return { kind: "exit", reason: "move_target" };
    return null;
  }
  // open the straddle once, early (mechanics proxy for the catalyst window)
  if (f.minute > P.entryByMin || f.atr <= 0 || f.minutesToClose <= P.flatten) return null;
  return {
    kind: "enter",
    structure: "straddle",
    reason: "catalyst_straddle",
    legs: [
      { optType: "call", side: "long", strikeOffset: 0, ratio: 1 },
      { optType: "put", side: "long", strikeOffset: 0, ratio: 1 },
    ],
  };
}
