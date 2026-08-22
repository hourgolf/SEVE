import assert from "node:assert/strict";
import {
  NEXT_WEEK_BASE_MANIFEST_HASH,
  NEXT_WEEK_OBSERVE_ONLY,
  NEXT_WEEK_ROSTER_DECISIONS,
  boundedWeekReplay,
  validateNextWeekDecisionPlan,
} from "./nextWeekRoster20260824.js";

validateNextWeekDecisionPlan();
assert.match(NEXT_WEEK_BASE_MANIFEST_HASH, /^sha256:[a-f0-9]{64}$/);
assert.equal(NEXT_WEEK_ROSTER_DECISIONS.length, 10);
assert.equal(NEXT_WEEK_OBSERVE_ONLY.length, 8);
assert.equal(NEXT_WEEK_ROSTER_DECISIONS.filter((row) =>
  row.action === "paper_trial").length, 2);
assert.deepEqual(NEXT_WEEK_ROSTER_DECISIONS.filter((row) =>
  row.account === "Account 3").map((row) => row.channel), [
  "orb-ustop-ctl", "breakout-alt-v3-itm", "grind-v3",
]);

const pnl: Record<string, number> = {
  "orb-ustop-ctl": 90,
  "pb-ride": 32,
  "pb-ride-itm": 30,
  "breakout-alt-v3-itm": -14,
  breakout: -32,
  "vb-ribbon-cross-iwm": -46,
  "qqq-thrust-trail-wd": -52,
  "grind-v3-2": -74,
  "breakout-alt-v3-iwm": -74,
  "vb-level-break": -100,
  "grind-smart-entries": -118,
  "grind-v3": -120,
  "vb-gap-drift": -184,
  "breakout-qqq": -218,
  "orb-qqq-trail": -242,
  "vb-macd-state": -472,
  "momo-shape-2": -828,
};
const rows = Object.entries(pnl).map(([channel, actualPnl]) => ({
  channel,
  actualPnl,
  bestManager: channel === "vb-macd-state"
    ? { id: "WIDE20/50", totalDelta: 635.9997 }
    : channel === "vb-level-break"
      ? { id: "LOCK50/30", totalDelta: 169.9999 }
      : null,
}));
const replay = boundedWeekReplay(rows);
assert.equal(replay.actualDeskPnlUsd, -2422);
assert.equal(replay.observeOnlyAvoidanceUsd, 1008);
assert.equal(replay.sizingDifferenceUsd, 567);
assert.ok(Math.abs(replay.directionalReplayUsd - (-41.0004)) < 0.001);

console.log("next-week-roster-2026-08-24-selftest: 10/10 passed");
