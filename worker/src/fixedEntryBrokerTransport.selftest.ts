import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand } from "./fixedEntryLedgerModel.js";
import { makeFixedEntryBrokerTransport } from "./fixedEntryBrokerTransport.js";
import type { FixedBrokerRequest } from "./fixedEntryCommandCoordinator.js";
async function main() {
  const intent = fixedEntryIntentFixture();
  const c = fixedOrderCommand({ intentId: intent.id, side: "buy", sequence: 0, quantity: 4 });
  const body: FixedBrokerRequest = { symbol: intent.occ, qty: "4", side: "buy", type: "market",
    time_in_force: "day", client_order_id: c.clientOrderId };
  const order = { id: "00000000-0000-4000-8000-000000000077", client_order_id: c.clientOrderId,
    symbol: intent.occ, qty: "4", side: "buy", filled_qty: "2", filled_avg_price: "1.123456789", status: "partially_filled" };
  let mode: "normal" | "timeout" | "missing" | "error" | "wrong-coid" | "filled" = "normal";
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init!.method!, path: url.pathname + url.search,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    assert.equal(url.origin, "https://paper-api.alpaca.markets");
    if (mode === "timeout") throw new Error("simulated timeout with sensitive broker response that must not escape");
    if (mode === "missing") return new Response("{}", { status: 404 });
    if (mode === "error") return new Response("sensitive response fixture", { status: 500 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ ...order,
      ...(mode === "wrong-coid" ? { client_order_id: "wrong" } : {}),
      ...(mode === "filled" ? { status: "filled", filled_qty: "4" } : {}) }), { status: 200 });
  };
  const transport = makeFixedEntryBrokerTransport(intent, { accountId: intent.accountId,
    paperHost: "https://paper-api.alpaca.markets", headers: { "APCA-API-KEY-ID": "fixture-only" }, fetch: fetcher });
  assert.equal(calls.length, 0);
  const submitted = await transport.submitOnce(intent.accountId, body);
  assert.equal(submitted.filled_avg_price, "1.123456789", "broker decimal text is not rounded by transport");
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
  assert.deepEqual(calls[0].body, body);
  await transport.lookupExact(intent.accountId, c.clientOrderId);
  assert.equal(calls.at(-1)?.path, `/v2/orders:by_client_order_id?client_order_id=${c.clientOrderId}`);
  assert.equal((await transport.cancelExact(c)).state, "cancellation-requested", "DELETE204 does not imply terminal cancellation");
  mode = "filled";
  const deletes = calls.filter(c => c.method === "DELETE").length;
  assert.equal((await transport.cancelExact(c)).state, "terminal-observed");
  assert.equal(calls.filter(c => c.method === "DELETE").length, deletes);
  mode = "missing";
  assert.equal(await transport.lookupExact(intent.accountId, c.clientOrderId), null);
  assert.equal((await transport.cancelExact(c)).state, "unknown");
  for (const m of ["timeout", "error"] as const) {
    mode = m; const callsBeforeAttempt: number = calls.length;
    await assert.rejects(transport.submitOnce(intent.accountId, body), /^Error: fixed_broker:submission_outcome_unknown$/);
    assert.equal(calls.length - callsBeforeAttempt, 1, "lost/failed POST response never retries");
  }
  mode = "wrong-coid";
  await assert.rejects(transport.lookupExact(intent.accountId, c.clientOrderId), /identity/);
  const before = calls.length;
  await assert.rejects(transport.submitOnce("wrong-account", body), /account_identity/);
  await assert.rejects(transport.submitOnce(intent.accountId, { ...body, order_class: "bracket" } as FixedBrokerRequest), /request_fields/);
  await assert.rejects(transport.cancelExact({ ...c, id: "wrong-id" }), /cancel_intent_identity/);
  assert.throws(() => makeFixedEntryBrokerTransport(intent, { accountId: intent.accountId,
    paperHost: "https://api.alpaca.markets", headers: {}, fetch: fetcher }), /paper_account_required/);
  assert.equal(calls.length, before);
  {
    const commands = Array.from({ length: 501 }, (_, sequence) => fixedOrderCommand({ intentId: intent.id, side: "sell", sequence, quantity: 1 }));
    const recorded = commands.map((command, i) => ({ ...order, id: `broker-inventory-${i}`, client_order_id: command.clientOrderId,
      side: "sell", qty: "1", filled_qty: "0", filled_avg_price: null, status: "canceled" }));
    const reads: string[] = [];
    let heldQty = "2", duplicate = false;
    const inventoryFetch: typeof fetch = async (input, init) => {
      assert.equal(init?.method, "GET");
      const url = new URL(String(input)); reads.push(url.pathname + url.search);
      if (url.pathname === "/v2/positions") return new Response(JSON.stringify([{ symbol: intent.occ, qty: heldQty, current_price: "1.25", side: "long" }]));
      assert.equal(url.searchParams.get("symbols"), intent.occ);
      assert.equal(url.searchParams.get("limit"), "500");
      const last = url.searchParams.get("before_order_id");
      const page = last ? recorded.slice(duplicate ? 499 : 500) : recorded.slice(0, 500);
      if (last) assert.equal(last, "broker-inventory-499");
      return new Response(JSON.stringify(page));
    };
    const reader = makeFixedEntryBrokerTransport(intent, { accountId: intent.accountId,
      paperHost: "https://paper-api.alpaca.markets", headers: {}, fetch: inventoryFetch });
    const allowed = commands.map(command => ({ intent, command }));
    const inventory = await reader.readContractInventory(allowed);
    assert.equal(inventory.orders.length, 501); assert.equal(inventory.netQty, 2); assert.equal(inventory.brokerMark, 1.25);
    assert.equal(reads.length, 3); assert.equal(reads.at(-1), "/v2/positions");
    await assert.rejects(reader.readContractInventory(allowed.slice(1)), /unregistered_or_duplicate/);
    duplicate = true; await assert.rejects(reader.readContractInventory(allowed), /unregistered_or_duplicate/);
    duplicate = false; heldQty = "5"; await assert.rejects(reader.readContractInventory(allowed), /unattributable_contract_quantity/);
  }
  console.log("fixedEntryBrokerTransport: PASS · one POST, exact coid lookup, decimal retention, sanitized unknown outcomes, confirmed-vs-requested cancellation and original paper account");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
