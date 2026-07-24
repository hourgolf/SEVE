import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateWeek1EvidenceBaseline,
  type Week1EvidenceBaseline,
} from "./week1EvidenceBaseline.js";

const baseline = JSON.parse(readFileSync(
  new URL("../../docs/evidence/week1-evidence-2026-07-20--2026-07-23.json", import.meta.url),
  "utf8",
)) as Week1EvidenceBaseline;
assert.deepEqual(validateWeek1EvidenceBaseline(baseline), []);
assert.equal(baseline.release.rootEraReset, false);
assert.equal(baseline.release.rootConfigurationChangeAuthorized, false);
assert.equal(baseline.cohort.allPnl, -230);
assert.equal(baseline.cohort.cleanAutoPnl, -480);
assert.equal(baseline.managerState.paths, 136);
assert.equal(baseline.managerState.censored, 0);
assert.equal(baseline.channelManagerHighlights.length, 6);
assert.equal(baseline.channelManagerHighlights.every((row) => row.hypothesisOnly), true);
assert.equal(baseline.interpretations.historicalPoolingAuthorized, false);
assert.equal(validateWeek1EvidenceBaseline({
  ...baseline,
  release: { ...baseline.release, rootEraReset: true as false },
}).includes("rootContinuityAuthorization"), true);
assert.equal(validateWeek1EvidenceBaseline({
  ...baseline,
  managerState: { ...baseline.managerState, terminal: 135 },
}).includes("managerTerminalState"), true);

console.log("week1-evidence-baseline-selftest: 12/12 PASS");
