import assert from "node:assert/strict";
import type {
  OperationalReleaseContract,
  ReleaseReceiptObservation,
  WorkerObservation,
} from "../ops/preopenReadinessEngine.js";
import { auditSentinelRelease } from "./releaseAudit.js";

const hash = (char: string): string => char.repeat(64);
const contract = (releaseId = "week2-2026-07-27-rc5.4"): OperationalReleaseContract => ({
  adapterId: "fixture-release-adapter-v1",
  authoritySource: "sealed-runtime-adapter",
  releaseId,
  configurationSha256: hash("a"),
  strategyWorkerVersion: "stream-2026-07-27a",
  runtimeVersion: "stream-runtime-2026-07-27a",
  roots: [{
    slug: "fixture-root",
    accountId: "paper-account",
    channelVersion: hash("b"),
    managerVersion: hash("c"),
    configurationEpoch: hash("d"),
    quantity: 2,
    takeProfitPct: 35,
  }],
  requiredAccountIds: ["paper-account"],
  paperOrigin: "https://paper-api.alpaca.markets",
  stockFeed: "sip",
  optionFeed: "opra",
  capture: { required: true, targetSamples: 12, maxAgeMs: 60_000 },
  managerObserver: { required: true, quoteMaxAgeMs: 15_000 },
  flatBoundaryReceiptRequired: true,
});
const receipt = (releaseId = contract().releaseId): ReleaseReceiptObservation => ({
  releaseId,
  configurationSha256: hash("a"),
  strategyWorkerVersion: "stream-2026-07-27a",
  createdAt: "2026-07-28T12:50:10.775Z",
  dryRun: false,
  liveTrading: true,
  alpacaPaperOrigin: "https://paper-api.alpaca.markets",
  stockFeed: "sip",
  optionFeed: "opra",
  heldCaptureEnabled: true,
  heldCaptureTargetSamples: 12,
  heldCaptureMaxAgeMs: 60_000,
  heldCaptureReady: true,
  heldCaptureStartedBeforeBootDecision: true,
  managerObserverEnabled: true,
  managerObserverQuoteMaxAgeMs: 15_000,
  flatEraBoundaryProven: true,
});
const worker = (): WorkerObservation => ({
  runtimeVersion: "stream-runtime-2026-07-27a",
  startedAt: "2026-07-28T12:50:09.853Z",
  heartbeatAt: "2026-07-28T22:33:20.000Z",
  lastPhase: "cycle",
  lastError: null,
});
const input = {
  contract: contract(),
  receipt: receipt(),
  workers: [worker()],
  nowMs: Date.parse("2026-07-28T22:33:22.000Z"),
  workerFreshMs: 150_000,
};

const rc54 = auditSentinelRelease(input);
assert.equal(rc54.state, "ok");
assert.equal(rc54.releaseId, contract().releaseId);
assert.match(rc54.detail, /current worker/);

const day1Contract = contract("weekend-day1-2026-07-21-rc5.3");
const day1 = auditSentinelRelease({ ...input, contract: day1Contract, receipt: receipt(day1Contract.releaseId) });
assert.equal(day1.state, "ok");

const futureContract = { ...contract("future-release-v1"), adapterId: "future-adapter-v1" };
const future = auditSentinelRelease({ ...input, contract: futureContract, receipt: receipt(futureContract.releaseId) });
assert.equal(future.state, "ok");
assert.match(future.detail, /future-adapter-v1/);

assert.equal(auditSentinelRelease({ ...input, receipt: null }).state, "missing");
assert.equal(auditSentinelRelease({
  ...input,
  receipt: { ...receipt(), strategyWorkerVersion: null },
}).state, "partial");
assert.equal(auditSentinelRelease({
  ...input,
  receipt: receipt("conflicting-release"),
}).state, "conflict");
assert.equal(auditSentinelRelease({
  ...input,
  receipt: { ...receipt(), configurationSha256: hash("f") },
}).state, "conflict");
assert.equal(auditSentinelRelease({
  ...input,
  workers: [{ ...worker(), heartbeatAt: "2026-07-28T22:20:00.000Z" }],
}).state, "stale");
assert.equal(auditSentinelRelease({
  ...input,
  workers: [{ ...worker(), startedAt: "2026-07-28T12:51:00.000Z" }],
}).state, "stale");
assert.equal(auditSentinelRelease({
  ...input,
  workers: [worker(), { ...worker(), startedAt: "2026-07-28T12:49:00.000Z" }],
}).state, "conflict");
assert.equal(auditSentinelRelease({
  ...input,
  workers: [{ ...worker(), runtimeVersion: "wrong-runtime" }],
}).state, "conflict");
assert.equal(auditSentinelRelease({
  ...input,
  workers: [{ ...worker(), lastError: "observer failed" }],
}).state, "conflict");
assert.deepEqual(auditSentinelRelease(input), auditSentinelRelease(input));

console.log("sentinel-release-audit-selftest: 16/16 passed");
