import { ObservationQueue } from "./observationQueue.js";
import { traceHealth, TRACE_MAX_BYTES } from "./decisionTrace.js";
import { executionObservationWriteAvailability } from "./store.js";
// Phase 1D runtime adapter. Observation writes are serialized, best-effort, and
// never awaited by the order path. Failure can lose evidence only; it cannot
// block, resize, delay, duplicate, or create an order.

import { warn } from "./log.js";
import { insertExecutionObservation, type ChannelConfig } from "./store.js";
import type { ShadowDecision } from "./decide.js";
import {
  buildBrokerObservation,
  buildDecisionObservation,
  buildPositionRouteObservation,
  type BrokerObservationInput,
  type DecisionObservationInput,
  type ExecutionObservationDraft,
  type PositionRouteObservationInput,
} from "./executionObservationModel.js";
import {
  buildManagerShadowObservation,
  type ManagerShadowObservationInput,
} from "./managerShadowObservationModel.js";

const queue = new ObservationQueue<ExecutionObservationDraft>(async (row) => {
  const available = executionObservationWriteAvailability();
  if (available !== "available") return available;
  const written = await insertExecutionObservation(row);
  const after = executionObservationWriteAvailability();
  return written ? "written" : after === "available" ? "writeFailed" : after;
});
let lastLogAt = 0;
function healthLog(): void {
  const now = Date.now();
  if (now - lastLogAt < 60_000) return;
  lastLogAt = now;
  warn(`execution-observation health ${JSON.stringify({ ...queue.counters, ...traceHealth })}`);
}
const healthTimer = setInterval(() => { try { healthLog(); } catch { /* telemetry only */ } }, 60_000);
healthTimer.unref();
function enqueue(row: ExecutionObservationDraft | null): string | null {
  if (!row) return null;
  const detail = row.payload.decisionDetail as Record<string, unknown> | undefined;
  const trace = detail?.decisionTrace as { clocks?: Record<string, unknown> } | undefined;
  if (trace) {
    if (Buffer.byteLength(JSON.stringify(trace), "utf8") > TRACE_MAX_BYTES) {
      traceHealth.oversized++;
      row = { ...row, payload: { ...row.payload, decisionDetail: { ...detail, decisionTrace: undefined, decisionTraceOmitted: "oversized" } } };
    } else {
      row = { ...row, payload: { ...row.payload, decisionDetail: { ...detail, decisionTrace: {
        ...trace, clocks: { ...trace.clocks, persistenceEnqueuedAtMs: Date.now() },
      } } } };
    }
  }
  return queue.enqueue(row) ? row.trace_id : null;
}

export function captureDecisionObservation(input: DecisionObservationInput): string | null {
  try {
    const row = buildDecisionObservation(input);
    if (!row && input.decision.action !== "hold" && input.decision.action !== "skip") queue.counters.validationFailed++;
    return enqueue(row);
  }
  catch (e) { queue.counters.validationFailed++; warn(`execution-observation: decision draft rejected — ${(e as Error).message}`); return null; }
}

export function captureBrokerObservation(input: BrokerObservationInput): string | null {
  try {
    const row = buildBrokerObservation(input);
    if (!row) queue.counters.validationFailed++;
    return enqueue(row);
  }
  catch (e) { queue.counters.validationFailed++; warn(`execution-observation: broker draft rejected — ${(e as Error).message}`); return null; }
}

export function capturePositionRouteObservation(input: PositionRouteObservationInput): string | null {
  try {
    const row = buildPositionRouteObservation(input);
    if (!row) queue.counters.validationFailed++;
    return enqueue(row);
  }
  catch (e) { queue.counters.validationFailed++; warn(`execution-observation: position route draft rejected — ${(e as Error).message}`); return null; }
}

export function captureManagerShadowObservation(input: ManagerShadowObservationInput): string | null {
  try {
    const row = buildManagerShadowObservation(input);
    if (!row) queue.counters.validationFailed++;
    return enqueue(row);
  }
  catch (e) { queue.counters.validationFailed++; warn(`execution-observation: manager shadow draft rejected — ${(e as Error).message}`); return null; }
}

export type { ChannelConfig, ShadowDecision };
