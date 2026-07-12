// Phase 1E best-effort serialized adapter. No caller awaits this queue.

import { warn } from "./log.js";
import { insertPositionOutcome } from "./store.js";
import { buildPositionOutcome, type PositionOutcomeInput, type PositionOutcomeDraft } from "./positionOutcomeModel.js";

const seen = new Set<string>();
const pending = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export function capturePositionOutcome(input: PositionOutcomeInput): string | null {
  let row: PositionOutcomeDraft | null;
  try { row = buildPositionOutcome(input); }
  catch (e) { warn(`position-outcome: draft rejected — ${(e as Error).message}`); return null; }
  if (!row || seen.has(row.id) || pending.has(row.id)) return row?.id ?? null;
  pending.add(row.id);
  queue = queue.then(async () => {
    if (await insertPositionOutcome(row!)) seen.add(row!.id);
  }).catch((e) => warn(`position-outcome: persistence failed — ${(e as Error).message}`))
    .finally(() => pending.delete(row!.id));
  return row.id;
}
