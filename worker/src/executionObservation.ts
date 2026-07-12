// Phase 1D runtime adapter. Observation writes are serialized, best-effort, and
// never awaited by the order path. Failure can lose evidence only; it cannot
// block, resize, delay, duplicate, or create an order.

import { warn } from "./log.js";
import { insertExecutionObservation, type ChannelConfig } from "./store.js";
import type { ShadowDecision } from "./decide.js";
import {
  buildBrokerObservation,
  buildDecisionObservation,
  type BrokerObservationInput,
  type DecisionObservationInput,
  type ExecutionObservationDraft,
} from "./executionObservationModel.js";

const seen = new Set<string>();
const pending = new Set<string>();
let seenDate = "";
let queue: Promise<void> = Promise.resolve();

function enqueue(row: ExecutionObservationDraft | null): string | null {
  if (!row) return null;
  const day = row.event_at.slice(0, 10);
  if (day !== seenDate) { seenDate = day; seen.clear(); pending.clear(); }
  if (seen.has(row.id) || pending.has(row.id)) return row.trace_id;
  pending.add(row.id);
  queue = queue.then(async () => {
    if (await insertExecutionObservation(row)) seen.add(row.id);
  }).catch((e) => warn(`execution-observation: persistence failed — ${(e as Error).message}`))
    .finally(() => pending.delete(row.id));
  return row.trace_id;
}

export function captureDecisionObservation(input: DecisionObservationInput): string | null {
  try { return enqueue(buildDecisionObservation(input)); }
  catch (e) { warn(`execution-observation: decision draft rejected — ${(e as Error).message}`); return null; }
}

export function captureBrokerObservation(input: BrokerObservationInput): string | null {
  try { return enqueue(buildBrokerObservation(input)); }
  catch (e) { warn(`execution-observation: broker draft rejected — ${(e as Error).message}`); return null; }
}

export type { ChannelConfig, ShadowDecision };
