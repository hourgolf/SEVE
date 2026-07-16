import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FAMILY_PREREGISTRATION,
  FAMILY_PREREGISTERED_TESTS,
  classifyFamilyPreregistrationCohort,
  validateFamilyPreregistration,
} from "./familyPreregistration.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks += 1;
};

check("contract validates", validateFamilyPreregistration(), []);
check("version and boundary are frozen", [
  FAMILY_PREREGISTRATION.version,
  FAMILY_PREREGISTRATION.developmentThroughEt,
  FAMILY_PREREGISTRATION.prospectiveHoldoutFromEt,
], ["phase1k-e-family-preregister-v1", "2026-07-15", "2026-07-16"]);
check("nine named tests are frozen", FAMILY_PREREGISTERED_TESTS.map((test) => test.id), [
  "PB-COLLISION-ONE-SURVIVOR",
  "PB-RIDE2-VS-RIDE-CAPTURE",
  "ORB-SPY-COLLISION-ONE-SURVIVOR",
  "ORB-TREND-VS-USTOP-CTL-CAPTURE",
  "GRIND-V3-VS-V3-2-CAPTURE",
  "GRIND-SMART-PATH-VIABILITY",
  "QQQ-THRUST-VS-WD-CAPTURE",
  "QQQ-ORB-PATH-VIABILITY",
  "IWM-ALT-VS-SMART-CAPTURE",
]);
check("collision tests require 10 groups and 5 sessions", FAMILY_PREREGISTERED_TESTS
  .filter((test) => test.mode === "collision_one_survivor")
  .map((test) => [test.evidenceFloor.minimumCompletedCollisionGroups, test.evidenceFloor.minimumIndependentSessions]), [[10, 5], [10, 5]]);
check("pair tests require 10 clocks and 5 sessions", FAMILY_PREREGISTERED_TESTS
  .filter((test) => test.mode === "matched_clock_pair")
  .map((test) => [test.evidenceFloor.minimumMatchedClocks, test.evidenceFloor.minimumIndependentSessions]), [[10, 5], [10, 5], [10, 5], [10, 5], [10, 5]]);
check("single-channel viability requires 20 exact paths", FAMILY_PREREGISTERED_TESTS
  .filter((test) => test.mode === "channel_path_viability")
  .map((test) => test.evidenceFloor.minimumExactNativePaths), [20, 20]);
check("QQQ and IWM are never pooled", FAMILY_PREREGISTERED_TESTS
  .filter((test) => test.family === "QQQ" || test.family === "IWM")
  .map((test) => [test.family, test.underlying]), [["QQQ", "QQQ"], ["QQQ", "QQQ"], ["IWM", "IWM"]]);
check("operator and invalid paths are censored", FAMILY_PREREGISTRATION.outcomeEligibility, {
  included: "native_closed_with_booked_pnl",
  operatorManaged: "censored",
  testOrCorrection: "censored",
  missingOrInvalidPath: "censored",
});
check("development dates classify only as development", classifyFamilyPreregistrationCohort(["2026-07-13", "2026-07-15"]), "development");
check("July 16 starts prospective holdout", classifyFamilyPreregistrationCohort(["2026-07-16", "2026-07-17"]), "prospective_holdout");
assert.throws(() => classifyFamilyPreregistrationCohort(["2026-07-15", "2026-07-16"]), /cannot be pooled/); checks += 1;
assert.throws(() => classifyFamilyPreregistrationCohort([]), /at least one/); checks += 1;
check("no test can change policy", FAMILY_PREREGISTERED_TESTS.every((test) => test.policyChangeAuthorized === false), true);
check("contract cannot change production", [FAMILY_PREREGISTRATION.policyChangeAuthorized, FAMILY_PREREGISTRATION.productionChangeAuthorized], [false, false]);

// This hash is filled from the canonical JSON object and pins silent edits.
const sha256 = createHash("sha256").update(JSON.stringify(FAMILY_PREREGISTRATION)).digest("hex");
check("canonical preregistration hash", sha256, "c76ee87c51fdec215b3b624c8495951ee2f74f1c4b3b6eca205e274840e1e015");

console.log(`family-preregistration-selftest: ${checks}/${checks} PASS`);
