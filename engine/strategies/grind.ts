// ============================================================================
//  The Grinder — scalper. Many small momentum bursts: when 1-min momentum kicks
//  with a volume tick, take the directional side and get out fast on a tight
//  ATR target, a tight ATR stop, or a short time-stop. High trade count, small
//  per-trade edge. Steps aside near the close. Parameterized for the sweep.
//
//  DRAFT thesis — must be backtested on real option_bars before it's armed.
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface GrindParams {
  momTrigger: number; // |mom| ≥ momTrigger·ATR to fire
  volMin: number; // relVol ≥ volMin (some participation)
  targetAtr: number; // favorable underlying move (in ATRs) → take profit
  stopAtr: number; // adverse underlying move (in ATRs) → stop
  timeStop: number; // minutes held before the time-stop (short — it's a scalp)
  flattenBeforeClose: number; // minutes-to-close: no new entries / force exit
}

export const DEFAULT_GRIND_PARAMS: GrindParams = {
  momTrigger: 0.5,
  volMin: 1.1,
  targetAtr: 0.6,
  stopAtr: 0.5,
  timeStop: 5,
  flattenBeforeClose: 10,
};

export function grindEvaluate(
  f: Features,
  pos: Position | null,
  p: GrindParams = DEFAULT_GRIND_PARAMS
): Intent {
  // ---- exits (when we hold) — fast: target, stop, or time ----
  if (pos) {
    if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= p.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "call") {
      if (f.close >= pos.entryUnderlying + p.targetAtr * f.atr) return { kind: "exit", reason: "target" };
      if (f.close <= pos.entryUnderlying - p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    } else {
      if (f.close <= pos.entryUnderlying - p.targetAtr * f.atr) return { kind: "exit", reason: "target" };
      if (f.close >= pos.entryUnderlying + p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    }
    return null;
  }

  // ---- entries (when flat) — momentum burst with a volume tick ----
  if (f.minutesToClose <= p.flattenBeforeClose) return null;
  if (f.atr <= 0) return null;
  if (f.relVol < p.volMin) return null;

  if (f.mom >= p.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -p.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}
