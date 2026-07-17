// Phase 1K-F runtime adapter. Receipt persistence is serialized and best effort;
// no caller awaits this queue and no receipt can alter an order or position.

import { warn } from "./log.js";
import { insertExecutionQualityReceipt } from "./store.js";
import {
  buildExecutionQualityReceipt,
  type ExecutionQualityReceiptInput,
  type ExecutionQualityReceiptDraft,
} from "../../lib/execution/executionQualityModel.js";

const seen = new Set<string>();
const pending = new Set<string>();
let seenDate = "";
let queue: Promise<void> = Promise.resolve();

function enqueue(row: ExecutionQualityReceiptDraft | null): string | null {
  if (!row) return null;
  const day = row.fill_observed_at.slice(0, 10);
  if (day !== seenDate) { seenDate = day; seen.clear(); pending.clear(); }
  if (seen.has(row.id) || pending.has(row.id)) return row.id;
  pending.add(row.id);
  queue = queue.then(async () => {
    if (await insertExecutionQualityReceipt(row)) seen.add(row.id);
  }).catch((error) => warn(`execution-quality: persistence failed — ${(error as Error).message}`))
    .finally(() => pending.delete(row.id));
  return row.id;
}

export function captureExecutionQualityReceipt(input: ExecutionQualityReceiptInput): string | null {
  try { return enqueue(buildExecutionQualityReceipt(input)); }
  catch (error) {
    warn(`execution-quality: receipt rejected — ${(error as Error).message}`);
    return null;
  }
}
