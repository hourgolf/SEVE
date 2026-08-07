import { strict as assert } from "node:assert";
import { DAY1_CONFIG_HASH, DAY1_MANAGER_ARMS, DAY1_RELEASE_ID } from "../channels/day1Release";
import {
  RC54_CONFIG_HASH,
  RC54_RELEASE_ID,
  RC54_ROOTS,
  RC54_WORKER_VERSION,
} from "../channels/activeRelease";
import { deriveOpsReadiness, type DeriveOpsReadinessInput, type OpsEvidence, type OpsEvidenceRead } from "./readiness";

const MONDAY = Date.parse("2026-07-20T15:00:00Z"); // 11:00 ET
const SATURDAY = Date.parse("2026-07-18T16:00:00Z");

const ok = <T>(rows: T[] = []): OpsEvidenceRead<T> => ({ state: "ok", rows, error: "", fetchedAtMs: MONDAY, lastOkAtMs: MONDAY });
const loading = <T>(): OpsEvidenceRead<T> => ({ state: "loading", rows: [], error: "", fetchedAtMs: null, lastOkAtMs: null });
const failed = <T>(rows: T[] = []): OpsEvidenceRead<T> => ({ state: "error", rows, error: "permission denied", fetchedAtMs: MONDAY, lastOkAtMs: MONDAY - 30_000 });

const release = [{
  id: "release", level: "EXEC" as const, strategist_id: null,
  message: `day1-release ACTIVE ${DAY1_RELEASE_ID} config=${DAY1_CONFIG_HASH}`,
  created_at: "2026-07-18T14:57:11.000Z",
  meta: {
    dryRun: false, liveTrading: true, alpacaPaperOrigin: "https://paper-api.alpaca.markets",
    heldCapture: { enabled: true, targetSamples: 12, maxAgeMs: 60_000 },
    runtimeReadiness: { heldCaptureReady: true, heldCaptureStartedBeforeBootDecision: true },
    managerShadow: { enabled: true, quoteMaxAgeMs: 15_000 },
  },
}];

const evidence = (overrides: Partial<OpsEvidence> = {}): OpsEvidence => ({
  execution: ok(), managers: ok(), captures: ok(), captureHealth: ok(),
  publisher: ok([{ id: "pub", message: "shadow-publish: day-report done", created_at: "2026-07-17T20:40:57Z" }]),
  outcomes: ok(),
  broker: ok([{
    state: "matched", observedAt: "2026-07-20T14:59:00Z", allAccountsReachable: true,
    booksMatch: true, flatConfirmed: true, brokerContracts: 0, deskContracts: 0,
    accounts: [{
      accountId: "first", accountName: "FIRST-TEAM", reachable: true, error: "",
      brokerContracts: 0, deskContracts: 0, mismatchCount: 0, brokerPositions: [],
    }],
    mismatches: [],
  }]),
  ...overrides,
});

const base = (overrides: Partial<DeriveOpsReadinessInput> = {}): DeriveOpsReadinessInput => ({
  nowMs: MONDAY, releaseEvents: release, releaseReadState: "ok", evidence: evidence(),
  sentinel: { state: "ok", session: "2026-07-17", date: "2026-07-17", briefAsOf: "2026-07-17", forDate: "2026-07-20", schemaVersion: 2 },
  openPositions: 0, closedPositions: 0, ...overrides,
});

const find = (model: ReturnType<typeof deriveOpsReadiness>, id: string) => [...model.configuration, ...model.evidence].find((item) => item.id === id)!;

const before = deriveOpsReadiness(base({ nowMs: SATURDAY }));
assert.equal(before.phase, "before-cohort");
assert.equal(find(before, "capture-config").tone, "green");
assert.equal(find(before, "manager-config").tone, "green");
assert.equal(find(before, "paper-boundary").state, "PAPER EXECUTOR");
assert.equal(find(before, "paper-boundary").tone, "green");
assert.equal(find(before, "candidates").state, "NOT DUE");

const empty = deriveOpsReadiness(base());
assert.equal(empty.chainEvidenceState, "ok");
assert.equal(find(empty, "candidates").state, "WAITING");
assert.equal(find(empty, "capture").tone, "neutral");
assert.equal(find(empty, "managers").tone, "neutral");
assert.match(find(empty, "candidates").detail, /trade absence is not a failure/);
assert.equal(find(empty, "reconciliation").state, "BROKER + DESK FLAT");

const candidatePayload = { decisionDetail: { day1Candidate: { releaseId: DAY1_RELEASE_ID, configurationSha256: DAY1_CONFIG_HASH } } };
const decision = {
  id: "decision", event_kind: "decision" as const, event_at: "2026-07-20T14:45:00Z", source_bar_at: "2026-07-20T14:45:00Z",
  channel_slug: "pb-ride", opportunity_id: "opp-1", position_id: null, action: "enter", blocked_reason: null,
  occ_symbol: "SPY260720C00600000", filled_qty: null, broker_status: null, payload: candidatePayload,
};
const fill = { ...decision, id: "fill", event_kind: "broker_result" as const, event_at: "2026-07-20T14:46:00Z", position_id: "position-1", filled_qty: 2, broker_status: "filled" };
const fillWithoutDecisionMeta = { ...fill, payload: {} };
const entryBrokerWithoutPosition = { ...fillWithoutDecisionMeta, position_id: null };
const openedOutcome = { id: "opened", event_kind: "position_opened" as const, event_at: "2026-07-20T14:46:05Z", position_id: "position-1", opportunity_id: "opp-1", quantity: 2, exit_price: null, realized_pnl: null, close_reason: null };

const withCandidate = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([decision]) }) }));
assert.equal(withCandidate.counts.candidates, 1);
assert.equal(find(withCandidate, "candidates").tone, "green");
assert.equal(find(withCandidate, "fills").tone, "neutral");

const rc54Release = [{
  ...release[0],
  id: "rc54-release",
  message: `rc54-release ACTIVE ${RC54_RELEASE_ID} config=${RC54_CONFIG_HASH}`,
  created_at: "2026-07-27T12:30:00.000Z",
}];
const rc54Decision = {
  ...decision,
  id: "rc54-decision",
  event_at: "2026-07-27T14:45:00Z",
  source_bar_at: "2026-07-27T14:45:00Z",
  payload: { decisionDetail: { rc54Candidate: { releaseId: RC54_RELEASE_ID, configurationSha256: RC54_CONFIG_HASH } } },
};
const rc54Ready = deriveOpsReadiness(base({
  nowMs: Date.parse("2026-07-27T15:00:00Z"),
  releaseEvents: rc54Release,
  evidence: evidence({ execution: ok([rc54Decision]) }),
}));
assert.equal(find(rc54Ready, "release").state, "VERIFIED");
assert.match(find(rc54Ready, "release").detail, /week2-2026-07-27-rc5\.4/);
assert.equal(find(rc54Ready, "manager-config").detail, "8 paper-only arms · quote max 15s");
assert.equal(rc54Ready.counts.candidates, 1);
assert.equal(find(rc54Ready, "candidates").tone, "green");

const receiptBoundHash = "c".repeat(64);
const receiptBoundEpoch = `sha256:${"d".repeat(64)}`;
const receiptBoundReleaseId = "release:candidate:readiness-test";
const receiptBoundRelease = [{
  ...release[0],
  id: "receipt-bound-release",
  message: `stream: rc54-release ACTIVE ${receiptBoundReleaseId} config=sha256:${receiptBoundHash}`,
  created_at: "2026-07-27T12:31:00.000Z",
  meta: {
    ...release[0].meta,
    state: "receipt-bound",
    paperOnly: true,
    releaseId: receiptBoundReleaseId,
    manifestContentHash: `sha256:${receiptBoundHash}`,
    configurationEpochId: receiptBoundEpoch,
    activationReceiptId: "activation-receipt-readiness-test",
    workerCompatibilityVersion: RC54_WORKER_VERSION,
    roots: Object.values(RC54_ROOTS).map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
      quantity: root.quantity,
      managerProfileId: root.managerProfileId,
      managerVersion: `sha256:${root.managerVersion}`,
      channelSpecContentHash: `sha256:${root.channelVersion}`,
      configurationEpochId: receiptBoundEpoch,
      maxEntriesPerSession: root.slug === "pb-ride" ? 3 : 1,
    })),
  },
}];
const receiptBoundDecision = {
  ...rc54Decision,
  id: "receipt-bound-decision",
  payload: {
    decisionDetail: {
      rc54Candidate: {
        releaseId: receiptBoundReleaseId,
        configurationSha256: receiptBoundHash,
      },
    },
  },
};
const receiptBoundReady = deriveOpsReadiness(base({
  nowMs: Date.parse("2026-07-27T15:00:00Z"),
  releaseEvents: receiptBoundRelease,
  evidence: evidence({ execution: ok([receiptBoundDecision]) }),
}));
assert.equal(find(receiptBoundReady, "release").state, "VERIFIED");
assert.equal(find(receiptBoundReady, "capture-config").tone, "green");
assert.equal(find(receiptBoundReady, "manager-config").tone, "green");
assert.equal(find(receiptBoundReady, "paper-boundary").state, "PAPER EXECUTOR");
assert.equal(receiptBoundReady.counts.candidates, 1);

const malformedReceiptBound = deriveOpsReadiness(base({
  nowMs: Date.parse("2026-07-27T15:00:00Z"),
  releaseEvents: [{
    ...receiptBoundRelease[0],
    meta: { ...receiptBoundRelease[0].meta, activationReceiptId: null },
  }],
}));
assert.equal(find(malformedReceiptBound, "release").state, "MISMATCH");
assert.equal(find(malformedReceiptBound, "paper-boundary").tone, "red");

const readFailure = deriveOpsReadiness(base({ evidence: evidence({ execution: failed([decision]) }) }));
assert.equal(find(readFailure, "candidates").state, "READ ERROR");
assert.equal(readFailure.counts.candidates, 0);
assert.equal(readFailure.chainEvidenceState, "blocked");
assert.match(readFailure.chainEvidenceDetail, /execution/);

const chainLoading = deriveOpsReadiness(base({ evidence: evidence({ outcomes: loading() }) }));
assert.equal(chainLoading.chainEvidenceState, "checking");
assert.match(chainLoading.chainEvidenceDetail, /outcomes/);

const justFilled = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T14:46:30Z"), evidence: evidence({ execution: ok([fill, decision]) }) }));
assert.equal(find(justFilled, "capture").state, "FLUSHING");
assert.equal(find(justFilled, "managers").state, "STARTING");
assert.equal(justFilled.chains.length, 1);
assert.equal(justFilled.chains[0].steps.find((step) => step.id === "fill")?.state, "2 FILLED");

const linkedFill = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T14:46:30Z"), evidence: evidence({ execution: ok([entryBrokerWithoutPosition, decision]), outcomes: ok([openedOutcome]) }) }));
assert.equal(linkedFill.counts.fills, 1);
assert.equal(linkedFill.chains.length, 1);

const linkedFillWithRemainder = deriveOpsReadiness(base({
  nowMs: Date.parse("2026-07-20T14:46:30Z"),
  evidence: evidence({
    execution: ok([entryBrokerWithoutPosition, decision]),
    outcomes: ok([
      openedOutcome,
      {
        ...openedOutcome,
        id: "runner-opened",
        event_kind: "position_remainder_opened",
        event_at: "2026-07-20T14:47:05Z",
        position_id: "position-runner",
        quantity: 1,
      },
    ]),
  }),
}));
assert.equal(linkedFillWithRemainder.chains[0]?.positionId, "position-1");

const overdue = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]) }) }));
assert.equal(find(overdue, "capture").state, "MISSING RECEIPT");
assert.equal(find(overdue, "managers").state, "INCOMPLETE");

const capture = { id: "cap", position_id: "position-1", channel_slug: "pb-ride", occ_symbol: "SPY260720C00600000", session_date_et: "2026-07-20", sample_count: 12, successful_quote_count: 12, dropped_samples: 0, completed_at: "2026-07-20T14:47:30Z" };
const managers = DAY1_MANAGER_ARMS.map((manager_id, index) => ({
  id: `manager-${index}`, position_id: "position-1", channel_slug: "pb-ride", manager_id,
  status: "active" as const, evidence_state: "observing", entry_at: "2026-07-20T14:46:00Z", last_observed_at: "2026-07-20T14:47:00Z",
  manager_policy_version: "manager", shadow_book_version: "shadow", censor_code: null,
}));
const complete = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captures: ok([capture]), managers: ok(managers) }) }));
assert.ok(find(complete, "release").detail.includes(DAY1_RELEASE_ID));
assert.doesNotMatch(find(complete, "release").detail, /RC5\.1/);
assert.equal(find(complete, "capture").state, "OBSERVED");
assert.equal(find(complete, "managers").state, "COMPLETE");
assert.equal(complete.counts.admittedManagerArms, 8);
assert.equal(complete.counts.managerArms, 8);
assert.equal(complete.chains[0].steps.find((step) => step.id === "capture")?.state, "OBSERVED");
assert.equal(complete.chains[0].steps.find((step) => step.id === "managers")?.state, "8/8 OBSERVING");

const pendingManagers = managers.map((row) => ({ ...row, evidence_state: "pending_quote", last_observed_at: null }));
const awaitingQuotes = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captures: ok([capture]), managers: ok(pendingManagers) }) }));
assert.equal(find(awaitingQuotes, "managers").state, "AWAITING QUOTES");
assert.equal(find(awaitingQuotes, "managers").tone, "yellow");
assert.equal(awaitingQuotes.counts.admittedManagerArms, 8);
assert.equal(awaitingQuotes.counts.managerArms, 0);
assert.equal(awaitingQuotes.chains[0].steps.find((step) => step.id === "managers")?.state, "0/8 OBSERVING");
assert.equal(awaitingQuotes.chains[0].steps.find((step) => step.id === "managers")?.tone, "yellow");

const mixedManagers = managers.map((row, index) => index === 7 ? { ...row, evidence_state: "pending_quote", last_observed_at: null } : row);
const partiallyObserving = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), managers: ok(mixedManagers) }) }));
assert.equal(find(partiallyObserving, "managers").state, "AWAITING QUOTES");
assert.match(find(partiallyObserving, "managers").detail, /7\/8 observing · 8\/8 admitted/);

const partial = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captures: ok([capture]), managers: ok(managers.slice(0, 7)) }) }));
assert.equal(find(partial, "managers").state, "INCOMPLETE");

const degraded = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captureHealth: ok([{ id: "health", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "r2_flush_failed", position_id: "position-1", affected_samples: 12 }]) }) }));
assert.equal(find(degraded, "capture").tone, "red");
assert.match(find(degraded, "capture").detail, /r2_flush_failed/);

const recovered = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fillWithoutDecisionMeta, decision]),
  captures: ok([{ ...capture, object_key: "held/object.gz", created_at: "2026-07-20T14:49:57Z" }]),
  captureHealth: ok([{ id: "health-recovered", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "receipt_write_failed", position_id: "position-1", affected_samples: 12, facts: { objectKey: "held/object.gz" } }]),
}) }));
assert.equal(find(recovered, "capture").state, "RETRY RECOVERED");
assert.equal(find(recovered, "capture").tone, "yellow");

const recoveredOutsideCohort = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fillWithoutDecisionMeta, decision]),
  captures: ok([
    capture,
    { ...capture, id: "capture-outside", position_id: "outside-position", object_key: "held/outside-object.gz" },
  ]),
  captureHealth: ok([{ id: "health-outside", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "receipt_write_failed", position_id: "outside-position", affected_samples: 8, facts: { objectKey: "held/outside-object.gz" } }]),
}) }));
assert.equal(find(recoveredOutsideCohort, "capture").state, "RETRY RECOVERED");
assert.equal(recoveredOutsideCohort.counts.capturedPositions, 1);

const wrongObjectRemainsGap = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fillWithoutDecisionMeta, decision]),
  captures: ok([{ ...capture, object_key: "held/different-object.gz", created_at: "2026-07-20T14:52:00Z" }]),
  captureHealth: ok([{ id: "health-unrecovered", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "receipt_write_failed", position_id: "position-1", affected_samples: 12, facts: { objectKey: "held/object.gz" } }]),
}) }));
assert.equal(find(wrongObjectRemainsGap, "capture").state, "EVIDENCE GAP");
assert.equal(find(wrongObjectRemainsGap, "capture").tone, "red");

const authLoading = deriveOpsReadiness(base({ evidence: evidence({ managers: loading() }) }));
assert.equal(find(authLoading, "managers").tone, "neutral");

const badRelease = deriveOpsReadiness(base({ releaseEvents: [], releaseReadState: "ok" }));
assert.equal(find(badRelease, "release").tone, "red");
assert.equal(find(badRelease, "paper-boundary").tone, "red");

const shadowRelease = deriveOpsReadiness(base({ releaseEvents: [{
  ...release[0], meta: { ...release[0].meta, dryRun: true, liveTrading: false },
}], releaseReadState: "ok" }));
assert.equal(find(shadowRelease, "paper-boundary").state, "PAPER / SHADOW");
assert.equal(find(shadowRelease, "paper-boundary").tone, "yellow");

const postClose = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T21:00:00Z"), evidence: evidence({ execution: ok([decision]) }) }));
assert.equal(find(postClose, "publisher").state, "DUE");

const sameDayPublisher = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T21:00:00Z"), evidence: evidence({ execution: ok([decision]), publisher: ok([{ id: "today", message: "shadow-publish: day-report done", created_at: "2026-07-20T20:40:00Z" }]) }) }));
assert.equal(find(sameDayPublisher, "publisher").tone, "green");

const sentinelConflict = deriveOpsReadiness(base({ sentinel: { state: "ok", session: "2026-07-18", date: "2026-07-18", briefAsOf: "2026-07-17", forDate: "2026-07-20" } }));
assert.equal(find(sentinelConflict, "sentinel").tone, "yellow");
assert.equal(sentinelConflict.summary.state, "TRADING READY");

const sentinelStale = deriveOpsReadiness(base({ sentinel: { state: "ok", session: "2026-07-17", date: "2026-07-17", briefAsOf: "2026-07-17", forDate: "2026-07-17", schemaVersion: 2 } }));
assert.equal(find(sentinelStale, "sentinel").tone, "red");
assert.equal(sentinelStale.summary.state, "TRADING READY");
assert.equal(sentinelStale.summary.tone, "yellow");
assert.match(sentinelStale.summary.detail, /trading ready.*research blocked/);

const booked = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fill, decision]), captures: ok([capture]), managers: ok(managers),
  outcomes: ok([{ id: "outcome", event_kind: "position_booked", event_at: "2026-07-20T15:30:00Z", position_id: "position-1", opportunity_id: "opp-1", quantity: 2, exit_price: 1.4, realized_pnl: 70, close_reason: "manual:risk" }]),
}) }));
assert.equal(booked.chains[0].steps.find((step) => step.id === "close")?.state, "BOOKED");

const brokerDrift = deriveOpsReadiness(base({ evidence: evidence({ broker: ok([{
  state: "drift", observedAt: "2026-07-20T15:00:00Z", allAccountsReachable: true,
  booksMatch: false, flatConfirmed: false, brokerContracts: 2, deskContracts: 1,
  accounts: [{
    accountId: "first", accountName: "FIRST-TEAM", reachable: true, error: "",
    brokerContracts: 2, deskContracts: 1, mismatchCount: 1,
    brokerPositions: [{ symbol: "SPY260720C00600000", qty: 2 }],
  }],
  mismatches: [{ accountId: "first", accountName: "FIRST-TEAM", symbol: "SPY260720C00600000", brokerQty: 2, deskQty: 1, delta: -1 }],
}]) }) }));
assert.equal(find(brokerDrift, "reconciliation").state, "DRIFT");
assert.equal(find(brokerDrift, "reconciliation").tone, "red");

const brokerPartial = deriveOpsReadiness(base({ evidence: evidence({ broker: ok([{
  state: "partial", observedAt: "2026-07-20T15:00:00Z", allAccountsReachable: false,
  booksMatch: false, flatConfirmed: false, brokerContracts: 0, deskContracts: 0,
  accounts: [{
    accountId: "first", accountName: "FIRST-TEAM", reachable: false, error: "timeout",
    brokerContracts: 0, deskContracts: 0, mismatchCount: 0, brokerPositions: [],
  }], mismatches: [],
}]) }) }));
assert.equal(find(brokerPartial, "reconciliation").tone, "yellow");

console.log("ops-readiness-selftest: RC5.3 + RC5.4 evidence contracts passed");
