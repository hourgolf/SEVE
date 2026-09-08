import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { fixedLedgerId } from "./fixedEntryLedgerModel.js";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import type { FixedRuntimeBindings } from "./fixedEntryRuntimeDriver.js";
import { fixedStartupRecoveryNeeded } from "./fixedEntryStartupRecovery.js";
async function main(stopDuringFinalRead=false) {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture", SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { makeFixedEntryRuntimeDriver } = await import("./fixedEntryRuntimeDriver.js");
  const { requestFixedManualClose, readFixedManualCloseStatus } = await import("../../lib/positions/fixedManualCloseServer.js");
  const h = fixedCoverageHarness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
  let now = h.coverage.now(), held = 2, bid = 1, posts = 0, dbUnavailable = false, statusFails = false;
  let stopped=false,stopOnRead=false;
  const reads: string[] = [], writes: string[] = [];
  const fakeDb: typeof fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(u.origin, "https://fixture.supabase.co");
    const table = u.pathname.split("/").at(-1), method = init?.method ?? "GET";
    if(method==="GET"&&stopOnRead){stopped=true;stopOnRead=false;}
    if (dbUnavailable) return new Response(JSON.stringify({ code: "unavailable" }), { status: 503 });
    assert.ok(table === "positions" || table === "execution_observations");
    const map = (table === "positions" ? h.positions : h.db) as unknown as Map<string, Record<string, unknown>>;
    const response = (value: unknown, status = 200, count?: number) => new Response(JSON.stringify(value), { status,
      headers: { "content-type": "application/json", ...(count === undefined ? {} : { "content-range": `0-${Math.max(0, count - 1)}/${count}` }) } });
    const matches = (row: Record<string, unknown>) => [...u.searchParams].every(([key, wanted]) => {
      if (["select", "order", "offset", "limit"].includes(key)) return true;
      let value: unknown = row;
      for (const part of key.split(/->>?/)) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      if (wanted === "is.null") return value === null || value === undefined;
      assert.ok(wanted.startsWith("eq."), `unexpected fixture filter ${key}`);
      const expected = wanted.slice(3);
      return value !== null && value !== undefined && (typeof value === "object" ? canonicalJson(value) === canonicalJson(JSON.parse(expected)) : String(value) === expected);
    });
    const project = (row: Record<string, unknown>) => Object.fromEntries((u.searchParams.get("select") ?? "*").split(",")
      .filter(k => k in row).map(k => [k, row[k]]));
    if (method === "GET") {
      reads.push(table!);
      const selected = [...map.values()].filter(matches).sort((a,b) => String(a.id).localeCompare(String(b.id)));
      const offset = Number(u.searchParams.get("offset") ?? 0), limit = Number(u.searchParams.get("limit") ?? selected.length);
      return response(selected.slice(offset, offset + limit).map(project), 200, selected.length);
    }
    const body = JSON.parse(String(init?.body)); writes.push(`${method}:${table}`);
    if (method === "POST") {
      if (map.has(body.id)) return response({ code: "23505" }, 409);
      map.set(body.id, structuredClone(body)); return response(project(body));
    }
    assert.equal(method, "PATCH"); assert.equal(table, "positions");
    for (const key of ["id", "status", "qty", "avg_entry_price", "entry_features", "strategist_id", "occ_symbol", "configuration_epoch_id"]) {
      assert.ok(u.searchParams.has(key), `real CAS request lacks ${key}`);
    }
    const selected = [...map.values()].filter(matches);
    assert.ok(selected.length <= 1);
    if (!selected[0]) return response(null);
    Object.assign(selected[0], structuredClone(body)); return response(project(selected[0]));
  };
  const fakeBroker: typeof fetch = async (input, init) => {
    const u = new URL(String(input)); assert.equal(u.origin, "https://paper-api.alpaca.markets");
    const method = init?.method ?? "GET";
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (method === "GET") {
      if (u.pathname === "/v2/positions") return response(held ? [{ symbol: h.intent.occ, qty: String(held), side: "long", current_price: String(bid) }] : []);
      if (u.pathname === "/v2/orders") return response([...h.broker.values()]);
      assert.equal(u.pathname, "/v2/orders:by_client_order_id");
      const order = h.broker.get(u.searchParams.get("client_order_id")!);
      return response(order ?? {}, order ? 200 : 404);
    }
    if (method === "DELETE") return new Response(null, { status: 204 }); // deliberately not terminal
    assert.equal(method, "POST"); assert.equal(u.pathname, "/v2/orders");
    const request = JSON.parse(String(init?.body)); assert.equal(request.side, "sell");
    posts++; const qty = Number(request.qty); assert.ok(qty > 0 && qty <= held); held -= qty;
    const order = { id: fixedLedgerId("runtime-fixture", [request.client_order_id]), ...request,
      filled_qty: String(qty), filled_avg_price: String(bid), status: "filled", filled_at: new Date(now).toISOString() };
    h.broker.set(order.client_order_id, order); return response(order);
  };
  const token = [Buffer.from('{"alg":"HS256"}').toString("base64url"), Buffer.from('{"role":"service_role"}').toString("base64url"), "fixture"].join(".");
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token, fakeDb);
  assert.equal(await fixedStartupRecoveryNeeded(client),true,"original history survives failed current startup");
  const originalHistory=new Map(h.db);h.db.clear();
  assert.equal(await fixedStartupRecoveryNeeded(client),false,"proven empty original history retains normal fatal restart");
  dbUnavailable=true;assert.equal(await fixedStartupRecoveryNeeded(client),true,"unknown discovery cannot prove an empty history");
  dbUnavailable=false;for(const [id,row] of originalHistory)h.db.set(id,row);
  let reportingAttempts = 0, reportingFails = true;
  const bindings: FixedRuntimeBindings = {
    now: () => now,
    submissionEnabled:()=>!stopped,
    broker: async intent => ({ accountId: intent.accountId, paperHost: "https://paper-api.alpaca.markets", headers: {}, fetch: fakeBroker }),
    exclusiveContract: async () => ({ allowed: true, observedAtMs: now }),
    entryAuthority: async () => ({ allowed: false, validUntilMs: now + 2_000, bid, ask: bid + .01, quoteAgeMs: 0, account: null }),
    management: async (_intent, source, brokerMark) => {
      const allowed=!stopped;
      if(stopDuringFinalRead && [...h.db.values()].some(r=>
        (r.payload as any)?.fixed_entry_record?.body?.command?.side==="sell"))stopOnRead=true;
      return ({ allowed, validUntilMs: now + 2_000,
      input: { nowMs: now, fundHalted: false, accountHalted: false, eventWindow: false, source, brokerMark,
        quote: { bid, ask: bid + .01, observedAtMs: now } } });},
    executionSettings: () => ({ spreadCapture: false, ladder: h.intent.executionPlan.ladder }),
    onCommand: async () => {}, onCoverage: async () => {},
    onReporting: async () => { reportingAttempts++; if (reportingFails) throw new Error("fixture reporting unavailable"); },
    status: async () => { if (statusFails) throw new Error("fixture status failure"); },
  };
  const realNow = Date.now;
  Date.now = () => now; // transport observation clock, never used with a real network
  try {
    const initialRow = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    assert.equal((await readFixedManualCloseStatus(client, initialRow.id)).pending, true);
    const requested = await requestFixedManualClose(client, { positionId: initialRow.id, nowMs: now });
    assert.equal(requested.pending, true); assert.equal(requested.realized, undefined); assert.equal(requested.canTag, false);
    assert.equal(posts, 0, "manual API persists a request and never directly submits a broker order");
    const requestRecord = [...h.db.values()].find(row => row.reason === "fixed_entry_protocol:exit-required")!;
    assert.equal((requestRecord as unknown as { source_boot_id: unknown }).source_boot_id, null, "API request cannot invent a worker_runs FK");
    const requestCount = h.db.size;
    assert.equal((await requestFixedManualClose(client, { positionId: initialRow.id, nowMs: now })).pending, true);
    assert.equal(h.db.size, requestCount, "duplicate manual clicks reuse the original exit request");
    const runtime = makeFixedEntryRuntimeDriver(client, "00000000-0000-4000-8000-000000000004", bindings);
    statusFails = true;
    const first = await runtime.recover(h.intent, "sweep");
    if(stopDuringFinalRead){
      assert.equal(stopped,true);assert.equal(posts,0);assert.equal(first.postsAttempted,0);
      assert.ok([...h.db.values()].some(r=>(r.payload as any)?.fixed_entry_record?.body?.resolution?.outcome==="not-submitted"),
        "known local pre-POST stop persists a truthful not-submitted resolution");
      console.log("fixedEntryRuntimeDriver: PASS · shutdown during final coverage read prevents broker POST without inventing an ambiguous submission");
      return;
    }
    assert.equal(first.postsAttempted, 1, JSON.stringify(first));
    assert.ok(first.reasons.includes("runtime-status-unconfirmed"));
    assert.equal(posts, 1); assert.equal(held, 0);
    assert.equal(h.positions.size, 1);
    const frozen = structuredClone([...h.positions.values()][0]);
    assert.equal(frozen.status, "closed"); assert.equal(frozen.qty, 2); assert.equal(frozen.realized_pnl, -200);
    assert.equal((await readFixedManualCloseStatus(client, frozen.id)).pending, true,
      "a closed clicked row cannot certify completion while its buy can still fill");
    const buy = h.broker.get(h.buy.command.clientOrderId)!;
    h.broker.set(h.buy.command.clientOrderId, { ...buy, filled_qty: "4", filled_avg_price: "3", status: "filled" });
    held = 2; now += 1_000; bid = 3; statusFails = false;
    const restarted = makeFixedEntryRuntimeDriver(client, "00000000-0000-4000-8000-000000000005", bindings);
    const second = await restarted.recoverAll("cycle");
    assert.equal(second.complete, true); assert.deepEqual(second.unresolved, []);
    assert.equal(posts, 2); assert.equal(held, 0);
    assert.deepEqual(h.positions.get(frozen.id), frozen, "late fill cannot rewrite previously booked two-contract exit");
    const late = [...h.positions.values()].find(row => row.id !== frozen.id)!;
    assert.equal(late.qty, 2); assert.equal(late.avg_entry_price, 4); assert.equal(late.close_reason, "manual");
    assert.equal(late.realized_pnl, -200);
    await new Promise(resolve => setImmediate(resolve));
    const beforeReplay = reportingAttempts; reportingFails = false;
    assert.deepEqual(await restarted.recoverAll("sweep"), { complete: true, unresolved: [] }); assert.equal(posts, 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(reportingAttempts > beforeReplay, "a settled intent retries failed reporting independently of order recovery");
    const verifiedClose = await readFixedManualCloseStatus(client, frozen.id);
    assert.equal(verifiedClose.pending, false); assert.equal(verifiedClose.canTag, true); assert.equal(verifiedClose.realized, -400);
    assert.ok(verifiedClose.settlementId);
    assert.deepEqual(await requestFixedManualClose(client, { positionId: frozen.id, nowMs: now }), verifiedClose);
    assert.equal(posts, 2);
    dbUnavailable = true; statusFails = true;
    assert.equal((await restarted.recoverAll("sweep")).complete, false, "failed global discovery cannot look empty/clear");
    assert.ok(writes.every(w => ["POST:execution_observations", "POST:positions", "PATCH:positions"].includes(w)));
    assert.ok(reads.length > 0);
    console.log("fixedEntryRuntimeDriver: PASS · real Supabase request composition+exact broker transport, durable manual request, closed partial remains pending, restart late-fill remainder, immutable closed row, status failure retains POST count, global settlement and failed discovery");
  } finally { Date.now = realNow; }
}
void main().then(()=>main(true)).catch(error => { console.error(error); process.exitCode = 1; });
