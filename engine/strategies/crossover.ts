// ============================================================================
//  EMA Cross — the simple, legible strategist the desk actually wants.
//  Buy CALLS on a bullish EMA(9/21) crossover, PUTS on a bearish one, each
//  confirmed by MACD agreement and a volume uptick. Exit on the opposite cross,
//  an underlying stop, a time-stop, or the close. Uses the SAME lib/indicators
//  the dashboard chart draws, so the signal and the line are one definition.
// ============================================================================

import { ema, macd, crossDir } from "../../lib/indicators";
import type { Evaluate, Intent } from "../types";

export interface CrossParams {
  emaFast: number;
  emaSlow: number;
  volMult: number; // require relVol ≥ this to confirm an entry
  useMacd: boolean; // require MACD line/signal agreement with the cross
  stopAtr: number; // underlying stop, in ATRs
  timeStop: number; // minutes held before time-stop
  flattenBeforeClose: number; // minutes-to-close: no new entries / force exit
}

export const DEFAULT_CROSS_PARAMS: CrossParams = {
  emaFast: 9,
  emaSlow: 21,
  volMult: 1.1,
  useMacd: true,
  stopAtr: 1.5,
  timeStop: 45,
  flattenBeforeClose: 35,
};

// Build the evaluator for one session (precomputes EMA/MACD over its closes;
// `f.minute` indexes them). `tfMin` is the bar size so the time-stop stays in
// real minutes across timeframes. Returned shape matches the shared Evaluate type.
export function makeCrossover(
  closes: number[],
  p: CrossParams = DEFAULT_CROSS_PARAMS,
  tfMin = 1
): Evaluate {
  const ef = ema(closes, p.emaFast);
  const es = ema(closes, p.emaSlow);
  const md = macd(closes);

  return (f, pos): Intent => {
    const i = f.minute;

    // ---- exits ----
    if (pos) {
      if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
      if ((f.minute - pos.entryMinute) * tfMin >= p.timeStop) return { kind: "exit", reason: "time_stop" };
      const x = crossDir(ef, es, i);
      if (pos.optType === "call") {
        if (x === -1) return { kind: "exit", reason: "ema_cross_down" };
        if (f.close < pos.entryUnderlying - p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
      } else {
        if (x === 1) return { kind: "exit", reason: "ema_cross_up" };
        if (f.close > pos.entryUnderlying + p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
      }
      return null;
    }

    // ---- entries ----
    if (f.minutesToClose <= p.flattenBeforeClose) return null;
    if (f.atr <= 0) return null;
    if (f.relVol < p.volMult) return null; // volume confirmation

    const x = crossDir(ef, es, i);
    if (x === 0) return null;
    if (p.useMacd) {
      const macdBull = md.macd[i] >= md.signal[i];
      if (x === 1 && !macdBull) return null;
      if (x === -1 && macdBull) return null;
    }
    return x === 1
      ? { kind: "enter", direction: "call", reason: "ema_cross_up" }
      : { kind: "enter", direction: "put", reason: "ema_cross_down" };
  };
}
