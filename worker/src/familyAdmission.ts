// Best-effort runtime adapter for the pure family-admission observer. The order
// path never awaits this queue and never reads its output.

import { warn } from "./log.js";
import { insertFamilyAdmissionObservation } from "./store.js";
import {
  buildFamilyAdmissionObservations,
  type FamilyAdmissionInput,
  type FamilyAdmissionObservationDraft,
} from "./familyAdmissionModel.js";

const seen = new Set<string>();
const pending = new Set<string>();
let seenDate = "";
let queue: Promise<void> = Promise.resolve();

function enqueue(row: FamilyAdmissionObservationDraft): void {
  const day = row.source_bar_at.slice(0, 10);
  if (day !== seenDate) { seenDate = day; seen.clear(); pending.clear(); }
  if (seen.has(row.id) || pending.has(row.id)) return;
  pending.add(row.id);
  queue = queue.then(async () => {
    if (await insertFamilyAdmissionObservation(row)) seen.add(row.id);
  }).catch((e) => warn(`family-admission: persistence failed — ${(e as Error).message}`))
    .finally(() => pending.delete(row.id));
}

export function captureFamilyAdmissionObservations(inputs: readonly FamilyAdmissionInput[]): number {
  try {
    const rows = buildFamilyAdmissionObservations(inputs);
    for (const row of rows) enqueue(row);
    return rows.length;
  } catch (e) {
    warn(`family-admission: draft rejected — ${(e as Error).message}`);
    return 0;
  }
}
