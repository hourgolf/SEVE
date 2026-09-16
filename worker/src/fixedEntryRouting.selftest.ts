import assert from "node:assert/strict";
import { readFixedEntryRouting, fixedPeerAccountId } from "./fixedEntryRouting.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";

async function main() {
  const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from('{"role":"service_role"}').toString("base64url"), "fixture"].join(".");
  let mode = "normal", route = "own";
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const calls: { table: string; columns: string; offset: number }[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const u = new URL(String(request)); assert.equal(u.origin, "https://fixture.supabase.co");
    assert.equal(init?.method ?? "GET", "GET");
    const table = u.pathname.split("/").at(-1)!;
    assert.ok(["strategists", "accounts"].includes(table), "routing must not fetch fund or signal configuration");
    const columns = u.searchParams.get("select")!, offset = Number(u.searchParams.get("offset") ?? 0);
    assert.equal(columns, table === "strategists" ? "id,account_id" : "id,cred_ref");
    calls.push({ table, columns, offset });
    if (mode === "parallel") await gate;
    if (mode === "failed") return new Response('{"message":"fixture"}', { status: 503 });
    const all = table === "strategists" ? Array.from({ length: 201 }, (_, i) => ({ id: `channel-${String(i).padStart(3, "0")}`, account_id: route }))
      : [{ id: "own", cred_ref: "3" }, { id: "other", cred_ref: null }];
    const rows: any[] = all.slice(offset, offset + 200);
    if (mode === "truncated" && table === "strategists" && offset === 0) rows.pop();
    if (mode === "malformed" && rows.length) delete rows[0][table === "strategists" ? "account_id" : "cred_ref"];
    const total = all.length + (mode === "count-change" && offset > 0 ? 1 : 0);
    return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json",
      "content-range": `${offset}-${offset + Math.max(0, rows.length - 1)}/${total}` } });
  };
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token, fetcher);
  mode = "parallel";
  const reading = readFixedEntryRouting(client);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls.map(c => c.table).sort(), ["accounts", "strategists"], "independent routing reads begin together");
  release(); const first = await reading;
  assert.equal(first.channels.length, 201);
  assert.deepEqual(calls.filter(c => c.table === "strategists").map(c => c.offset), [0, 200]);
  assert.equal(fixedPeerAccountId("channel-000", first), "own");
  mode = "normal"; route = "other";
  assert.equal(fixedPeerAccountId("channel-000", await readFixedEntryRouting(client)), "other", "route changes are never cached");
  for (const failure of ["truncated", "count-change", "malformed", "failed"]) {
    mode = failure; await assert.rejects(readFixedEntryRouting(client), /fixed_store:|fixed_routing:/);
  }
  const routing = { channels: [{ id: "channel", account_id: null }], accounts: [{ id: "other", cred_ref: null }] };
  assert.equal(fixedPeerAccountId("missing", routing), null);
  assert.equal(fixedPeerAccountId("channel", routing), "other");
  assert.equal(fixedPeerAccountId("channel", { ...routing, accounts: [] }), null);
  assert.equal(fixedPeerAccountId("channel", { ...routing, accounts: [...routing.accounts, { id: "ambiguous", cred_ref: null }] }), null);
  assert.equal(fixedPeerAccountId("channel", { ...routing, channels: [{ id: "channel", account_id: "missing-account" }] }), null);
  console.log("fixedEntryRouting: PASS · narrow GETs, parallel reads, complete pagination, changed routes, missing/ambiguous routing and read failures");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
