import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { makeFixedEntryLegacyOwnershipGuard, FixedEntryOwnershipError } from "./fixedEntryLegacyOwnership.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { sealFixedEntryBuys, settleFixedEntryIntent } from "./fixedEntryIntentSettlement.js";
async function main() {
  const h = fixedCoverageHarness();
  let now = h.coverage.now(), reads = 0, fail = false, slow = false;
  let observations: Record<string, unknown>[] = [], positions: Record<string, unknown>[] = [];
  const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from('{"role":"service_role"}').toString("base64url"), "fixture"].join(".");
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method ?? "GET", "GET"); reads++;
    if (slow) now += 2_001;
    if (fail) return new Response('{"message":"fixture"}', { status: 503 });
    const u = new URL(String(input));
    let rows = u.pathname.endsWith("/positions") ? positions : observations;
    rows = rows.filter(row => [...u.searchParams].every(([key, wanted]) => {
      if (["select", "order", "offset", "limit"].includes(key)) return true;
      let value: unknown = row;
      for (const part of key.split(/->>?/)) value = (value as Record<string, unknown> | null)?.[part];
      assert.ok(wanted.startsWith("eq.")); return wanted.slice(3) === String(value);
    })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
    const offset = Number(u.searchParams.get("offset") ?? 0), limit = Number(u.searchParams.get("limit") ?? 200);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200,
      headers: { "content-type": "application/json", "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
  };
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token, fetcher);
  let mode:"legacy"|"fixed"|"unknown"="legacy";
  const guard = makeFixedEntryLegacyOwnershipGuard(client, () => now,async()=>mode);
  const check = () => guard(h.intent.accountId, h.intent.occ);
  await guard("other-account", h.intent.occ); await guard(h.intent.accountId, "QQQ260908C00640000");
  assert.equal(reads, 0, "other accounts/underlyings retain their existing order path");
  await check();
  mode="unknown";await assert.rejects(check,FixedEntryOwnershipError);mode="legacy";await check();
  observations = structuredClone([...h.db.values()]) as unknown as Record<string, unknown>[];
  await assert.rejects(check, FixedEntryOwnershipError, "an unresolved intent owns its contract even with zero rows/visible fills");
  // Older-session intent remains discoverable; there is no current-date filter.
  now += 86_400_000; await assert.rejects(check, FixedEntryOwnershipError); now = h.coverage.now();
  const original = observations[0];
  (original.payload as Record<string, unknown>).fixed_entry_protocol = null;
  await assert.rejects(check, FixedEntryOwnershipError, "missing protocol marker is corruption, not clear ownership");
  observations = [];
  positions = [{ id: "malformed-fixed", status: "open", occ_symbol: h.intent.occ, entry_features: { fixed_entry_coverage: null } }];
  positions[0].occ_symbol="SPY260908P00630000";
  await assert.rejects(check, FixedEntryOwnershipError,"unknown fixed owner on another OCC also blocks legacy account2 SPY");
  await assert.rejects(check, FixedEntryOwnershipError); positions = [];
  fail = true; await assert.rejects(check, FixedEntryOwnershipError); fail = false;
  slow = true; await assert.rejects(check, FixedEntryOwnershipError); slow = false; now = h.coverage.now();
  await requestFixedIntentExit(h.coverage.storage, h.intent, { source: "manual", reason: "manual", requestedAt: new Date(now).toISOString() });
  let snapshot = await h.coverage.snapshot(h.intent);
  assert.ok(await sealFixedEntryBuys(h.coverage.storage, h.intent, snapshot.records, "exit-required", new Date(now).toISOString()));
  snapshot = await h.coverage.snapshot(h.intent);
  assert.ok(await settleFixedEntryIntent(h.coverage.storage, h.intent, snapshot, now));
  observations = structuredClone([...h.db.values()]) as unknown as Record<string, unknown>[];
  await check();
  mode="fixed";await assert.rejects(check,FixedEntryOwnershipError);
  mode="legacy";await assert.rejects(check,FixedEntryOwnershipError,"same process can never resume legacy after fixed authority");
  console.log("fixedEntryLegacyOwnership: PASS · zero-row intent, old session, corrupt protocol/row, missing/stale reads, verified global settlement and unmodified other-account/QQQ paths");
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
