import assert from "node:assert/strict";
import {
  decisionAtlasFreshness,
  decisionAtlasFreshnessLabel,
  decisionAtlasFreshnessShortLabel,
  etSessionDate,
} from "./decisionAtlasFreshness";

assert.equal(etSessionDate("2026-08-18T01:00:00.000Z"), "2026-08-17");
assert.equal(etSessionDate("not-a-date"), null);
assert.equal(decisionAtlasFreshness("2026-08-17", "2026-08-17"), "current");
assert.equal(decisionAtlasFreshness("2026-08-14", "2026-08-17"), "stale");
assert.equal(decisionAtlasFreshness("2026-08-18", "2026-08-17"), "current");
assert.equal(decisionAtlasFreshness(null, "2026-08-17"), "unknown");
assert.equal(decisionAtlasFreshnessLabel({
  freshness: "stale",
  reportThroughSession: "2026-08-14",
  evidenceThroughSession: "2026-08-17",
}), "STALE · REPORT 08/14 · DATA 08/17");
assert.equal(decisionAtlasFreshnessShortLabel({
  freshness: "stale",
  reportThroughSession: "2026-08-14",
}), "STALE · 08/14");

console.log("decision-atlas-freshness-selftest: PASS");
