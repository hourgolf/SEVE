import assert from "node:assert/strict";
import { fixedLedgerId, fixedOrderCommand, fixedBuySeal } from "./fixedEntryLedgerModel.js";
import { claimFixedProtocolRecord, fixedProtocolRecord, fixedProtocolObservation,
  type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";

async function main() {
  const intent = fixedEntryIntentFixture();
  const command = fixedOrderCommand({ intentId: intent.id, side: "buy", sequence: 0, quantity: 4 });
  const id = command.id;
  const record = fixedProtocolRecord({ id, intentId: intent.id,
    kind: "command", recordedAt: intent.createdAt, body: { command, claimedBy: "worker-A" } });
  const expected = fixedProtocolObservation(intent, record);
  assert.equal(expected.action, "reconcile");
  assert.equal(expected.event_kind, "decision");
  assert.equal(expected.client_order_id, null);
  assert.equal(expected.filled_qty, null);
  const db = new Map<string, ExecutionObservationDraft>();
  const storage: ImmutableClaimStorage = {
    insert: async row => { if (db.has(row.id)) return "existing"; db.set(row.id, structuredClone(row)); return "inserted"; },
    read: async id => structuredClone(db.get(id) ?? null),
  };
  const contenders = await Promise.all(Array.from({ length: 20 }, () => claimFixedProtocolRecord(storage, expected)));
  assert.equal(contenders.filter(r => r.submissionAuthority).length, 1);
  assert.equal(contenders.filter(r => r.state === "fresh-winner").length, 1);
  assert.equal(contenders.filter(r => r.state === "existing-match").length, 19);
  // A restarted worker can read a matching claim, but cannot submit it again.
  assert.equal((await claimFixedProtocolRecord(storage, expected)).submissionAuthority, false);

  const conflict = structuredClone(expected);
  conflict.payload.fixed_entry_record = fixedProtocolRecord({ ...record,
    body: { command: fixedOrderCommand({ ...command, quantity: 2 }), claimedBy: "worker-B" } });
  assert.equal((await claimFixedProtocolRecord(storage, conflict)).state, "existing-conflict");
  for (const wrongId of [fixedLedgerId("other-wrapper", [0]), fixedLedgerId("other-wrapper", [1])]) {
    const wrongRecord = fixedProtocolRecord({ ...record, id: wrongId });
    const wrongObservation = { ...expected, id: wrongId,
      payload: { ...expected.payload, fixed_entry_record: wrongRecord } };
    await assert.rejects(claimFixedProtocolRecord(storage, wrongObservation), /claim_payload/);
  }
  const emptyCommand = fixedProtocolRecord({ ...record, body: {} });
  await assert.rejects(claimFixedProtocolRecord(storage, { ...expected,
    payload: { ...expected.payload, fixed_entry_record: emptyCommand } }), /claim_payload/);

  for (const outcome of ["return-unknown", "throw"] as const) {
    db.clear();
    const uncertain: ImmutableClaimStorage = { ...storage, insert: async row => {
      db.set(row.id, structuredClone(row));
      if (outcome === "throw") throw new Error("response lost after INSERT");
      return "unknown";
    } };
    const result = await claimFixedProtocolRecord(uncertain, expected);
    assert.equal(result.state, "uncertain");
    assert.equal(result.submissionAuthority, false, "readback does not reconstruct lost winner authority");
    assert.equal((await claimFixedProtocolRecord(storage, expected)).submissionAuthority, false);
  }
  db.clear();
  const unreadable: ImmutableClaimStorage = { ...storage, read: async () => { throw new Error("read unavailable"); } };
  assert.equal((await claimFixedProtocolRecord(unreadable, expected)).submissionAuthority, false);
  assert.equal((await claimFixedProtocolRecord(storage, expected)).submissionAuthority, false);
  db.clear();
  const offsetStorage: ImmutableClaimStorage = { ...storage, read: async id => {
    const row = await storage.read(id);
    return row ? { ...row, event_at: "2026-09-08T14:30:01+00:00", source_bar_at: "2026-09-08T14:30:00+00:00" } : null;
  } };
  assert.equal((await claimFixedProtocolRecord(offsetStorage, expected)).state, "fresh-winner");
  db.clear();
  const seal = fixedBuySeal({ intentId: intent.id, sequence: 0, reason: "exit-required" });
  const sealed = fixedProtocolObservation(intent, fixedProtocolRecord({ ...record,
    body: { command: seal, claimedBy: "worker-stop" } }));
  const winner = await claimFixedProtocolRecord(storage, sealed);
  assert.equal(winner.state, "fresh-winner"); assert.equal(winner.submissionAuthority, false);
  assert.equal((await claimFixedProtocolRecord(storage, expected)).state, "existing-conflict");
  console.log("fixedEntryLedgerPersistence: PASS · concurrent claim uniqueness, restart, unknown INSERT/readback, conflicts and timestamp normalization");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
