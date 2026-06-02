// ============================================================================
//  Smart-roster specs (Brief PR5) — the four `*-smart` channels as compiled
//  StrategySpecs, hand-authored from docs/channels/*-smart.md (deterministic, no
//  billed compile). Registered alongside the code originals for the A/B harness
//  (engine/ab.ts). Feed-dependent entry conditions (gamma_regime, iv_rank) are
//  kept for fidelity but ignored by specToEvaluate until those feeds exist.
//  NOTE: scale-IN is in the specs but not yet executed (manage.ts defers it).
// ============================================================================

import type { Condition, StrategySpec } from "../lib/desk/strategySpec";

const MGMT_DEFAULT_SCALE = [
  { atR: 1.0, fraction: 0.34, then: "move_stop_breakeven" as const },
  { atR: 2.0, fraction: 0.33, then: "engage_trail" as const },
];

// Shared fade ENTRY gates (supported-vocabulary subset of the fade thesis: an OR
// break that has stretched ≥1.5 ATR past VWAP with decelerating momentum). Used
// by BOTH fade-long (single-leg) and fade-spread (credit vertical) so the A/B
// isolates STRUCTURE — same signal, different expression. (The naked code `fade`
// also gates on |mom|; these one-sided momentum_atr gates are the closest the
// compiled vocabulary gets — see add-channel-vocab-parity.)
const FADE_UP: Condition[] = [
  { kind: "opening_range", minutes: 30, side: "break_above" },
  { kind: "vwap_dev", atr: 1.5, cmp: ">" },
  { kind: "momentum_atr", op: "<=", value: 0.6 },
  { kind: "time_before", et: "15:25" },
];
const FADE_DN: Condition[] = [
  { kind: "opening_range", minutes: 30, side: "break_below" },
  { kind: "vwap_dev", atr: 1.5, cmp: "<" },
  { kind: "momentum_atr", op: ">=", value: -0.6 },
  { kind: "time_before", et: "15:25" },
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

// ── MULTI-LEG A/B specs (Brief: MULTI-LEG, Phase 1 proof) ───────────────────
// Two expressions of the SAME fade signal, for `npm run ab --pair fade:… --options
// databento`. fade-long = single-leg (the spec twin of the naked code fade, for
// entry-fidelity + a real-NBBO single-leg baseline); fade-spread = the credit
// vertical (the thesis' "structurally correct" form — sell the spread the tape
// should respect). Reading both against the SAME base (naked `fade`) column
// isolates structure. Exits speak each structure's natural %: single-leg on
// premium, credit on the credit (profit 50 / stop 100 = "+50% of credit / −2×").
export const MULTILEG_SPECS: Record<string, StrategySpec> = {
  "fade-long": {
    meta: { strategyId: "fade-long", name: "The Fade (single-leg spec)", instrument: "SPY", structure: "single-leg", dteRange: [0, 1], regime: "range-bound", direction: "directional" },
    entries: [
      { direction: "put", reason: "fade_up", all: FADE_UP },
      { direction: "call", reason: "fade_dn", all: FADE_DN },
    ],
    exits: [{ profitPct: 50, stopPct: 50, timeET: "15:00" }],
    sizing: {},
  },

  "fade-spread": {
    // Upside stretch → expect reversion/containment → SELL a CALL credit spread
    // (short just-OTM call, long wing $3 higher). Downside → SELL a PUT credit
    // spread. direction is informational for multi-leg (legs drive the trade).
    meta: { strategyId: "fade-spread", name: "The Fade (credit spread)", instrument: "SPY", structure: "vertical-spread", dteRange: [0, 1], regime: "range-bound / positive-gamma", direction: "neutral" },
    entries: [
      {
        direction: "put", reason: "fade_up_call_credit", all: FADE_UP,
        legs: [{ optType: "call", side: "short", strikeOffset: 1 }, { optType: "call", side: "long", strikeOffset: 4 }],
      },
      {
        direction: "call", reason: "fade_dn_put_credit", all: FADE_DN,
        legs: [{ optType: "put", side: "short", strikeOffset: -1 }, { optType: "put", side: "long", strikeOffset: -4 }],
      },
    ],
    exits: [{ profitPct: 50, stopPct: 100, timeET: "15:00" }],
    sizing: {},
  },

  // Thesis #3 Variant B (ORB-anchored credit spread) — the ONE multi-leg thesis
  // whose entry uses only SUPPORTED features (OR break + width + clock), and it's
  // CONTINUATION-aligned (the desk's settled edge is momentum, not reversion). On
  // a break ABOVE the OR high, sell a PUT spread BELOW (bet the range floor holds
  // as support now that we're above it); mirror on a break below. NOTE: the thesis
  // anchors the short strike to the OR boundary / gamma wall — the spec leg model
  // is ATM-relative only, so this APPROXIMATES it with fixed offsets (a level-
  // anchored leg geometry is a follow-on if this signal proves out).
  "orb-credit": {
    meta: { strategyId: "orb-credit", name: "ORB Credit Spread (thesis #3B)", instrument: "SPY", structure: "vertical-spread", dteRange: [0, 1], regime: "trending / range-respecting", direction: "neutral" },
    entries: [
      {
        direction: "call", reason: "orb_up_put_credit",
        all: [{ kind: "opening_range", minutes: 30, side: "break_above" }, { kind: "or_width_min", pct: 0.2 }, { kind: "time_before", et: "14:00" }],
        legs: [{ optType: "put", side: "short", strikeOffset: -2 }, { optType: "put", side: "long", strikeOffset: -5 }],
      },
      {
        direction: "put", reason: "orb_dn_call_credit",
        all: [{ kind: "opening_range", minutes: 30, side: "break_below" }, { kind: "or_width_min", pct: 0.2 }, { kind: "time_before", et: "14:00" }],
        legs: [{ optType: "call", side: "short", strikeOffset: 2 }, { optType: "call", side: "long", strikeOffset: 5 }],
      },
    ],
    exits: [{ profitPct: 50, stopPct: 100, timeET: "15:00" }],
    sizing: {},
  },

  // Same thesis #3B, but the short strike is ANCHORED to the OR boundary (the
  // level the tape should respect) instead of a fixed ATM offset — thesis #3's
  // "edge multiplier." Break ABOVE → sell a PUT spread at/under the OR LOW (bet it
  // holds as support); break BELOW → sell a CALL spread at/over the OR HIGH. The
  // anchor resolves to real strikes at signal time (needs the wider Databento
  // cache when the OR is far from spot — some entries skip if a leg is unquotable).
  "orb-credit-anchored": {
    meta: { strategyId: "orb-credit-anchored", name: "ORB Credit Spread · level-anchored", instrument: "SPY", structure: "vertical-spread", dteRange: [0, 1], regime: "trending / range-respecting", direction: "neutral" },
    entries: [
      {
        direction: "call", reason: "orb_up_put_credit_anchored",
        all: [{ kind: "opening_range", minutes: 30, side: "break_above" }, { kind: "or_width_min", pct: 0.2 }, { kind: "time_before", et: "14:00" }],
        legs: [{ optType: "put", side: "short", anchor: "orb_lo", strikeOffset: -1 }, { optType: "put", side: "long", anchor: "orb_lo", strikeOffset: -4 }],
      },
      {
        direction: "put", reason: "orb_dn_call_credit_anchored",
        all: [{ kind: "opening_range", minutes: 30, side: "break_below" }, { kind: "or_width_min", pct: 0.2 }, { kind: "time_before", et: "14:00" }],
        legs: [{ optType: "call", side: "short", anchor: "orb_hi", strikeOffset: 1 }, { optType: "call", side: "long", anchor: "orb_hi", strikeOffset: 4 }],
      },
    ],
    exits: [{ profitPct: 50, stopPct: 100, timeET: "15:00" }],
    sizing: {},
  },
};

// `slug` → base pair (strip the -smart suffix).
export function basePairOf(smartSlug: string): string {
  return smartSlug.replace(/-smart$/, "");
}
