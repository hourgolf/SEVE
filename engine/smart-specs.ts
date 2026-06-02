// ============================================================================
//  Smart-roster specs (Brief PR5) — the four `*-smart` channels as compiled
//  StrategySpecs, hand-authored from docs/channels/*-smart.md (deterministic, no
//  billed compile). Registered alongside the code originals for the A/B harness
//  (engine/ab.ts). Feed-dependent entry conditions (gamma_regime, iv_rank) are
//  kept for fidelity but ignored by specToEvaluate until those feeds exist.
//  NOTE: scale-IN is in the specs but not yet executed (manage.ts defers it).
// ============================================================================

import type { StrategySpec } from "../lib/desk/strategySpec";

const MGMT_DEFAULT_SCALE = [
  { atR: 1.0, fraction: 0.34, then: "move_stop_breakeven" as const },
  { atR: 2.0, fraction: 0.33, then: "engage_trail" as const },
];

export const SMART_SPECS: Record<string, StrategySpec> = {
  "breakout-smart": {
    meta: { strategyId: "breakout-smart", name: "The Breakout (Smart)", instrument: "SPY", structure: "single-leg", dteRange: [0, 1], regime: "trending", direction: "directional" },
    entries: [
      { direction: "call", reason: "break_high", all: [{ kind: "opening_range", minutes: 30, side: "break_above" }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
      { direction: "put", reason: "break_low", all: [{ kind: "opening_range", minutes: 30, side: "break_below" }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
    ],
    exits: [], sizing: {},
    management: {
      risk: { defineR: "premium_stop", premiumStopPct: 50, structuralStop: { kind: "failed_break", insideAtr: 0.75 } },
      scaleOut: MGMT_DEFAULT_SCALE,
      trail: { mode: "hybrid", atrChandelier: { baseK: 1.5, kMin: 0.6, rTighten: 0.2, timeTighten: 0.5 }, premiumGivebackPct: 35 },
      scaleIn: { enabled: true, onlyAfterR: 1.0, requireStopAtBreakeven: true, addFraction: 0.5, forbidIfBelowEntryPremium: true },
      timeStop: { thetaTightenAfter: "13:30" }, eodFlattenMinToClose: 35,
    },
  },

  "fade-smart": {
    meta: { strategyId: "fade-smart", name: "The Fade (Smart)", instrument: "SPY", structure: "single-leg", dteRange: [0, 1], regime: "range-bound / positive-gamma", direction: "directional" },
    entries: [
      { direction: "put", reason: "fade_up", all: [{ kind: "opening_range", minutes: 30, side: "break_above" }, { kind: "vwap_dev", atr: 1.5, cmp: ">" }, { kind: "momentum_atr", op: "<=", value: 0.6 }, { kind: "gamma_regime", require: "POSITIVE" }, { kind: "iv_rank", cmp: "<", value: 50 }, { kind: "time_before", et: "15:25" }] },
      { direction: "call", reason: "fade_dn", all: [{ kind: "opening_range", minutes: 30, side: "break_below" }, { kind: "vwap_dev", atr: 1.5, cmp: "<" }, { kind: "momentum_atr", op: ">=", value: -0.6 }, { kind: "gamma_regime", require: "POSITIVE" }, { kind: "iv_rank", cmp: "<", value: 50 }, { kind: "time_before", et: "15:25" }] },
    ],
    exits: [], sizing: {},
    management: {
      risk: { defineR: "premium_stop", premiumStopPct: 50, structuralStop: { kind: "atr_adverse", atr: 1.0 } },
      scaleOut: [{ atR: 1.0, fraction: 0.5, then: "move_stop_breakeven" }],
      trail: { mode: "premium_giveback", premiumGivebackPct: 30 },
      scaleIn: { enabled: false, forbidIfBelowEntryPremium: true },
      target: { kind: "vwap_fraction", fraction: 0.5 },
      timeStop: { minutesHeld: 20, thetaTightenAfter: "13:30" }, eodFlattenMinToClose: 35,
    },
  },

  "grind-smart": {
    meta: { strategyId: "grind-smart", name: "The Grinder (Smart)", instrument: "SPY", structure: "single-leg", dteRange: [0, 1], regime: "trending", direction: "directional" },
    entries: [
      { direction: "call", reason: "g_up", all: [{ kind: "momentum_atr", op: ">=", value: 0.5 }, { kind: "rel_vol", min: 1.1 }, { kind: "efficiency_ratio", op: ">=", value: 0.4 }, { kind: "time_before", et: "15:50" }] },
      { direction: "put", reason: "g_dn", all: [{ kind: "momentum_atr", op: "<=", value: -0.5 }, { kind: "rel_vol", min: 1.1 }, { kind: "efficiency_ratio", op: ">=", value: 0.4 }, { kind: "time_before", et: "15:50" }] },
    ],
    exits: [], sizing: {},
    management: {
      risk: { defineR: "premium_stop", premiumStopPct: 40, structuralStop: { kind: "atr_adverse", atr: 0.5 } },
      scaleOut: [{ atR: 1.0, fraction: 0.5, then: "move_stop_breakeven" }],
      trail: { mode: "premium_giveback", premiumGivebackPct: 30 },
      scaleIn: { enabled: false, forbidIfBelowEntryPremium: true },
      costGate: { minMoveToCostRatio: 3.0 },
      timeStop: { minutesHeld: 5, thetaTightenAfter: "13:30" }, eodFlattenMinToClose: 10,
    },
  },

  "power-smart": {
    meta: { strategyId: "power-smart", name: "Power Hour (Smart)", instrument: "SPY", structure: "single-leg", dteRange: [0, 0], regime: "final hour", direction: "directional" },
    entries: [
      { direction: "call", reason: "power_long", all: [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.25 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
      { direction: "put", reason: "power_short", all: [{ kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.25 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
    ],
    exits: [], sizing: {},
    management: {
      risk: { defineR: "premium_stop", premiumStopPct: 50, structuralStop: { kind: "atr_adverse", atr: 1.0 } },
      scaleOut: MGMT_DEFAULT_SCALE,
      trail: { mode: "hybrid", atrChandelier: { baseK: 1.2, kMin: 0.5, rTighten: 0.25, timeTighten: 0.8 }, premiumGivebackPct: 30 },
      scaleIn: { enabled: false, forbidIfBelowEntryPremium: true },
      timeStop: { thetaTightenAfter: "15:30" }, eodFlattenMinToClose: 3,
    },
  },
};

// `slug` → base pair (strip the -smart suffix).
export function basePairOf(smartSlug: string): string {
  return smartSlug.replace(/-smart$/, "");
}
