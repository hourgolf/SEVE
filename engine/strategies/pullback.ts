// ============================================================================
//  Pullback-continuation (PB-ride) — the first generative-inventory survivor.
//
//  LINEAGE (2026-06-12): born as the generative residue of the EMA-stretch
//  refutation (the operator's band-respect chart-read), KILLED at 0DTE
//  (ema-pullback-probe: 67% premium-stop rate — gamma was the murder weapon),
//  RESURRECTED at 1DTE by the operator's walk-thought (one-dte-probe: +$4,632,
//  +18.5/t, 42% win, POSITIVE 4/5 regime windows; only MA25 red). A pullback
//  entry needs minutes of room; 1DTE time value provides it. DIVERSIFIER-grade
//  edge (+18.5/t vs V3's +221/t) — drafted for the paper lab, NOT armed.
//
//  SHAPE: in an established trend (EMA9/21 ribbon stacked with the trade), wait
//  for price to RETRACE to the band (≤ touchAtr of EMA21) after a recent
//  ≥ stretchMin·ATR extension, enter WITH the trend on the bounce bar. RIDE
//  exits only: 15:25-ish flatten here + the worker/engine catastrophic −50%
//  premium stop. ⚠ MUST run with entry_dte=1 (strategist_config) — the 0DTE
//  variant is REFUTED; the channel's edge IS the 1DTE time value.
//
//  Ported 1:1 from engine/ema-pullback-probe.ts makeEval(scalp=false,
//  needVol=false) — pb-selftest.ts proves trade-identical output.
// ============================================================================

import { ema } from "../../lib/indicators";
import type { Bar, Evaluate, Intent } from "../types";

export interface PullbackParams {
  stretchMin: number;      // recent extension (ATR units vs EMA21) that defines "in a move"
  stretchLookback: number; // bars to look back for that extension
  touchAtr: number;        // |close − EMA21| ≤ this (ATR units) = the band tag
  entryStartMin: number;   // minutes since open (30 = 10:00 ET)
  entryEndMin: number;     // afternoon curfew (270 = 14:00 ET — the family-wide finding)
  flattenMtc: number;      // minutes-to-close force flatten (35 ≈ 15:25)
}

export const DEFAULT_PULLBACK_PARAMS: PullbackParams = {
  stretchMin: 2.0,
  stretchLookback: 30,
  touchAtr: 0.5,
  entryStartMin: 30,
  entryEndMin: 270,
  flattenMtc: 35,
};

// Registry-shape build: precompute per-session EMA/stretch arrays once (the same
// math the probe used), return the per-bar Evaluate. ATR(14) mirrors engine.ts.
export function buildPullback(bars: Bar[], _tfMin: number, p: PullbackParams = DEFAULT_PULLBACK_PARAMS): Evaluate {
  const closes = bars.map((b) => b.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const stretchC: number[] = [], stretchP: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 13); j <= i; j++) { sum += bars[j].high - bars[j].low; n++; }
    const a = Math.max(1e-9, sum / n);
    stretchC.push((closes[i] - e21[i]) / a);
    stretchP.push((e21[i] - closes[i]) / a);
  }
  return (f, pos): Intent => {
    const i = f.minute;
    if (pos) {
      if (f.minutesToClose <= p.flattenMtc) return { kind: "exit", reason: "eod_flatten" };
      return null; // ride — the catastrophic −50% premium stop is the driver's
    }
    if (i < p.entryStartMin || i > p.entryEndMin || i < 22) return null;
    if (f.atr <= 0) return null;
    for (const dir of ["call", "put"] as const) {
      const st = dir === "call" ? stretchC : stretchP;
      if (dir === "call" ? e9[i] <= e21[i] : e9[i] >= e21[i]) continue; // ribbon stacked with trade
      let hadStretch = false;
      for (let j = Math.max(0, i - p.stretchLookback); j < i; j++) if (st[j] >= p.stretchMin) { hadStretch = true; break; }
      if (!hadStretch) continue;
      if (Math.abs(st[i - 1]) > p.touchAtr) continue;                 // prior bar tagged the band
      if (dir === "call" ? f.mom <= 0 : f.mom >= 0) continue;         // bounce = with-trend close
      return { kind: "enter", direction: dir, reason: "pb_ride" };
    }
    return null;
  };
}
