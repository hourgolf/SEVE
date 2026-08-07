import { strict as assert } from "node:assert";
import { deriveAfterActionStatus, deriveEventTapeStatus, deriveTapeRows, eventCategory, filterTapeRows } from "./eventTape";
import type { MarketEvent } from "../types";
import type { OpsEvidenceChain, OpsReadinessModel, ReadinessTone } from "../ops/readiness";

const event = (id: string, level: MarketEvent["level"], message: string): MarketEvent => ({
  id, level, message, strategist_id: null, meta: null, created_at: `2026-07-17T20:00:0${id}Z`,
});

assert.equal(eventCategory("EXEC", "stream: OPEN SPY"), "execution");
assert.equal(eventCategory("WARN", "timeout"), "risk");
assert.equal(eventCategory("INFO", "market-ingest: SPY"), "data");
assert.equal(eventCategory("INFO", "sentinel: 2026-07-17"), "sentinel");
assert.equal(eventCategory("INFO", "cron observed"), "system");

const rows = deriveTapeRows([
  event("1", "INFO", "market-ingest: SPY"), event("2", "INFO", "market-ingest: SPY"),
  event("3", "EXEC", "stream: OPEN SPY"), event("4", "INFO", "market-ingest: SPY"),
]);
assert.equal(rows.length, 3);
assert.equal(rows[0].count, 2);
assert.equal(filterTapeRows(rows, "data").length, 2);
assert.equal(filterTapeRows(rows, "execution").length, 1);

const observerRestartRows = deriveTapeRows([
  event("5", "WARN", "stream: manager observer admission delayed >20s — pb-ride SPY260720C00755000"),
  event("6", "WARN", "stream: manager observer admission delayed >20s — orb-qqq-trail QQQ260720C00600000"),
]);
assert.equal(observerRestartRows.length, 1);
assert.equal(observerRestartRows[0].count, 2);
assert.equal(observerRestartRows[0].message, "Manager observers started slowly during restart");

const emptyHealth = { failureCount: 0, firstFailureAt: null, lastFailureAt: null, lastSuccessAt: null, lastError: null };
assert.equal(deriveEventTapeStatus(emptyHealth, []).label, "CHECKING TAPE");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastSuccessAt: "2026-07-17T20:00:00Z" }, []).tone, "yellow");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastError: "timeout" }, [event("1", "INFO", "x")]).tone, "red");
assert.equal(deriveEventTapeStatus({ ...emptyHealth, lastSuccessAt: "2026-07-17T20:00:00Z" }, [event("1", "INFO", "x")]).tone, "green");

const chain = (tone: ReadinessTone, closeState: string): OpsEvidenceChain => ({
  positionId: `position-${tone}`, channelSlug: "pb-ride", occSymbol: "SPY260720C00755000", opportunityId: `opp-${tone}`, tone,
  steps: [{ id: "close", label: "CLOSE", state: closeState, detail: "fixture", tone }],
});
const model = (
  chains: OpsEvidenceChain[],
  chainEvidenceState: OpsReadinessModel["chainEvidenceState"] = "ok",
): OpsReadinessModel => ({
  sessionDateEt: "2026-07-20", phase: "session",
  summary: { id: "summary", label: "DAY 1 EVIDENCE", state: "READY", detail: "fixture", tone: "green" },
  configuration: [], evidence: [], chains, brokerReceipt: null,
  chainEvidenceState,
  chainEvidenceDetail: chainEvidenceState === "ok" ? "current-session evidence read" : `${chainEvidenceState} fixture`,
  counts: { candidates: chains.length, suppressed: 0, fills: chains.length, capturedPositions: 0, admittedManagerArms: 0, managerArms: 0, expectedManagerArms: chains.length * 8 },
});

assert.equal(deriveAfterActionStatus(model([])).label, "WAITING FOR FIRST FILL");
assert.equal(deriveAfterActionStatus(model([], "checking")).label, "CHECKING POSITION EVIDENCE");
assert.equal(deriveAfterActionStatus(model([], "blocked")).label, "EVIDENCE BLOCKED");
assert.match(deriveAfterActionStatus(model([], "blocked")).detail, /no fill-absence claim/);
assert.equal(deriveAfterActionStatus(model([chain("red", "OPEN")])).tone, "red");
assert.equal(deriveAfterActionStatus(model([chain("yellow", "OPEN")])).tone, "yellow");
assert.equal(deriveAfterActionStatus(model([chain("green", "BOOKED")])).label, "CHAINS COMPLETE");
assert.equal(deriveAfterActionStatus(model([chain("neutral", "OPEN")])).label, "EVIDENCE IN PROGRESS");

console.log("event-tape-selftest: 24/24 passed");
