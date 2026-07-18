import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS,
  HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS,
  isResearchAdapterTimeout,
  NormalFlushFollowupLatch,
  withResearchAdapterDeadline,
} from "./researchAdapterDeadline.js";
import {
  BoundedHeldContractCaptureQueue,
  HeldContractCaptureBatcher,
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

const july17Fragmentation = [
  { hourEt: 9, samples: 144, receipts: 48 },
  { hourEt: 10, samples: 7_247, receipts: 2_418 },
  { hourEt: 11, samples: 12_014, receipts: 3_930 },
  { hourEt: 12, samples: 17_393, receipts: 3_387 },
  { hourEt: 13, samples: 20_765, receipts: 3_461 },
  { hourEt: 14, samples: 23_124, receipts: 3_854 },
  { hourEt: 15, samples: 21_858, receipts: 3_696 },
];
const july17Samples = july17Fragmentation.reduce((sum, row) => sum + row.samples, 0);
const july17Receipts = july17Fragmentation.reduce((sum, row) => sum + row.receipts, 0);
check("July 17 fixture reproduces receipt fragmentation", [
  july17Samples, july17Receipts, Number((july17Samples / july17Receipts).toFixed(4)),
], [102_545, 20_794, 4.9315]);

const batcher = new HeldContractCaptureBatcher(24, 120_000);
const firstDrain = { samples: [sample, second], estimatedBytes: 0, droppedByPartition: {} };
batcher.accept(firstDrain);
check("timer keeps a young undersized batch open", [batcher.sealReady("timer", t0 + 30_000).length, batcher.openPartitionCount()], [0, 1]);
batcher.accept({ samples: [third], estimatedBytes: 0, droppedByPartition: {} });
const agedBatches = batcher.sealReady("timer", t0 + 120_100);
check("max age seals samples across timer drains", [agedBatches.length, agedBatches[0]?.partition.samples.length], [1, 3]);
const agedDescriptor = buildHeldContractSegmentDescriptor(agedBatches[0].partition)!;
check("failed persistence retry keeps identity stable", [
  batcher.pending()[0]?.token,
  buildHeldContractSegmentDescriptor(batcher.pending()[0].partition)?.contentSha256,
], [agedBatches[0].token, agedDescriptor.contentSha256]);
const fourth = normalizeHeldContractCaptureSample({
  ...base, fetchStartedAtMs: t0 + 130_000, fetchCompletedAtMs: t0 + 130_080,
  observedAtMs: t0 + 130_100, providerQuoteAtMs: t0 + 130_040,
})!;
batcher.accept({ samples: [fourth], estimatedBytes: 0, droppedByPartition: {} });
check("later samples cannot mutate a sealed retry", [batcher.sealedBatchCount(), batcher.openPartitionCount(), batcher.sampleCount()], [1, 1, 4]);
check("receipt acknowledgement retires only the sealed batch", [batcher.acknowledge(agedBatches[0].token), batcher.sealedBatchCount(), batcher.sampleCount()], [true, 0, 1]);
check("shutdown seals every remaining batch", batcher.sealReady("shutdown", t0 + 130_100).map((row) => row.partition.samples.length), [1]);

const boundaryAt = Date.parse("2026-07-16T14:59:50.000Z");
const boundarySample = normalizeHeldContractCaptureSample({
  ...base, fetchStartedAtMs: boundaryAt, fetchCompletedAtMs: boundaryAt + 80,
  observedAtMs: boundaryAt + 100, providerQuoteAtMs: boundaryAt + 40,
})!;
const boundaryBatcher = new HeldContractCaptureBatcher(24, 120_000);
boundaryBatcher.accept({ samples: [boundarySample], estimatedBytes: 0, droppedByPartition: {} });
check("hour boundary seals without mixing partitions", boundaryBatcher.sealReady("timer", Date.parse("2026-07-16T15:00:01.000Z")).length, 1);

const sessionBoundaryAt = Date.parse("2026-07-17T03:59:50.000Z");
const sessionBoundarySample = normalizeHeldContractCaptureSample({
  ...base, fetchStartedAtMs: sessionBoundaryAt, fetchCompletedAtMs: sessionBoundaryAt + 80,
  observedAtMs: sessionBoundaryAt + 100, providerQuoteAtMs: sessionBoundaryAt + 40,
})!;
const sessionBoundaryBatcher = new HeldContractCaptureBatcher(24, 120_000);
sessionBoundaryBatcher.accept({ samples: [sessionBoundarySample], estimatedBytes: 0, droppedByPartition: {} });
check("ET session boundary seals without mixing dates", sessionBoundaryBatcher.sealReady("timer", Date.parse("2026-07-17T04:00:01.000Z")).length, 1);

const duplicateBatcher = new HeldContractCaptureBatcher(24, 120_000);
duplicateBatcher.accept(firstDrain);
duplicateBatcher.accept({ samples: [sample], estimatedBytes: 0, droppedByPartition: {} });
check("duplicate sample identity across drains is coalesced", duplicateBatcher.sampleCount(), 2);

const pressureBatcher = new HeldContractCaptureBatcher(24, 120_000);
pressureBatcher.accept(firstDrain);
check("high water seals immediately off the callback", pressureBatcher.sealReady("high-water", t0 + 10_100).length, 1);

const combinedBound = new HeldContractCaptureBatcher(24, 120_000, 2, 100_000, 3, 30_000, 120_000);
combinedBound.accept({ samples: [sample], estimatedBytes: 0, droppedByPartition: {} });
combinedBound.sealReady("high-water", t0 + 100);
const combinedAccept = combinedBound.accept({ samples: [second, third], estimatedBytes: 0, droppedByPartition: {} });
check("open plus sealed samples share one hard sample bound", [combinedBound.sampleCount(), combinedAccept.acceptedSamples, combinedAccept.shed.map((row) => row.reason)], [2, 1, ["state_samples"]]);
check("state-cap shedding stays attached to truthful partition counts", combinedBound.sealReady("shutdown", t0 + 40_100)
  .reduce((sum, row) => sum + row.partition.droppedSamples, 0), 1);

const byteProbe = new HeldContractCaptureBatcher(24, 120_000, 10, 100_000);
byteProbe.accept({ samples: [sample], estimatedBytes: 0, droppedByPartition: {} });
const oneSampleBytes = byteProbe.estimatedBytes();
const byteBound = new HeldContractCaptureBatcher(24, 120_000, 100, oneSampleBytes);
const byteAccept = byteBound.accept({ samples: [sample, second], estimatedBytes: 0, droppedByPartition: {} });
check("open plus sealed bytes share one hard byte bound", [byteBound.sampleCount(), byteBound.estimatedBytes() <= oneSampleBytes, byteAccept.shed.map((row) => row.reason)], [1, true, ["state_bytes"]]);

const outageBound = new HeldContractCaptureBatcher(24, 120_000, 5, 100_000);
for (let index = 0; index < 100; index++) {
  const at = t0 + index * 1_000;
  const row = normalizeHeldContractCaptureSample({
    ...base, fetchStartedAtMs: at, fetchCompletedAtMs: at + 80,
    observedAtMs: at + 100, providerQuoteAtMs: at + 40,
  })!;
  outageBound.accept({ samples: [row], estimatedBytes: 0, droppedByPartition: {} });
}
check("sustained outage ingress cannot grow retained state without limit", [outageBound.sampleCount(), outageBound.estimatedBytes() <= 100_000, outageBound.shedTotals().samples], [5, true, 95]);

const r2Retry = new HeldContractCaptureBatcher(1, 120_000, 10, 100_000, 3, 30_000, 120_000);
r2Retry.accept({ samples: [sample], estimatedBytes: 0, droppedByPartition: {} });
const r2Batch = r2Retry.sealReady("high-water", t0 + 100)[0];
check("failed R2 batch enters backoff instead of every-flush retry", [
  r2Retry.recordFailure(r2Batch.token, t0 + 100),
  r2Retry.pending(t0 + 30_099).length,
  r2Retry.pending(t0 + 30_100).length,
], [null, 0, 1]);
r2Retry.recordFailure(r2Batch.token, t0 + 30_100);
const r2Evicted = r2Retry.recordFailure(r2Batch.token, t0 + 90_100);
check("repeated R2 failure exhausts a finite budget and frees memory", [r2Evicted?.reason, r2Retry.sampleCount(), r2Retry.estimatedBytes()], ["retry_budget", 0, 0]);

const receiptRetry = new HeldContractCaptureBatcher(1, 120_000, 10, 100_000, 2, 1_000, 10_000);
receiptRetry.accept({ samples: [second], estimatedBytes: 0, droppedByPartition: {} });
const receiptBatch = receiptRetry.sealReady("high-water", t0 + 10_100)[0];
receiptRetry.recordFailure(receiptBatch.token, t0 + 10_100);
const receiptEvicted = receiptRetry.recordFailure(receiptBatch.token, t0 + 11_100);
check("repeated Supabase receipt failure cannot retain a segment forever", [receiptEvicted?.reason, receiptRetry.sealedBatchCount(), receiptRetry.shedTotals().samples], ["retry_budget", 0, 1]);

const shutdownMany = new HeldContractCaptureBatcher(24, 120_000, 10, 100_000);
const otherPosition = normalizeHeldContractCaptureSample({
  ...base, positionId: "99999999-9999-4999-8999-999999999999",
  fetchStartedAtMs: t0 + 1_000, fetchCompletedAtMs: t0 + 1_080,
  observedAtMs: t0 + 1_100, providerQuoteAtMs: t0 + 1_040,
})!;
shutdownMany.accept({ samples: [sample, otherPosition], estimatedBytes: 0, droppedByPartition: {} });
check("shutdown seals every pending partition in one forced pass", shutdownMany.sealReady("shutdown", t0 + 2_000).length, 2);
shutdownMany.recordFailure(shutdownMany.pending()[0].token, t0 + 2_000);
check("shutdown bypasses retry backoff for explicit final attempts", shutdownMany.sealReady("shutdown", t0 + 2_001).length, 2);
const abandoned = shutdownMany.abandonAll();
check("shutdown abandonment releases all retained samples with a distinct censor", [
  abandoned.reduce((sum, row) => sum + row.samples, 0),
  abandoned.every((row) => row.reason === "shutdown_abandoned"),
  shutdownMany.sampleCount(),
  shutdownMany.estimatedBytes(),
], [2, true, 0, 0]);

for (const stage of ["r2_object_write", "supabase_receipt_write"] as const) {
  let aborted = false;
  const started = Date.now();
  let rejected: unknown = null;
  try {
    await withResearchAdapterDeadline({
      stage,
      requestTimeoutMs: 15,
      operation: (signal) => {
        signal.addEventListener("abort", () => { aborted = true; });
        return new Promise<never>(() => undefined);
      },
    });
  } catch (error) { rejected = error; }
  check(`never-resolving ${stage} is aborted and returns`, [
    isResearchAdapterTimeout(rejected),
    isResearchAdapterTimeout(rejected) ? rejected.stage : null,
    aborted,
    Date.now() - started < 1_000,
  ], [true, stage, true, true]);
}

const followupLatch = new NormalFlushFollowupLatch();
check("normal flush starts exactly one active writer", followupLatch.begin(), true);
check("samples arriving during the active flush request a follow-up without overlapping", followupLatch.begin(), false);
check("pending evidence forces a prompt follow-up after the active flush clears", followupLatch.finish(true), true);
check("the prompt follow-up can acquire the released flush latch", followupLatch.begin(), true);
check("a drained follow-up does not schedule an empty third pass", followupLatch.finish(false), false);

const dropBatcher = new HeldContractCaptureBatcher(24, 120_000);
dropBatcher.accept(firstDrain);
dropBatcher.accept({ samples: [], estimatedBytes: 0, droppedByPartition: { [partitionDropKey]: { dropped: 2, rejectedOversize: 1 } } });
const dropBatch = dropBatcher.sealReady("shutdown", t0 + 10_100)[0];
check("drop-only drains attach to an open partition", [dropBatch.partition.droppedSamples, dropBatch.partition.rejectedOversize], [2, 1]);

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
check("manifest HEAD verifies a content checksum as well as byte length", [
  runtimeSource.includes("manifest_sha256"),
  runtimeSource.includes("manifestHead.Metadata?.manifest_sha256 !== manifestSha256"),
], [true, true]);
check("runtime acknowledges a batch only after a durable receipt", /if \(receipted\)\s*{[\s\S]*?batcher\.acknowledge\(batch\.token\)/.test(runtimeSource), true);
check("R2 and receipt failures retain a retry batch with backoff", /retry retained with backoff/.test(runtimeSource), true);
check("R2 and receipt failures use bounded backoff budgets", /batcher\.recordFailure/.test(runtimeSource) && /RetryMaxAttempts/.test(runtimeSource), true);
check("all R2 stages use abortable research deadlines", [
  "r2_object_write", "r2_object_head", "r2_manifest_write", "r2_manifest_head",
].every((stage) => runtimeSource.includes(`this.r2("${stage}"`)), true);
check("timeout, exhaustion, and shutdown abandonment have distinct censors", [
  "adapter_timeout", "retry_exhausted", "shutdown_abandoned",
].every((code) => runtimeSource.includes(`censor=${code}`) || runtimeSource.includes(`censorCode: "${code}"`)), true);
check("shutdown has a hard total wall-clock ceiling", [
  HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS,
  HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS,
  /Date\.now\(\) \+ HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS/.test(runtimeSource),
], [5_000, 30_000, true]);
check("shutdown awaits all bounded attempts without a silent timeout race", [
  /Promise\.race\(\[this\.flush\("shutdown"\)/.test(runtimeSource),
  /await this\.flush\("shutdown", workDeadlineAtMs\)/.test(runtimeSource),
], [false, true]);
check("runtime cannot import provider, broker, execution, position, or order modules", /from\s+["'][^"']*(?:alpaca|execute|position|order|reconcile)[^"']*["']/i.test(runtimeSource), false);
const managerRuntimeSource = readFileSync(new URL("./managerShadowBook.ts", import.meta.url), "utf8");
check("manager capture handoff is not awaited", /await\s+capture\.capture/.test(managerRuntimeSource), false);
check("manager contains a synchronous capture failure boundary", /try\s*{[\s\S]*?capture\.capture\(input\);[\s\S]*?}\s*catch/.test(managerRuntimeSource), true);
const captureStoreSource = readFileSync(new URL("./heldContractCaptureStore.ts", import.meta.url), "utf8");
check("capture store is append-only and isolated", [
  /\.update\(|\.delete\(|\.upsert\(/.test(captureStoreSource),
  /from\s+["'][^"']*(?:execute|alpaca|store|position|order|reconcile)[^"']*["']/i.test(captureStoreSource),
], [false, false]);
check("Supabase schema, receipt, and health operations carry abort signals", [
  "supabase_schema_probe", "supabase_receipt_write", "supabase_health_write",
].every((stage) => captureStoreSource.includes(`stage: "${stage}"`))
  && (captureStoreSource.match(/\.abortSignal\(signal\)/g)?.length ?? 0) === 3, true);
const configSource = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
check("held capture is default off", /heldContractCaptureEnabled:\s*flag\("HELD_CONTRACT_CAPTURE_ENABLED", false\)/.test(configSource), true);
check("ratified Day 1 batching defaults to 12 samples and 60 seconds", [
  /heldContractCaptureBatchTargetSamples:\s*Number\(opt\("HELD_CONTRACT_CAPTURE_BATCH_TARGET_SAMPLES", "12"\)\)/.test(configSource),
  /heldContractCaptureBatchMaxAgeMs:\s*Number\(opt\("HELD_CONTRACT_CAPTURE_BATCH_MAX_AGE_MS", "60000"\)\)/.test(configSource),
], [true, true]);
check("in-flight high-water arrivals schedule a post-flush drain", [
  runtimeSource.includes("normalFlushLatch.finish"),
  /setImmediate\(\(\)\s*=>\s*{\s*void this\.flush\("high-water"\)/.test(runtimeSource),
], [true, true]);
check("combined open and retry state has sample and byte bounds", [
  /HELD_CONTRACT_CAPTURE_STATE_MAX_SAMPLES/.test(configSource),
  /HELD_CONTRACT_CAPTURE_STATE_MAX_BYTES/.test(configSource),
], [true, true]);
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check("default worker loads held R2 runtime dynamically", /await import\("\.\/heldContractCapture\.js"\)/.test(indexSource), true);
const migration = readFileSync(new URL("../../supabase/migrations/20260717061821_phase_1k_g_held_contract_capture_receipts.sql", import.meta.url), "utf8");
check("capture receipt table is RLS protected", /alter table public\.held_contract_capture_receipts enable row level security/i.test(migration), true);
check("anonymous capture access is revoked", /revoke all on public\.held_contract_capture_receipts from public, anon, authenticated, service_role/i.test(migration), true);
check("capture receipts are append-only for the worker", /grant select, insert on public\.held_contract_capture_receipts to service_role/i.test(migration), true);
check("operator authorization uses app metadata", /app_metadata[^\n]+seve_role/i.test(migration), true);

console.log(`held-contract-capture-selftest: ${checks}/${checks} PASS`);
