import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, type FixedOrderFill } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { persistFixedFillEvidence, readFixedFillFloor, type FixedFillEvidence } from "./fixedEntryFillEvidence.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
async function main() {
  const intent = fixedEntryIntentFixture();
  const command = fixedOrderCommand({ intentId: intent.id, side: "buy", sequence: 0, quantity: 4 });
  const claim = fixedProtocolRecord({ id: command.id, intentId: intent.id, kind: "command",
    recordedAt: intent.createdAt, body: { command } });
  const db = new Map<string, ExecutionObservationDraft>();
  for (const record of [claim, fixedProtocolRecord({ id: intent.id, intentId: intent.id, kind: "intent",
    recordedAt: intent.createdAt, body: { intent } })]) db.set(record.id, fixedProtocolObservation(intent, record));
  const storage: ImmutableClaimStorage = {
    insert: async row => { if (db.has(row.id)) return "existing"; db.set(row.id, structuredClone(row)); return "inserted"; },
    read: async id => structuredClone(db.get(id) ?? null),
  };
  const snapshot = (qty: number, price: string | null, status = "partially_filled"): FixedOrderFill => ({
    commandId: command.id, brokerOrderId: "00000000-0000-4000-8000-000000000077",
    clientOrderId: command.clientOrderId, side: "buy", requestedQty: 4, filledQty: qty, averageFillPrice: price, status });
  const at = "2026-09-08T14:30:02.000Z";
  const first = await persistFixedFillEvidence(storage, intent, claim, snapshot(2, "2"), at);
  assert.ok(first);
  assert.equal((first.body.fillEvidence as FixedFillEvidence).cumulativeCost, "4");
  const terminalPartial = await persistFixedFillEvidence(storage, intent, claim, snapshot(2, "2", "canceled"), "2026-09-08T14:30:03.000Z");
  assert.equal(terminalPartial?.contentHash, first.contentHash, "terminal status/timing does not change cumulative economics");
  assert.equal(await persistFixedFillEvidence(storage, intent, claim, snapshot(2, "3"), at), null,
    "same-quantity broker average correction is a visible conflict, not an overwrite");
  const late = await persistFixedFillEvidence(storage, intent, claim, snapshot(4, "3", "filled"), at);
  assert.ok(late);
  assert.equal((await readFixedFillFloor(storage, intent, claim))?.id, late.id);
  assert.equal(await persistFixedFillEvidence(storage, intent, claim, snapshot(2, "2"), at), null,
    "fresh GET returning older partial cannot lower previously proven inventory");
  assert.equal(await persistFixedFillEvidence(storage, intent, claim, { ...snapshot(4, "3"), brokerOrderId: "wrong" }, at), null);
  await assert.rejects(persistFixedFillEvidence(storage, intent, claim, { ...snapshot(4, "3"), clientOrderId: "wrong" }, at), /identity/);
  const durable = (await readFixedFillFloor(storage, intent, claim))!.body.fillEvidence as FixedFillEvidence;
  assert.equal(durable.filledQty, 4); assert.equal(durable.cumulativeCost, "12",
    "floor survives absent position rows and broker lookup outages without claiming order terminality");
  const badRow = structuredClone(db.get(first.id)!); badRow.account_id = "wrong"; db.set(first.id, badRow);
  await assert.rejects(readFixedFillFloor(storage, intent, claim), /stored_identity/);
  console.log("fixedEntryFillEvidence: PASS · durable partial/late quantities, status-independent costs, regression/conflict rejection and original provenance");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
