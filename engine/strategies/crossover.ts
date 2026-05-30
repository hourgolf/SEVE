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
  erMin: number; // regime gate: only trade when efficiency ratio ≥ this (0 = off)
}

// Defaults chosen from the MIDDLE of the robust region in the OOS-validated
// sweep (engine/sweep-cross.ts) — profitable in both the Jan–Mar and Apr–May
// windows with a healthy trade count, not the single cherry-picked best.
// IMPORTANT: this edge lives on the 15-MINUTE timeframe; run the strategy on
// 15m bars (1m whipsaws and bleeds friction — it loses there).
export const DEFAULT_CROSS_PARAMS: CrossParams = {
  emaFast: 12,
  emaSlow: 26,
  volMult: 1.2,
  useMacd: false, // MACD confirmation didn't improve results in the sweep
  stopAtr: 1.5,
  timeStop: 45,
  flattenBeforeClose: 35,
  erMin: 0, // set by the regime-filter sweep below
};

// Build the evaluator for one session (precomputes EMA/MACD over its closes;
// `f.minute` indexes them). `tfMin` is the bar size so the time-stop stays in
// real minutes across timeframes. Returned shape matches the shared Evaluate type.
// `dayBias` is the higher-timeframe daily-trend context for this session:
// +1 = SPY above its daily MA (favor calls), -1 = below (favor puts), 0 = off.
// When set, entries against the daily trend are rejected ("don't fight the
// higher timeframe").
export function makeCrossover(
  closes: number[],
  p: CrossParams = DEFAULT_CROSS_PARAMS,
  tfMin = 1,
  dayBias = 0
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
    if (p.erMin > 0 && f.er < p.erMin) return null; // regime gate: skip chop

    const x = crossDir(ef, es, i);
    if (x === 0) return null;
    if (dayBias > 0 && x === -1) return null; // daily uptrend: no puts
    if (dayBias < 0 && x === 1) return null; // daily downtrend: no calls
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
