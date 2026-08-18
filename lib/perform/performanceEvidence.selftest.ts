import assert from "node:assert/strict";
import {
  combinePerformanceEvidenceState,
  summarizePerformanceIssue,
} from "./performanceEvidence";

assert.equal(combinePerformanceEvidenceState("checking", "ok"), "checking");
assert.equal(combinePerformanceEvidenceState("ok", "ok"), "ok");
assert.equal(combinePerformanceEvidenceState("ok", "blocked"), "partial");
assert.equal(combinePerformanceEvidenceState("blocked", "ok"), "partial");
assert.equal(combinePerformanceEvidenceState("blocked", "blocked"), "blocked");

const ids = [
  "3a0199d0-8949-454e-91b1-bc19ade6c19d",
  "3b646e69-a4ae-499e-a56c-4b346949eb52",
  "f441f3cc-2381-4ec1-85d7-0426cc074f66",
  "6ab05e3d-3f02-4418-b9c7-a59a215ccf93",
];
assert.equal(
  summarizePerformanceIssue(`performance positions lack immutable execution-account routing: ${ids.join(",")}`, 2),
  "4 older position rows lack verified account routing.",
);
assert.equal(combinePerformanceEvidenceState("partial", "ok"), "partial");
assert.equal(summarizePerformanceIssue("execution-route read failed: network unavailable"), "execution-route read failed: network unavailable");
assert.equal(summarizePerformanceIssue("selected account is not configured"), "selected account is not configured");

console.log("performance-evidence-selftest: split evidence contract passed");
