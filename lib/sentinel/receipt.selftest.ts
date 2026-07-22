import { strict as assert } from "node:assert";
import {
  buildSentinelReceiptMeta,
  deriveSentinelReceiptStatus,
  expectedSentinelForDate,
  resolveSentinelEvidenceSession,
  SENTINEL_PUBLISHER_VERSION,
  SENTINEL_RECEIPT_SCHEMA_VERSION,
} from "./receipt";

const now = Date.parse("2026-07-18T16:00:00Z");

const explicit = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-17", forDate: "2026-07-20", schemaVersion: 2,
  publisherVersion: SENTINEL_PUBLISHER_VERSION,
}, now);
assert.equal(explicit.code, "current");
assert.equal(explicit.tone, "green");

const partial = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-17", forDate: "2026-07-20", publisherEvidenceState: "partial",
  publisherEvidenceDetail: "terrain unavailable",
}, now);
assert.equal(partial.code, "partial");
assert.equal(partial.tone, "yellow");
assert.equal(partial.detail, "terrain unavailable");

const inferred = deriveSentinelReceiptStatus({
  state: "ok", date: "2026-07-17", briefAsOf: "2026-07-17", forDate: "2026-07-20",
}, now);
assert.equal(inferred.code, "identity-inferred");
assert.equal(inferred.tone, "yellow");
assert.equal(inferred.session, "2026-07-17");

const stale = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-17", forDate: "2026-07-17",
}, now);
assert.equal(stale.code, "stale");
assert.equal(stale.tone, "red");

const afterClose = Date.parse("2026-07-22T00:30:00Z"); // Tue 20:30 ET
assert.equal(expectedSentinelForDate(afterClose), "2026-07-22");
assert.equal(deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-20", forDate: "2026-07-21",
}, afterClose).code, "stale");
assert.equal(deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-21", forDate: "2026-07-22",
}, afterClose).code, "current");
assert.equal(expectedSentinelForDate(Date.parse("2026-07-21T19:59:00Z")), "2026-07-21");
assert.equal(expectedSentinelForDate(Date.parse("2026-11-27T18:01:00Z")), "2026-11-30");
assert.equal(expectedSentinelForDate(Date.parse("2026-07-18T16:00:00Z")), "2026-07-20");
assert.equal(expectedSentinelForDate(Date.parse("2026-07-03T16:00:00Z")), "2026-07-06");

const futureTarget = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-21", forDate: "2026-07-23",
}, afterClose);
assert.equal(futureTarget.code, "target-mismatch");
assert.equal(futureTarget.tone, "yellow");

const weekendSession = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-18", date: "2026-07-18", briefAsOf: "2026-07-17", forDate: "2026-07-20",
}, now);
assert.equal(weekendSession.code, "identity-conflict");
assert.equal(weekendSession.tone, "yellow");

const conflictingSession = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-17", date: "2026-07-17", briefAsOf: "2026-07-16", forDate: "2026-07-20",
}, now);
assert.equal(conflictingSession.code, "identity-conflict");
assert.equal(conflictingSession.tone, "yellow");

const invalidTarget = deriveSentinelReceiptStatus({
  state: "ok", session: "2026-07-17", forDate: "2026-07-19",
}, now);
assert.equal(invalidTarget.code, "target-invalid");
assert.equal(invalidTarget.tone, "red");

assert.equal(resolveSentinelEvidenceSession({
  briefAsOf: "2026-07-17", through: "2026-07-17", publishedEtDate: "2026-07-18",
}), "2026-07-17");
assert.equal(resolveSentinelEvidenceSession({
  through: "2026-07-17", publishedEtDate: "2026-07-18",
}), "2026-07-17");

assert.equal(deriveSentinelReceiptStatus({ state: "error", err: "timeout" }, now).code, "error");
assert.equal(deriveSentinelReceiptStatus({ state: "empty" }, now).code, "missing");
assert.equal(deriveSentinelReceiptStatus({ state: "loading" }, now).code, "loading");

const meta = buildSentinelReceiptMeta({
  session: "2026-07-17", forDate: "2026-07-20", publishedAt: "2026-07-17T20:19:29Z",
  digest: "digest", brief: { asOf: "2026-07-17" }, scan: {}, judge: {}, lens: {},
});
assert.equal(meta.schemaVersion, SENTINEL_RECEIPT_SCHEMA_VERSION);
assert.equal(meta.publisherVersion, SENTINEL_PUBLISHER_VERSION);
assert.equal(meta.session, "2026-07-17");
assert.equal(meta.date, "2026-07-17");
assert.equal(meta.forDate, "2026-07-20");

console.log("sentinel-receipt-selftest: 31/31 passed");
