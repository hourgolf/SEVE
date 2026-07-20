import { strict as assert } from "node:assert";
import { DAY1_CONFIG_HASH, DAY1_MANAGER_ARMS, DAY1_RELEASE_ID } from "../channels/day1Release";
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
    accounts: [{ accountId: "first", accountName: "FIRST-TEAM", reachable: true, error: "", brokerContracts: 0, deskContracts: 0, mismatchCount: 0 }],
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

const readFailure = deriveOpsReadiness(base({ evidence: evidence({ execution: failed([decision]) }) }));
assert.equal(find(readFailure, "candidates").state, "READ ERROR");
assert.equal(readFailure.counts.candidates, 0);

const justFilled = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T14:46:30Z"), evidence: evidence({ execution: ok([fill, decision]) }) }));
assert.equal(find(justFilled, "capture").state, "FLUSHING");
assert.equal(find(justFilled, "managers").state, "STARTING");
assert.equal(justFilled.chains.length, 1);
assert.equal(justFilled.chains[0].steps.find((step) => step.id === "fill")?.state, "2 FILLED");

const linkedFill = deriveOpsReadiness(base({ nowMs: Date.parse("2026-07-20T14:46:30Z"), evidence: evidence({ execution: ok([entryBrokerWithoutPosition, decision]), outcomes: ok([openedOutcome]) }) }));
assert.equal(linkedFill.counts.fills, 1);
assert.equal(linkedFill.chains.length, 1);

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
assert.equal(find(complete, "capture").state, "OBSERVED");
assert.equal(find(complete, "managers").state, "COMPLETE");
assert.equal(complete.counts.managerArms, 8);
assert.equal(complete.chains[0].steps.find((step) => step.id === "capture")?.state, "OBSERVED");
assert.equal(complete.chains[0].steps.find((step) => step.id === "managers")?.state, "8/8");

const partial = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captures: ok([capture]), managers: ok(managers.slice(0, 7)) }) }));
assert.equal(find(partial, "managers").state, "INCOMPLETE");

const degraded = deriveOpsReadiness(base({ evidence: evidence({ execution: ok([fill, decision]), captureHealth: ok([{ id: "health", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "r2_flush_failed", position_id: "position-1", affected_samples: 12 }]) }) }));
assert.equal(find(degraded, "capture").tone, "red");
assert.match(find(degraded, "capture").detail, /r2_flush_failed/);

const recovered = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fillWithoutDecisionMeta, decision]),
  captures: ok([{ ...capture, object_key: "held/object.gz", created_at: "2026-07-20T14:52:00Z" }]),
  captureHealth: ok([{ id: "health-recovered", observed_at: "2026-07-20T14:50:00Z", severity: "high", code: "receipt_write_failed", position_id: "position-1", affected_samples: 12, facts: { objectKey: "held/object.gz" } }]),
}) }));
assert.equal(find(recovered, "capture").state, "RETRY RECOVERED");
assert.equal(find(recovered, "capture").tone, "yellow");

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

const booked = deriveOpsReadiness(base({ evidence: evidence({
  execution: ok([fill, decision]), captures: ok([capture]), managers: ok(managers),
  outcomes: ok([{ id: "outcome", event_kind: "position_booked", event_at: "2026-07-20T15:30:00Z", position_id: "position-1", opportunity_id: "opp-1", quantity: 2, exit_price: 1.4, realized_pnl: 70, close_reason: "manual:risk" }]),
}) }));
assert.equal(booked.chains[0].steps.find((step) => step.id === "close")?.state, "BOOKED");

const brokerDrift = deriveOpsReadiness(base({ evidence: evidence({ broker: ok([{
  state: "drift", observedAt: "2026-07-20T15:00:00Z", allAccountsReachable: true,
  booksMatch: false, flatConfirmed: false, brokerContracts: 2, deskContracts: 1,
  accounts: [{ accountId: "first", accountName: "FIRST-TEAM", reachable: true, error: "", brokerContracts: 2, deskContracts: 1, mismatchCount: 1 }],
  mismatches: [{ accountId: "first", accountName: "FIRST-TEAM", symbol: "SPY260720C00600000", brokerQty: 2, deskQty: 1, delta: -1 }],
}]) }) }));
assert.equal(find(brokerDrift, "reconciliation").state, "DRIFT");
assert.equal(find(brokerDrift, "reconciliation").tone, "red");

const brokerPartial = deriveOpsReadiness(base({ evidence: evidence({ broker: ok([{
  state: "partial", observedAt: "2026-07-20T15:00:00Z", allAccountsReachable: false,
  booksMatch: false, flatConfirmed: false, brokerContracts: 0, deskContracts: 0,
  accounts: [{ accountId: "first", accountName: "FIRST-TEAM", reachable: false, error: "timeout", brokerContracts: 0, deskContracts: 0, mismatchCount: 0 }], mismatches: [],
}]) }) }));
assert.equal(find(brokerPartial, "reconciliation").tone, "yellow");

console.log("ops-readiness-selftest: 47/47 passed");
