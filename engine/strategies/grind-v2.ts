// ============================================================================
//  The Grinder v2 — the data-driven rework of `grind`.
//
//  This week's autopsy (06-01..05) showed grind's −$37 was three problems stacked:
//   (1) TIMING — it bled the 14:00–15:30 window (−$728, 33% win) and made its money
//       midday (11:00–14:00, +$713). So v2 adds an AFTERNOON CURFEW (no new entries
//       after `entryEndMin`) — the opposite of a lunch break.
//   (2) CHOP — it fired 147× at PF 0.99 with no trend filter. v2 gates entries on the
//       efficiency ratio (`erMin`) + a bigger momentum burst (`momTrigger`) → far fewer,
//       higher-quality entries.
//   (3) INSTA-EXIT — its 0.6/0.5·ATR target/stop booked on entry noise within a minute,
//       capturing ~5% of the available move. v2 drops the fixed target and LETS WINNERS
//       RUN via an ATR-chandelier trail (retrace `trailAtr`·ATR from the peak favorable
//       underlying once in profit) + a longer time box.
//
//  Still a scalper-flavoured momentum-burst channel — just timed, selective, and
//  trailed. DRAFT — must clear a real-option_bars backtest before it's armed.
// ============================================================================

import type { Features, Intent, Position } from "../types";

export interface GrindV2Params {
  momTrigger: number;        // |mom| ≥ momTrigger·ATR to fire (selectivity)
  volMin: number;            // relVol ≥ volMin (participation)
  erMin: number;             // efficiency ratio ≥ erMin — SKIP CHOP (the new gate)
  entryStartMin: number;     // earliest entry (minutes since 9:30 open) — e.g. 5 = 9:35
  entryEndMin: number;       // latest entry — the AFTERNOON CURFEW; 270 = 14:00 ET
  trailAtr: number;          // chandelier: exit when price retraces trailAtr·ATR from peak favorable
  stopAtr: number;           // pre-profit underlying stop (in ATRs) — wider than grind's 0.5
  timeStop: number;          // minutes held before the time box closes (longer → winners develop)
  flattenBeforeClose: number;// minutes-to-close: no new entries / force exit
  targetAtr?: number;        // if set → FIXED-target exit (grind's fast scalp), trail OFF (v3)
}

export const DEFAULT_GRIND_V2_PARAMS: GrindV2Params = {
  momTrigger: 0.8,
  volMin: 1.2,
  erMin: 0.35,
  entryStartMin: 5,    // 9:35
  entryEndMin: 270,    // 14:00 ET — curfew the −$728 graveyard
  trailAtr: 1.0,
  stopAtr: 0.8,
  timeStop: 20,
  flattenBeforeClose: 10,
};

// v3 — grind-v2's ENTRY discipline (curfew + er-gate + bigger burst) with grind's
// FAST fixed-target exit. The H1 backtest showed the v2 trail backfires in chop
// (runners revert; 23% win), while grind's tight scalp exit kept a positive gross.
export const DEFAULT_GRIND_V3_PARAMS: GrindV2Params = {
  momTrigger: 0.8,
  volMin: 1.2,
  erMin: 0.35,
  entryStartMin: 5,
  entryEndMin: 270,   // 14:00 curfew
  trailAtr: 1.0,      // unused (targetAtr set)
  stopAtr: 0.5,       // grind's tighter stop
  timeStop: 5,        // grind's fast time box
  flattenBeforeClose: 10,
  targetAtr: 0.6,     // grind's fast fixed target → trail OFF
};

export function grindV2Evaluate(
  f: Features,
  pos: Position | null,
  p: GrindV2Params = DEFAULT_GRIND_V2_PARAMS
): Intent {
  // ---- exits (when we hold) — let winners run via the chandelier; wider stop ----
  if (pos) {
    if (f.minutesToClose <= p.flattenBeforeClose) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= p.timeStop) return { kind: "exit", reason: "time_stop" };
    if (p.targetAtr != null) {
      // v3: keep grind's FAST fixed-target exit (chop rewards taking the quick profit;
      // the trail backfired — runners revert). Entry discipline does the lifting.
      if (pos.optType === "call") { if (f.close >= pos.entryUnderlying + p.targetAtr * f.atr) return { kind: "exit", reason: "target" }; }
      else { if (f.close <= pos.entryUnderlying - p.targetAtr * f.atr) return { kind: "exit", reason: "target" }; }
    } else {
      // v2: chandelier trail once in profit — harvest the burst instead of insta-exiting
      const inProfit = pos.optType === "call" ? f.close > pos.entryUnderlying : f.close < pos.entryUnderlying;
      if (inProfit && f.atr > 0) {
        const retraced = pos.optType === "call"
          ? f.close <= pos.peakFavorable - p.trailAtr * f.atr
          : f.close >= pos.peakFavorable + p.trailAtr * f.atr;
        if (retraced) return { kind: "exit", reason: "trail_chandelier" };
      }
    }
    // pre-profit underlying stop
    if (pos.optType === "call") {
      if (f.close <= pos.entryUnderlying - p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    } else {
      if (f.close >= pos.entryUnderlying + p.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    }
    return null;
  }

  // ---- entries (when flat) — burst + volume + trend, inside the session window ----
  if (f.minute < p.entryStartMin || f.minute >= p.entryEndMin) return null; // AM start + PM curfew
  if (f.minutesToClose <= p.flattenBeforeClose) return null;
  if (f.atr <= 0) return null;
  if (f.relVol < p.volMin) return null;
  if (f.er < p.erMin) return null; // SELECTIVITY: don't grind chop

  if (f.mom >= p.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -p.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}
