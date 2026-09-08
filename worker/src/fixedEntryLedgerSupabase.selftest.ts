import assert from "node:assert/strict";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedClaimStorage, applyFixedRowCas } from "./fixedEntryLedgerSupabase.js";
import { fixedProtocolObservation, fixedProtocolRecord, claimFixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedLedgerId, fixedOrderCommand } from "./fixedEntryLedgerModel.js";
import { fixedRowId, fixedCoverageCas, fixedReserveSellCas, fixedBookSellCas, FIXED_ROW_IDENTITY_KEYS, type FixedFencedRow } from "./fixedEntryRowFence.js";

async function main() {
  const intent = fixedEntryIntentFixture();
  const command = fixedOrderCommand({ intentId: intent.id, side: "buy", sequence: 0, quantity: 4 });
  const id = command.id;
  const observation = fixedProtocolObservation(intent, fixedProtocolRecord({ id, intentId: intent.id,
    kind: "command", recordedAt: intent.createdAt, body: { command } }));
  const rows = new Map<string, Record<string, unknown>>();
  const requests: { table: string; operation: string; filters: [string, unknown][] }[] = [];
  // This fake implements only the methods the adapter is allowed to use.
  const client = { from(table: string) {
    let operation = "read", value: Record<string, unknown> | null = null;
    const filters: [string, unknown][] = [];
    const query = {
      insert(row: Record<string, unknown>) { operation = "insert"; value = structuredClone(row); return query; },
      update(row: Record<string, unknown>) { operation = "update"; value = structuredClone(row); return query; },
      select(_columns: string) { return query; },
      eq(key: string, v: unknown) { filters.push([key, v]); return query; },
      is(key: string, v: unknown) { filters.push([key, v]); return query; },
      async maybeSingle() {
        requests.push({ table, operation, filters: structuredClone(filters) });
        if (operation === "insert") {
          const key = `${table}:${value!.id}`;
          if (rows.has(key)) return { data: null, error: { code: "23505" } };
          rows.set(key, value!); return { data: { id: value!.id }, error: null };
        }
        const row = rows.get(`${table}:${filters.find(([k]) => k === "id")?.[1]}`);
        const match = row && filters.every(([k, v]) => k === "entry_features"
          ? canonicalJson(row[k]) === canonicalJson(JSON.parse(String(v)))
          : row[k] === v);
        if (!match) return { data: null, error: null };
        if (operation === "update") Object.assign(row, value);
        const { source_boot_id: _boot, ...projected } = row;
        return { data: structuredClone(projected), error: null };
      },
    }; return query;
  } } as unknown as Parameters<typeof fixedClaimStorage>[0];
  const storage = fixedClaimStorage(client, "00000000-0000-4000-8000-000000000004");
  assert.equal((await claimFixedProtocolRecord(storage, observation)).submissionAuthority, true);
  assert.equal((await claimFixedProtocolRecord(storage, observation)).submissionAuthority, false);
  assert.ok(requests.filter(r => r.table === "execution_observations").every(r => r.operation === "read" || r.operation === "insert"));

  const identity = { strategist_id: intent.strategistId, occ_symbol: intent.occ, underlying: intent.underlying,
    opt_type: intent.optionSide, expiration: intent.sessionDateEt, strike: 640, opened_at: intent.createdAt,
    entry_reason: intent.reason, runner_of: null, channel_spec_version_id: intent.writeStamp.channel_spec_version_id,
    release_manifest_id: intent.writeStamp.release_manifest_id, configuration_epoch_id: intent.writeStamp.configuration_epoch_id };
  const initial: FixedFencedRow = { ...identity, id: fixedRowId(intent.id, 0), status: "open", qty: 2, avg_entry_price: 2,
    entry_features: { receipt_bound_entry_policy: intent.writeStamp.entry_policy,
      configuration_identity: intent.writeStamp.configuration_identity,
      fixed_entry_coverage: { protocol: "fixed-entry-row-v1", intentId: intent.id,
      generation: 0, revision: 0, activeSellCommandId: null } } };
  rows.set(`positions:${initial.id}`, structuredClone(initial) as unknown as Record<string, unknown>);
  const reserve = fixedReserveSellCas(initial, id), expand = fixedCoverageCas(initial, 4, 3);
  const expanded = await applyFixedRowCas(client, expand);
  assert.equal(expanded.state, "applied");
  assert.equal((await applyFixedRowCas(client, reserve)).state, "lost-race");
  const reserved = await applyFixedRowCas(client, fixedReserveSellCas(expanded.row!, id));
  assert.equal(reserved.state, "applied");
  const reservedRow = reserved.row!;
  const originalFence = reservedRow.entry_features.fixed_entry_coverage as Record<string, unknown>;
  const invalidBefore = requests.length;
  for (const owner of [id, fixedLedgerId("different-owner", [id]), null]) {
    await assert.rejects(applyFixedRowCas(client, { expected: reservedRow, update: {
      avg_entry_price: 4, entry_features: { ...reservedRow.entry_features,
        fixed_entry_coverage: { ...originalFence, revision: Number(originalFence.revision) + 1, activeSellCommandId: owner } },
    } }), /invalid_open_transition/);
  }
  await assert.rejects(applyFixedRowCas(client, { expected: reservedRow, update: {
    entry_features: { ...reservedRow.entry_features, fixed_entry_coverage: { ...originalFence,
      revision: Number(originalFence.revision) + 1, activeSellCommandId: fixedLedgerId("different-owner", [id]) } },
  } }), /invalid_open_transition/);
  assert.equal(requests.length, invalidBefore, "reserved economics and ownership cannot change before database access");
  const close = fixedBookSellCas({ row: reserved.row!, commandId: id, soldQty: 2, exitPrice: 1,
    reason: "stop_premium", closedAt: "2026-09-08T14:32:00.000Z" });
  assert.equal((await applyFixedRowCas(client, close)).state, "applied");
  assert.equal((await applyFixedRowCas(client, close)).state, "lost-race");
  // Reservation-first ordering must fail purely on its JSONB revision, even
  // when quantity/basis have not changed yet.
  rows.set(`positions:${initial.id}`, structuredClone(initial) as unknown as Record<string, unknown>);
  assert.equal((await applyFixedRowCas(client, reserve)).state, "applied");
  assert.equal((await applyFixedRowCas(client, expand)).state, "lost-race");
  const beforeInvalid = requests.length;
  await assert.rejects(applyFixedRowCas(client, { expected: { ...initial, entry_features: {} }, update: { realized_pnl: 123 } }), /row_fence/);
  await assert.rejects(applyFixedRowCas(client, { ...expand, update: { ...expand.update, strategist_id: "wrong" } }), /outside_protocol/);
  assert.equal(requests.length, beforeInvalid, "legacy rows and forbidden mutations are rejected before touching database");
  for (const key of ["strategist_id", "occ_symbol", "configuration_epoch_id"]) {
    rows.set(`positions:${initial.id}`, { ...structuredClone(initial), [key]: "changed-after-read" });
    assert.equal((await applyFixedRowCas(client, reserve)).state, "lost-race", `${key} identity change must lose CAS before mutation`);
  }
  for (const request of requests.filter(r => r.operation === "update")) {
    assert.deepEqual(request.filters.map(([k]) => k), ["id", "status", "qty", "avg_entry_price", "entry_features", ...FIXED_ROW_IDENTITY_KEYS]);
  }
  console.log("fixedEntryLedgerSupabase: PASS · plain INSERT ownership, exact conditional update fields and stale/duplicate close rejection");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
