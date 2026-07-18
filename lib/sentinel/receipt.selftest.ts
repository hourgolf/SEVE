import { strict as assert } from "node:assert";
import {
  buildSentinelReceiptMeta,
  deriveSentinelReceiptStatus,
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

console.log("sentinel-receipt-selftest: 19/19 passed");
