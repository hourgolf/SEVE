import assert from "node:assert/strict";
import { deriveBrokerTelemetry, deriveProcessTelemetry } from "./workstationTelemetry";
import type { WorkerRunsInput } from "@/lib/incident/deriveIncident";
import type { ReadinessItem } from "@/lib/ops/readiness";

const NOW = Date.parse("2026-07-18T18:00:00Z");
const worker = (patch: Partial<WorkerRunsInput> = {}): WorkerRunsInput => ({
  query: { state: "ok", fetchedAtMs: NOW - 10_000 },
  rowsIn16h: 1,
  hasOpenRun: true,
  currentHeartbeatAtMs: NOW - 60_000,
  latestObservedAtMs: NOW - 60_000,
  abrupt16h: 0,
  boots16h: 1,
  unstable: false,
  currentPhase: "idle",
  ...patch,
});

assert.deepEqual(deriveProcessTelemetry(worker(), NOW), {
  label: "LIVE", tone: "green", detail: "process heartbeat observed 60s ago",
});
assert.equal(deriveProcessTelemetry(worker({ currentHeartbeatAtMs: NOW - 181_000 }), NOW).label, "STALE");
assert.equal(deriveProcessTelemetry(worker({ query: { state: "ok", fetchedAtMs: NOW - 151_000 } }), NOW).label, "CHECK");
assert.equal(deriveProcessTelemetry(worker({ query: { state: "error", fetchedAtMs: NOW } }), NOW).tone, "amber");
assert.equal(deriveProcessTelemetry(worker({ currentHeartbeatAtMs: null }), NOW).label, "MISSING");
assert.equal(deriveProcessTelemetry(worker(), 0).tone, "dim");

const broker = (state: string, tone: ReadinessItem["tone"]): ReadinessItem => ({
  id: "reconciliation", label: "BROKER RECONCILIATION", state, tone, detail: "evidence detail",
});
assert.equal(deriveBrokerTelemetry(broker("BROKER + DESK FLAT", "green")).label, "FLAT");
assert.equal(deriveBrokerTelemetry(broker("BOOKS MATCH", "green")).label, "MATCH");
assert.equal(deriveBrokerTelemetry(broker("PARTIAL", "yellow")).label, "PARTIAL");
assert.equal(deriveBrokerTelemetry(broker("DRIFT", "red")).label, "DRIFT");
assert.equal(deriveBrokerTelemetry().label, "CHECK");

console.log("workstation-telemetry-selftest: 11/11 passed");
