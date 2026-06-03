// ============================================================================
//  Per-channel EXIT MANAGEMENT — each channel handles take-profit / breakeven /
//  trail DIFFERENTLY, per its thesis. NOT a global rule. (Interim home: this
//  by-slug map; the end-state is each block living in the channel's .md thesis →
//  spec.management. The worker resolves: spec.management ?? MANAGEMENT_BY_SLUG[slug].)
//
//  Mechanics (engine/manage.ts): R = entryPremium × premiumStopPct/100, so with
//  premiumStopPct=50: +30% premium = 0.6R · +50% = 1.0R · +75% = 1.5R · +100% =
//  2.0R. A scaleOut rung's `then:"engage_trail"` arms the trail AND a breakeven
//  floor on the remainder; `move_stop_breakeven` arms only the BE floor.
//
//  Tuned to the 2026-06-03 give-back study (npm run giveback-study / exit-study):
//  winners ran +20–54% then round-tripped (some to −40/−50%) because exits watched
//  the UNDERLYING / a clock, never the premium peak. POWER is the exception — its
//  edge is the convex final-hour tail, so it scales only LATE (+100%) and rides.
// ============================================================================

import type { Management } from "../lib/desk/strategySpec";

// Runner channels (momentum / trend): scale 1/3 at +30% → BE, scale 1/3 at +75%
// → engage trail, ride the last third with a 40%-of-peak giveback trail.
const RUNNER = (eodFlattenMinToClose: number): Management => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  scaleOut: [
    { atR: 0.6, fraction: 0.34, then: "move_stop_breakeven" }, // +30% → bank 1/3, can't lose
    { atR: 1.5, fraction: 0.33, then: "engage_trail" },        // +75% → bank 1/3, arm the trail
  ],
  trail: { mode: "premium_giveback", premiumGivebackPct: 40 },
  eodFlattenMinToClose,
});

// Scalper channels: faster, tighter. Scale 1/3 at +30% AND engage trail+BE
// immediately (give back ≤30% of peak — locks the scalp), 5-min time stop.
const SCALP = (eodFlattenMinToClose: number): Management => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  scaleOut: [{ atR: 0.6, fraction: 0.34, then: "engage_trail" }], // +30% → bank 1/3, BE + trail
  trail: { mode: "premium_giveback", premiumGivebackPct: 30 },
  timeStop: { minutesHeld: 5 },
  eodFlattenMinToClose,
});

// Channels that get managed (proven on the 2026-06-03 A/B, npm run manage-ab):
// the RUNNERS + grind-smart round-trip winners, so scale/BE/trail wins. NOTABLY
// ABSENT — and deliberately so, both by the 63-session backtest AND the 06-03 A/B
// on real fills:
//   • power / power-smart-entries — managing CAPS the convex final-hour tail
//     (A/B: −$1,068 / −$1,032). Its edge IS the tail → ride it (keep the worker's
//     base ATR stop + premium −50% stop + the existing late +100% giveback trail).
//   • grind (base scalper) — its tight 0.6-ATR target already captures peaks;
//     adding tranches just bleeds spread cost (A/B: −$755). Leave it.
// So management is OPT-IN per channel; an absent slug = unmanaged (worker default).
export const MANAGEMENT_BY_SLUG: Record<string, Management> = {
  // --- momentum runners (breakout +51%→+6%, breakout-smart +20%→−50% today) ---
  breakout: RUNNER(35),
  "breakout-smart-entries": RUNNER(35),
  "orb-trend-rider": RUNNER(5),

  // --- grind-smart gave back +40%→−40% today — the BE floor stops that ---
  "grind-smart-entries": SCALP(10),

  // --- mean reversion: scale half at +30% → BE, modest trail back toward entry ---
  fade: {
    risk: { defineR: "premium_stop", premiumStopPct: 50 },
    scaleOut: [{ atR: 0.6, fraction: 0.5, then: "engage_trail" }],
    trail: { mode: "premium_giveback", premiumGivebackPct: 35 },
    timeStop: { minutesHeld: 20 },
    eodFlattenMinToClose: 35,
  },
};

export function managementFor(slug: string): Management | undefined {
  return MANAGEMENT_BY_SLUG[slug];
}
