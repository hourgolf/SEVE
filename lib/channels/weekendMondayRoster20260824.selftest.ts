import assert from "node:assert/strict";
import {
  WEEKEND_MONDAY_OBSERVE_TRANSITIONS,
  WEEKEND_MONDAY_ROSTER,
  validateWeekendMondayRoster,
} from "./weekendMondayRoster20260824";

validateWeekendMondayRoster();
assert.equal(WEEKEND_MONDAY_ROSTER.length, 10);
assert.deepEqual(WEEKEND_MONDAY_ROSTER.filter((row) => row.account === "Account 1").map((row) => row.channel), [
  "momo-shape-2", "grind-smart-entries", "vb-curl-reversal-iwm",
]);
assert.deepEqual(WEEKEND_MONDAY_ROSTER.filter((row) => row.account === "Account 2").map((row) => row.channel), [
  "vb-macd-state", "vb-level-break", "vb-gap-drift-qqq", "vb-or-fail-iwm",
]);
assert.deepEqual(WEEKEND_MONDAY_ROSTER.filter((row) => row.account === "Account 3").map((row) => row.channel), [
  "orb-ustop-ctl", "orb-trend-rider", "pb-ride",
]);
assert.deepEqual(WEEKEND_MONDAY_OBSERVE_TRANSITIONS, [
  "vb-curl-reversal-qqq", "pb-ride-itm", "grind-v3", "vb-rsi-revert-iwm",
  "breakout", "breakout-alt-v3-itm",
]);
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "momo-shape-2")?.entryCap, 2);
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "pb-ride")?.familyId, "SPY-PB");
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "vb-gap-drift-qqq")?.quantity, 2);
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "grind-smart-entries")?.quantity, 4);
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "vb-level-break")?.quantity, 4);
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "orb-trend-rider")?.manager, "ORB-ALL-OUT-50");
assert.equal(WEEKEND_MONDAY_ROSTER.find((row) => row.channel === "vb-or-fail-iwm")?.manager, "VB-OR-FAIL-IWM-ALL-OUT-15");
console.log("weekendMondayRoster20260824.selftest: PASS");
