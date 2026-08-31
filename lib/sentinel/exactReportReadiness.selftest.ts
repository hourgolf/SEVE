import assert from "node:assert/strict";
import { sentinelExactReportReadiness } from "./exactReportReadiness";

const requestEnds = ["2026-08-28T20:00:00.000Z"];
const before = Date.parse("2026-08-28T23:00:00.000Z");
const after = Date.parse("2026-08-30T23:00:00.000Z");
assert.equal(sentinelExactReportReadiness({ requestEnds, nowMs: before }).state, "not_due");
assert.equal(sentinelExactReportReadiness({ requestEnds, nowMs: after }).state, "missing");
assert.equal(sentinelExactReportReadiness({ reportState: "exact_pending", requestEnds, nowMs: after }).state, "missing");
assert.equal(sentinelExactReportReadiness({ reportState: "complete", requestEnds, nowMs: after }).state, "ok");
assert.equal(sentinelExactReportReadiness({ reportState: "censored", requestEnds, nowMs: after }).state, "error");
assert.equal(sentinelExactReportReadiness({ requestEnds: [], nowMs: after }).state, "missing");
console.log("Sentinel exact report readiness selftest passed");
