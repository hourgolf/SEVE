import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BoundedHeldContractCaptureQueue,
  HELD_CONTRACT_CAPTURE_SCHEMA_VERSION,
  HELD_CONTRACT_CAPTURE_VERSION,
  buildHeldContractSegmentDescriptor,
  heldContractCaptureInputsForFetch,
  normalizeHeldContractCaptureSample,
  partitionHeldContractCapture,
  type HeldContractCaptureInput,
} from "./heldContractCaptureModel";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const t0 = Date.parse("2026-07-16T14:30:00.000Z");
const base: HeldContractCaptureInput = {
  positionId: "11111111-1111-4111-8111-111111111111",
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "pb-ride",
  occSymbol: "SPY260716C00755000",
  underlying: "SPY",
  sourceBootId: "44444444-4444-4444-8444-444444444444",
  sourceVersion: "stream-test",
  feed: "opra",
  requestOutcome: "success",
  fetchStartedAtMs: t0,
  fetchCompletedAtMs: t0 + 80,
  observedAtMs: t0 + 100,
  providerQuoteAtMs: t0 + 40,
  bid: 1.1,
  ask: 1.15,
  bidSize: 12,
  askSize: 8,
};

const sample = normalizeHeldContractCaptureSample(base)!;
check("capture cohort is stamped", [sample.schemaVersion, sample.captureVersion], [HELD_CONTRACT_CAPTURE_SCHEMA_VERSION, HELD_CONTRACT_CAPTURE_VERSION]);
check("fresh snapshot and quote are independently eligible", [sample.quality, sample.snapshotAgeMs, sample.providerQuoteEventAgeMs], ["eligible", 20, 60]);
check("fetch latency is retained", sample.fetchDurationMs, 80);
check("sizes survive when provider supplies them", [sample.bidSize, sample.askSize], [12, 8]);
check("sample identity is deterministic", normalizeHeldContractCaptureSample({ ...base, observedAtMs: t0 + 500 })?.id, sample.id);
check("snapshot staleness is not quote-event staleness", normalizeHeldContractCaptureSample({ ...base, observedAtMs: t0 + 20_100 })?.quality, "snapshot_stale");
check("provider event staleness is explicit", normalizeHeldContractCaptureSample({ ...base, fetchCompletedAtMs: t0 + 20_080, observedAtMs: t0 + 20_100 })?.quality, "quote_event_stale");

const failed = normalizeHeldContractCaptureSample({
  ...base, requestOutcome: "provider_error", failureCode: "http_429",
  providerQuoteAtMs: null, bid: null, ask: null, bidSize: null, askSize: null,
})!;
check("request failure never invents a quote", [failed.quality, failed.failureCode, failed.bid, failed.providerQuoteAtMs], ["request_failed", "http_429", null, null]);
check("successful request with no quote is missing evidence", normalizeHeldContractCaptureSample({ ...base, providerQuoteAtMs: null })?.quality, "missing_quote");
check("crossed quote is retained as invalid class without prices", [
  normalizeHeldContractCaptureSample({ ...base, bid: 1.2, ask: 1.1 })?.quality,
  normalizeHeldContractCaptureSample({ ...base, bid: 1.2, ask: 1.1 })?.bid,
  normalizeHeldContractCaptureSample({ ...base, bid: 1.2, ask: 1.1 })?.providerQuoteAtMs,
], ["crossed_quote", null, t0 + 40]);
check("future provider time fails closed without erasing provenance", [
  normalizeHeldContractCaptureSample({ ...base, providerQuoteAtMs: t0 + 101 })?.quality,
  normalizeHeldContractCaptureSample({ ...base, providerQuoteAtMs: t0 + 101 })?.providerQuoteAtMs,
], ["future_quote", t0 + 101]);
check("negative size fails closed", normalizeHeldContractCaptureSample({ ...base, bidSize: -1 })?.quality, "invalid_quote");
check("backwards fetch clocks reject sample", normalizeHeldContractCaptureSample({ ...base, fetchCompletedAtMs: t0 - 1 }), null);
check("non-OPRA contract form rejects sample", normalizeHeldContractCaptureSample({ ...base, occSymbol: "SPY" }), null);

const sharedOccTarget = {
  positionId: "55555555-5555-4555-8555-555555555555",
  strategistId: "66666666-6666-4666-8666-666666666666",
  accountId: "77777777-7777-4777-8777-777777777777",
  channelSlug: "pb-ride-2", occSymbol: base.occSymbol, underlying: "SPY",
};
const fetch = {
  requestedSymbols: [base.occSymbol], requestOutcome: "success" as const,
  fetchStartedAtMs: base.fetchStartedAtMs, fetchCompletedAtMs: base.fetchCompletedAtMs,
  observedAtMs: base.observedAtMs, sourceBootId: base.sourceBootId, sourceVersion: base.sourceVersion,
  quotes: new Map([[base.occSymbol, {
    occSymbol: base.occSymbol, bid: 1.1, ask: 1.15, bidSize: 12, askSize: 8,
    quoteAtMs: base.providerQuoteAtMs!, feed: "opra" as const,
  }]]),
};
const fanout = heldContractCaptureInputsForFetch([
  base, base, // duplicate manager arms for one position
  sharedOccTarget,
], fetch);
check("manager-arm duplicates collapse but shared OCC positions remain independent", fanout.map((row) => row.positionId), [base.positionId, sharedOccTarget.positionId]);
check("one provider quote fans to both position identities", fanout.map((row) => [row.occSymbol, row.bid, row.bidSize]), [
  [base.occSymbol, 1.1, 12], [base.occSymbol, 1.1, 12],
]);
const failedFanout = heldContractCaptureInputsForFetch([base, sharedOccTarget], {
  ...fetch, requestOutcome: "provider_error", failureCode: "provider_request_failed", quotes: new Map(),
});
check("provider failure remains position-scoped without invented quotes", failedFanout.map((row) => [row.positionId, row.requestOutcome, row.bid]), [
  [base.positionId, "provider_error", null], [sharedOccTarget.positionId, "provider_error", null],
]);
const shedFanout = heldContractCaptureInputsForFetch([base], {
  ...fetch, requestOutcome: "not_requested", failureCode: "targeted_option_hard_cap_shed", quotes: new Map(),
});
check("provider-cap shedding is explicit rather than silent or mislabeled", [
  shedFanout[0]?.requestOutcome,
  normalizeHeldContractCaptureSample(shedFanout[0])?.quality,
  normalizeHeldContractCaptureSample(shedFanout[0])?.failureCode,
], ["not_requested", "request_failed", "targeted_option_hard_cap_shed"]);
check("unrequested OCC is not misattributed", heldContractCaptureInputsForFetch([{ ...sharedOccTarget, occSymbol: "QQQ260716C00755000" }], fetch), []);

const queue = new BoundedHeldContractCaptureQueue(2, 20_000);
check("first sample queues synchronously", queue.enqueue(sample).accepted, true);
check("duplicate is idempotent, not a drop", queue.enqueue(sample).reason, "duplicate");
const second = normalizeHeldContractCaptureSample({ ...base, fetchStartedAtMs: t0 + 10_000, fetchCompletedAtMs: t0 + 10_080, observedAtMs: t0 + 10_100, providerQuoteAtMs: t0 + 10_040 })!;
const third = normalizeHeldContractCaptureSample({ ...base, fetchStartedAtMs: t0 + 40_000, fetchCompletedAtMs: t0 + 40_080, observedAtMs: t0 + 40_100, providerQuoteAtMs: t0 + 40_040 })!;
check("second sample reaches sample cap", queue.enqueue(second).accepted, true);
check("capacity drop is position scoped", queue.enqueue(third).reason, "capacity");
const drain = queue.drain();
const partitionDropKey = `2026-07-16|10|${base.positionId}|${base.occSymbol}|${base.sourceBootId}|${base.sourceVersion}`;
check("drain preserves exact drop attribution", drain.droppedByPartition[partitionDropKey], { dropped: 1, rejectedOversize: 0 });
check("drain resets sample and drop state", [queue.size(), queue.drain().droppedByPartition], [0, {}]);

const tiny = new BoundedHeldContractCaptureQueue(10, 20);
check("oversize is explicit", tiny.enqueue(sample).reason, "oversize");
check("drop-only queue remains flushable", [tiny.size(), tiny.droppedCount(), tiny.hasPending()], [0, 1, true]);
check("oversize increments both counters", tiny.drain().droppedByPartition[partitionDropKey], { dropped: 1, rejectedOversize: 1 });

const laterQueue = new BoundedHeldContractCaptureQueue(10, 50_000);
laterQueue.enqueue(third);
laterQueue.enqueue(sample);
laterQueue.enqueue(second);
const partitions = partitionHeldContractCapture(laterQueue.drain());
check("partition stays position and OCC scoped", partitions.map((part) => [part.dateEt, part.hourEt, part.positionId, part.occSymbol, part.samples.length]), [
  ["2026-07-16", 10, base.positionId, base.occSymbol, 3],
]);
check("partition sorts by fetch completion", partitions[0].samples.map((row) => row.fetchCompletedAtMs), [t0 + 80, t0 + 10_080, t0 + 40_080]);

const descriptor = buildHeldContractSegmentDescriptor(partitions[0])!;
check("segment is content addressed", [descriptor.objectKey.includes(descriptor.contentSha256), descriptor.manifestKey.includes(descriptor.contentSha256)], [true, true]);
check("gap and cadence evidence are truthful", [descriptor.gapCount, descriptor.maxObservationGapMs], [1, 30_000]);
check("provider age distribution remains separate", [descriptor.providerAgeP50Ms, descriptor.providerAgeP95Ms, descriptor.providerAgeMaxMs], [60, 60, 60]);
check("quality counts reconcile", [descriptor.sampleCount, descriptor.successfulQuoteCount, descriptor.eligibleCount, descriptor.requestFailureCount], [3, 3, 3, 0]);
check("canonical order makes the content hash deterministic", buildHeldContractSegmentDescriptor({ ...partitions[0], samples: [...partitions[0].samples].reverse() })?.contentSha256, descriptor.contentSha256);
check("content changes alter the address", buildHeldContractSegmentDescriptor({ ...partitions[0], samples: [sample, second] })?.contentSha256 === descriptor.contentSha256, false);

const mixedPartition = partitionHeldContractCapture({ samples: [sample, failed], estimatedBytes: 0, droppedByPartition: {} })[0];
const mixed = buildHeldContractSegmentDescriptor(mixedPartition)!;
check("failed requests remain in immutable evidence", [mixed.sampleCount, mixed.successfulQuoteCount, mixed.requestFailureCount], [2, 1, 1]);

const source = readFileSync(new URL("./heldContractCaptureModel.ts", import.meta.url), "utf8");
check("pure capture cannot import runtime mutation or I/O adapters", /from\s+["'][^"']*(?:alpaca|execute|store|position|order|reconcile|s3|supabase)[^"']*["']/i.test(source), false);
const runtimeSource = readFileSync(new URL("./heldContractCapture.ts", import.meta.url), "utf8");
check("capture enqueue is synchronous", /capture\(input: HeldContractCaptureInput\): void/.test(runtimeSource), true);
check("held-contract compression is asynchronous", [runtimeSource.includes("gzipSync"), runtimeSource.includes("await gzipAsync")], [false, true]);
check("high-water persistence is deferred past the manager callback", /setImmediate\(\(\)\s*=>\s*{[\s\S]*?this\.flush\("high-water"\)/.test(runtimeSource), true);
check("manifest completion is retry-stable", /const completedAt = descriptor\.lastFetchAt/.test(runtimeSource), true);
check("runtime cannot import provider, broker, execution, position, or order modules", /from\s+["'][^"']*(?:alpaca|execute|position|order|reconcile)[^"']*["']/i.test(runtimeSource), false);
const managerRuntimeSource = readFileSync(new URL("./managerShadowBook.ts", import.meta.url), "utf8");
check("manager capture handoff is not awaited", /await\s+capture\.capture/.test(managerRuntimeSource), false);
check("manager contains a synchronous capture failure boundary", /try\s*{[\s\S]*?capture\.capture\(input\);[\s\S]*?}\s*catch/.test(managerRuntimeSource), true);
const captureStoreSource = readFileSync(new URL("./heldContractCaptureStore.ts", import.meta.url), "utf8");
check("capture store is append-only and isolated", [
  /\.update\(|\.delete\(|\.upsert\(/.test(captureStoreSource),
  /from\s+["'][^"']*(?:execute|alpaca|store|position|order|reconcile)[^"']*["']/i.test(captureStoreSource),
], [false, false]);
const configSource = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
check("held capture is default off", /heldContractCaptureEnabled:\s*flag\("HELD_CONTRACT_CAPTURE_ENABLED", false\)/.test(configSource), true);
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check("default worker loads held R2 runtime dynamically", /await import\("\.\/heldContractCapture\.js"\)/.test(indexSource), true);
const migration = readFileSync(new URL("../../supabase/migrations/20260717061821_phase_1k_g_held_contract_capture_receipts.sql", import.meta.url), "utf8");
check("capture receipt table is RLS protected", /alter table public\.held_contract_capture_receipts enable row level security/i.test(migration), true);
check("anonymous capture access is revoked", /revoke all on public\.held_contract_capture_receipts from public, anon, authenticated, service_role/i.test(migration), true);
check("capture receipts are append-only for the worker", /grant select, insert on public\.held_contract_capture_receipts to service_role/i.test(migration), true);
check("operator authorization uses app metadata", /app_metadata[^\n]+seve_role/i.test(migration), true);

console.log(`held-contract-capture-selftest: ${checks}/${checks} PASS`);
