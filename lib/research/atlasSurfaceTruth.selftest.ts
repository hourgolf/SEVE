import assert from "node:assert/strict";
import { deriveAtlasReportTruth } from "./atlasSurfaceTruth";

const stale = deriveAtlasReportTruth({
  state: "ready",
  freshness: "stale",
  reportThroughSession: "2026-09-18",
  evidenceThroughSession: "2026-09-25",
  publicationState: "verified",
});
assert.equal(stale.authority, "stale");
assert.equal(stale.publishedDecisionUsable, false);
assert.match(stale.label, /PUBLISHED 09\/18 · DATA 09\/25/);
assert.match(stale.fact, /remain historical/);

const unverified = deriveAtlasReportTruth({
  state: "ready",
  freshness: "current",
  reportThroughSession: "2026-09-25",
  evidenceThroughSession: "2026-09-25",
  publicationState: "unverified",
});
assert.equal(unverified.authority, "current_unverified");
assert.equal(unverified.publishedDecisionUsable, false);

const verified = deriveAtlasReportTruth({
  state: "ready",
  freshness: "current",
  reportThroughSession: "2026-09-25",
  evidenceThroughSession: "2026-09-25",
  publicationState: "verified",
});
assert.equal(verified.authority, "verified_current");
assert.equal(verified.publishedDecisionUsable, true);

const unavailable = deriveAtlasReportTruth({
  state: "error",
  freshness: "unknown",
  reportThroughSession: null,
  evidenceThroughSession: null,
});
assert.equal(unavailable.authority, "unavailable");
assert.equal(unavailable.publishedDecisionUsable, false);

console.log("atlas-surface-truth selftest: PASS");
