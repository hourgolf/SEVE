import assert from "node:assert/strict";
import {
  evaluatePreopenReadiness,
  type OperationalReleaseContract,
  type PaperAccountObservation,
  type PreopenReadinessInput,
} from "./preopenReadinessEngine";

const sha = (character: string): string => character.repeat(64);
const nowMs = Date.parse("2026-07-28T12:00:00.000Z");

const roots = (count: number, quantity = 2, takeProfitPct: number | null = 30) =>
  Array.from({ length: count }, (_, index) => ({
    slug: `root-${index + 1}`,
    accountId: index % 2 === 0 ? "acct-a" : "acct-b",
    channelVersion: sha("a"),
    managerVersion: sha("b"),
    configurationEpoch: sha("c"),
    quantity,
    takeProfitPct,
  }));

const contract = (rootCount = 6): OperationalReleaseContract => ({
  adapterId: "fixture-adapter",
  authoritySource: "sealed-runtime-adapter",
  releaseId: "fixture-release",
  configurationSha256: sha("d"),
  strategyWorkerVersion: "strategy-v1",
  runtimeVersion: "runtime-v1",
  roots: roots(rootCount),
  requiredAccountIds: ["acct-a", "acct-b"],
  paperOrigin: "https://paper-api.alpaca.markets",
  stockFeed: "sip",
  optionFeed: "opra",
  capture: { required: true, targetSamples: 12, maxAgeMs: 60_000 },
  managerObserver: { required: true, quoteMaxAgeMs: 15_000 },
  flatBoundaryReceiptRequired: true,
});

const account = (
  id: string,
  name: string,
  identity: string,
  required = true,
): PaperAccountObservation => ({
  accountId: id,
  name,
  mode: "paper",
  configuredArmed: required,
  configuredHalted: false,
  credentialsPresent: true,
  brokerReachable: true,
  brokerActive: true,
  brokerUnblocked: true,
  brokerIdentity: identity,
  positionsKnown: true,
  ordersKnown: true,
  openOrderCount: 0,
  brokerPositionCount: 0,
  deskPositionCount: 0,
  booksMatch: true,
});

const base = (): PreopenReadinessInput => ({
  nowMs,
  workerFreshMs: 150_000,
  fund: { mode: "paper", halted: false },
  contract: contract(),
  bindingIssues: [],
  workers: [{
    runtimeVersion: "runtime-v1",
    startedAt: "2026-07-28T11:55:00.000Z",
    heartbeatAt: "2026-07-28T11:59:30.000Z",
    lastPhase: "cycle",
    lastError: null,
  }],
  receipt: {
    releaseId: "fixture-release",
    configurationSha256: sha("d"),
    strategyWorkerVersion: "strategy-v1",
    createdAt: "2026-07-28T11:55:01.000Z",
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
  },
  configuredPaperAccounts: [
    account("acct-a", "FIRST", "broker-a"),
    account("acct-b", "SECOND", "broker-b"),
    account("acct-research", "RESEARCH", "broker-c", false),
  ],
  unattributedDeskPositionCount: 0,
});

let passed = 0;
const ready = (name: string, mutate?: (input: PreopenReadinessInput) => void): void => {
  const input = structuredClone(base());
  mutate?.(input);
  assert.equal(evaluatePreopenReadiness(input).ready, true, name);
  passed += 1;
};
const blocked = (
  name: string,
  blockerId: string,
  mutate: (input: PreopenReadinessInput) => void,
): void => {
  const input = structuredClone(base());
  mutate(input);
  const result = evaluatePreopenReadiness(input);
  assert.equal(result.ready, false, name);
  assert.ok(result.blockers.some((item) => item.id === blockerId), `${name}: missing ${blockerId}`);
  passed += 1;
};

ready("six-root fixture is release-agnostic");
ready("quantity and take-profit changes do not change gate logic", (input) => {
  input.contract = {
    ...input.contract,
    roots: roots(9, 8, 35),
  };
});
ready("non-manifest paper account may be configured disarmed", (input) => {
  input.configuredPaperAccounts[2].configuredArmed = false;
  input.configuredPaperAccounts[2].configuredHalted = true;
});
ready("stale open worker ledger row is warning, not current liveness", (input) => {
  input.workers = [...input.workers, {
    runtimeVersion: "old",
    startedAt: "2026-07-27T12:00:00.000Z",
    heartbeatAt: "2026-07-27T12:01:00.000Z",
    lastPhase: "unknown",
    lastError: null,
  }];
});

blocked("binding mismatch fails closed", "release-bindings", (input) => {
  input.bindingIssues = ["root-1:configuration_epoch"];
});
blocked("execution-route read failure fails readiness closed", "release-bindings", (input) => {
  input.bindingIssues = ["execution-route evidence unavailable: database unavailable"];
  input.unattributedDeskPositionCount = 1;
});
blocked("wrong release hash fails closed", "release-receipt-identity", (input) => {
  input.receipt!.configurationSha256 = sha("e");
});
blocked("wrong strategy worker fails closed", "release-receipt-identity", (input) => {
  input.receipt!.strategyWorkerVersion = "other";
});
blocked("receipt before worker start fails closed", "release-receipt-freshness", (input) => {
  input.receipt!.createdAt = "2026-07-28T11:54:59.000Z";
});
blocked("stale worker fails closed", "worker-cardinality", (input) => {
  input.workers[0].heartbeatAt = "2026-07-28T11:40:00.000Z";
});
blocked("two fresh workers fail closed", "worker-cardinality", (input) => {
  input.workers = [...input.workers, structuredClone(input.workers[0])];
});
blocked("worker error fails closed", "worker-runtime", (input) => {
  input.workers[0].lastError = "fault";
});
blocked("non-paper fund fails closed", "paper-fund", (input) => {
  input.fund.mode = "live";
});
blocked("feed mismatch fails closed", "market-feeds", (input) => {
  input.receipt!.optionFeed = "indicative";
});
blocked("capture not ready fails closed", "held-capture", (input) => {
  input.receipt!.heldCaptureReady = false;
});
blocked("manager observer mismatch fails closed", "manager-observer", (input) => {
  input.receipt!.managerObserverQuoteMaxAgeMs = 30_000;
});
blocked("missing flat boundary receipt fails closed", "flat-boundary-receipt", (input) => {
  input.receipt!.flatEraBoundaryProven = null;
});
blocked("missing required account fails closed", "configured-paper-account-set", (input) => {
  input.configuredPaperAccounts = input.configuredPaperAccounts.filter((row) => row.accountId !== "acct-b");
});
blocked("duplicate broker identity fails closed", "broker-identities", (input) => {
  input.configuredPaperAccounts[1].brokerIdentity = "broker-a";
});
blocked("required disarmed account fails closed", "account:FIRST:configuration", (input) => {
  input.configuredPaperAccounts[0].configuredArmed = false;
});
blocked("unknown broker positions fail closed", "account:FIRST:positions", (input) => {
  input.configuredPaperAccounts[0].positionsKnown = false;
});
blocked("broker desk mismatch fails closed", "account:FIRST:positions", (input) => {
  input.configuredPaperAccounts[0].booksMatch = false;
});
blocked("unknown open-order state fails closed", "account:FIRST:orders", (input) => {
  input.configuredPaperAccounts[0].ordersKnown = false;
  input.configuredPaperAccounts[0].openOrderCount = null;
});
blocked("nonzero open orders fail closed", "account:FIRST:orders", (input) => {
  input.configuredPaperAccounts[0].openOrderCount = 1;
});
blocked("non-manifest account is still fully queried", "account:RESEARCH:orders", (input) => {
  input.configuredPaperAccounts[2].ordersKnown = false;
  input.configuredPaperAccounts[2].openOrderCount = null;
});
blocked("nonflat broker book fails closed", "account:FIRST:flat", (input) => {
  input.configuredPaperAccounts[0].brokerPositionCount = 1;
  input.configuredPaperAccounts[0].booksMatch = false;
});
blocked("unattributed desk position fails closed", "desk-position-attribution", (input) => {
  input.unattributedDeskPositionCount = 1;
});
blocked("missing broker credentials fail closed", "account:FIRST:broker", (input) => {
  input.configuredPaperAccounts[0].credentialsPresent = false;
});
blocked("blocked broker account fails closed", "account:FIRST:broker", (input) => {
  input.configuredPaperAccounts[0].brokerUnblocked = false;
});
blocked("halted fund fails closed", "paper-fund", (input) => {
  input.fund.halted = true;
});
blocked("missing release receipt fails closed", "release-receipt-identity", (input) => {
  input.receipt = null;
});

console.log(`preopen-readiness-engine-selftest: ${passed}/${passed} PASS`);
