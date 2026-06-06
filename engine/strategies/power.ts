// ============================================================================
//  Power Hour — 0DTE gamma, the final hour only. Sits flat until the last hour,
//  then leans WITH the day's direction (price vs VWAP confirmed by momentum) and
//  rides the convexity into the bell. Tight adverse stop; force-flat just before
//  close so we never hold a 0DTE into expiry. Parameterized for the sweep.
//
//  DRAFT thesis — must be backtested on real option_bars before it's armed.
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface PowerParams {
  windowMin: number; // only active when minutesToClose ≤ this (final hour = 60)
  momConfirm: number; // |mom| ≥ momConfirm·ATR to confirm the lean
  stopAtr: number; // adverse underlying move (in ATRs) that stops us out
  flattenBeforeClose: number; // force flat this many minutes before the close
  noVwap?: boolean; // drop the VWAP side-gate → pure momentum lean (matches live)
}

export const DEFAULT_POWER_PARAMS: PowerParams = {
  windowMin: 60,
  momConfirm: 0.25,
  stopAtr: 1.0,
  flattenBeforeClose: 3,
};

// Tightened-window variants (this week's cross-tab: the first half of power hour,
// 15:00–15:30, was a net loser; the edge is the final 30 min). Same params, shorter
// active window. Backtested vs the 60-min default before any live wiring.
export const DEFAULT_POWER_FINAL35: PowerParams = { ...DEFAULT_POWER_PARAMS, windowMin: 35 };
export const DEFAULT_POWER_FINAL30: PowerParams = { ...DEFAULT_POWER_PARAMS, windowMin: 30 };
// VWAP-off (momentum-only) variants — match how LIVE power trades (per-bar VWAP bug ≈
// no gate) and isolate the WINDOW change. These are the ones that map to live wiring.
export const DEFAULT_POWER_MOM60: PowerParams = { ...DEFAULT_POWER_PARAMS, windowMin: 60, noVwap: true };
export const DEFAULT_POWER_MOM35: PowerParams = { ...DEFAULT_POWER_PARAMS, windowMin: 35, noVwap: true };
export const DEFAULT_POWER_MOM30: PowerParams = { ...DEFAULT_POWER_PARAMS, windowMin: 30, noVwap: true };

export function powerEvaluate(
  f: Features,
  pos: Position | null,
  p: PowerParams = DEFAULT_POWER_PARAMS
): Intent {
  // ---- exits (when we hold) — ride toward the close, just cap the downside ----
  if (pos) {
    if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call" && f.close < pos.entryUnderlying - p.stopAtr * f.atr)
      return { kind: "exit", reason: "stop" };
    if (pos.optType === "put" && f.close > pos.entryUnderlying + p.stopAtr * f.atr)
      return { kind: "exit", reason: "stop" };
    return null;
  }

  // ---- entries (when flat) — final hour only, lean with the day's trend ----
  if (f.minutesToClose > p.windowMin) return null; // not the power hour yet
  if (f.minutesToClose <= p.flattenBeforeClose) return null; // too close to the bell
  if (f.atr <= 0) return null;

  // `noVwap` drops the VWAP side-gate (which live runs with ≈off due to the per-bar
  // VWAP bug, AND which the H1 backtest shows removes power's counter-VWAP edge) →
  // a pure momentum lean into the close, matching how live power actually trades.
  const bull = (p.noVwap || f.close > f.vwap) && f.mom > p.momConfirm * f.atr;
  const bear = (p.noVwap || f.close < f.vwap) && f.mom < -p.momConfirm * f.atr;

  if (bull) return { kind: "enter", direction: "call", reason: "power_hour_long" };
  if (bear) return { kind: "enter", direction: "put", reason: "power_hour_short" };
  return null;
}
