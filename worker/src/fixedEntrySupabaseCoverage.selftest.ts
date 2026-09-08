import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { readFixedIntentRecords, discoverFixedEntryIntents, makeFixedSupabaseCoveragePorts, readFixedAdmissionHistory } from "./fixedEntrySupabaseCoverage.js";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
const token = (role: string) => [Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from(JSON.stringify({ role, exp: 9_999_999_999 })).toString("base64url"), "fixture-signature"].join(".");
async function main() {
  const intent = fixedEntryIntentFixture();
  const rows: ExecutionObservationDraft[] = [fixedProtocolObservation(intent, fixedProtocolRecord({ id: intent.id,
    intentId: intent.id, kind: "intent", recordedAt: intent.createdAt, body: { intent } }))];
  for (let sequence = 0; sequence < 501; sequence++) {
    const command = fixedOrderCommand({ intentId: intent.id, side: "sell", sequence, quantity: 1 });
    rows.push(fixedProtocolObservation(intent, fixedProtocolRecord({ id: command.id, intentId: intent.id,
      kind: "command", recordedAt: intent.createdAt, body: { command } })));
  }
  let mode: "normal" | "truncate" | "count-change" | "duplicate" | "wrong-account" = "normal";
  const calls: { method: string; path: string; offset: number; limit: number; filters: Record<string, string> }[] = [];
  let positionRows: Record<string, unknown>[] = [];
  const retiredStrategist = "00000000-0000-4000-8000-000000000081";
  let strategistRows: { id: string; slug: string }[] = [{ id: intent.strategistId, slug: intent.slug }];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    assert.equal(method, "GET", "this adapter inventory test permits no writes");
    assert.equal(url.origin, "https://fixture.supabase.co");
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 200);
    calls.push({ method, path: url.pathname, offset, limit, filters: Object.fromEntries(url.searchParams) });
    if (url.pathname.endsWith("/strategists")) {
      return new Response(JSON.stringify(strategistRows.slice(offset, offset + limit)), { status: 200,
        headers: { "content-type": "application/json", "content-range": `0-${strategistRows.length - 1}/${strategistRows.length}` } });
    }
    if (url.pathname.endsWith("/positions")) {
      const selected = positionRows.filter(row => {
        const strategist = url.searchParams.get("strategist_id");
        const owner = url.searchParams.get("entry_features->fixed_entry_coverage->>intentId");
        return (!strategist || strategist === `eq.${row.strategist_id}`) && (!owner
          || owner === `eq.${((row.entry_features as Record<string, unknown>).fixed_entry_coverage as { intentId?: string } | undefined)?.intentId}`);
      }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const page = selected.slice(offset, offset + limit);
      return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json",
        "content-range": `${offset}-${offset + Math.max(0, page.length - 1)}/${selected.length}` } });
    }
    let selected = rows.filter(r => {
      const reason = url.searchParams.get("reason");
      return !reason || reason === `eq.${r.reason}`;
    }).sort((a, b) => a.id.localeCompare(b.id));
    let page = structuredClone(selected.slice(offset, offset + limit));
    let count = selected.length;
    if (mode === "truncate" && offset === 0) page.pop();
    if (mode === "count-change" && offset > 0) count++;
    if (mode === "duplicate" && offset === 0 && page.length > 1) page[0] = structuredClone(page[1]);
    if (mode === "wrong-account" && page.length) page[0].account_id = "wrong";
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json",
      "content-range": `${offset}-${offset + Math.max(0, page.length - 1)}/${count}` } });
  };
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token("service_role"), fetcher);
  assert.equal(calls.length, 0, "constructing the explicit service client makes no requests");
  const result = await readFixedIntentRecords(client, intent);
  assert.equal(result.length, 502); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.offset), [0, 200, 400]);
  assert.ok(calls.every(c => c.limit === 200 && c.filters.trace_id === `eq.${intent.id}`
    && c.filters["payload->>fixed_entry_protocol"] === "eq.fixed-entry-intent-v1"));
  const all = await discoverFixedEntryIntents(client);
  assert.deepEqual(all, [intent]);
  const discovery = calls.at(-1)!;
  assert.equal(discovery.filters.reason, "eq.fixed_entry_protocol:intent");
  assert.ok(!("status" in discovery.filters) && !("source_bar_at" in discovery.filters),
    "discovery cannot depend on open rows, current session or roster state");
  for (const m of ["truncate", "count-change", "duplicate", "wrong-account"] as const) {
    mode = m;
    await assert.rejects(readFixedIntentRecords(client, intent), /inventory|stored_identity/);
  }
  const countBefore = calls.length;
  for (const role of ["anon", "authenticated"]) assert.throws(() =>
    createFixedEntryServiceClient("https://fixture.supabase.co", token(role), fetcher), /service_role_configuration/);
  assert.equal(calls.length, countBefore);
  const untrusted = { from() { throw new Error("must not query a restricted client"); } } as unknown as typeof client;
  await assert.rejects(discoverFixedEntryIntents(untrusted), /trusted_service_client/);
  assert.throws(() => makeFixedSupabaseCoveragePorts(untrusted, "fixture", {
    intent, now: () => Date.now(), attributedHoldings: async () => ({ netQty: 0, observedAtMs: Date.now() }) }), /trusted_service_client/);
  mode = "normal";
  rows.splice(1); // History test uses one real original-intent record.
  const h = fixedCoverageHarness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
  const position = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
  const legacy = { ...position, id: "00000000-0000-4000-8000-000000000090", entry_features: {}, opened_at: "2026-09-08T14:31:00Z" };
  positionRows = [position, legacy,
    { ...legacy, id: "00000000-0000-4000-8000-000000000091", opened_at: "2026-09-08T01:00:00Z" },
    { ...legacy, id: "00000000-0000-4000-8000-000000000092", runner_of: legacy.id }];
  const history = await readFixedAdmissionHistory(client, intent, () => 1234);
  assert.equal(history.legacySessionEntries, 1, "count ET root entries, exclude previous ET day, runners and every fixed generation");
  assert.equal(history.observedAtMs, 1234);
  assert.equal(history.intents.length, 1);
  const savedPositions = structuredClone(positionRows), savedRecords = structuredClone(rows);
  rows.length = 0; // A separate pre-fixed rollout scenario: no prior fixed IDs to rescue attribution.
  strategistRows = [{ id: retiredStrategist, slug: intent.slug }, { id: intent.strategistId, slug: "retired-current-placeholder" }];
  positionRows = [{ ...legacy, id: "00000000-0000-4000-8000-000000000083", strategist_id: retiredStrategist,
    entry_features: {} }];
  assert.equal((await readFixedAdmissionHistory(client, intent, () => 1234)).legacySessionEntries, 1,
    "first fixed intent cannot bypass a legacy entry under an earlier strategist for the same slug");
  strategistRows = [{ id: retiredStrategist, slug: "macd-retired-renamed" }];
  positionRows[0].entry_features = { receipt_bound_entry_policy: { configuration: { channelSlug: intent.slug } } };
  assert.equal((await readFixedAdmissionHistory(client, intent, () => 1234)).legacySessionEntries, 1,
    "an original policy preserves conservative session occupancy after a strategist rename");
  positionRows = savedPositions; rows.push(...savedRecords);
  strategistRows = [{ id: intent.strategistId, slug: intent.slug }];
  positionRows[0] = { ...position, entry_features: { ...position.entry_features, fixed_entry_coverage: {
    ...(position.entry_features.fixed_entry_coverage as object), intentId: "unknown-original" } } };
  await assert.rejects(readFixedAdmissionHistory(client, intent, () => 1234), /without_original_intent/);
  console.log("fixedEntrySupabaseCoverage: PASS · actual SDK pagination beyond500, count/truncation/duplicate detection, all-session discovery and service-only visibility boundary");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
