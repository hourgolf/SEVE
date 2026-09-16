import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PositionRow } from "./store.js";
import type { ExecCtx } from "./execute.js";
import type { ShadowDecision } from "./decide.js";
import { makeExitGuard, legacyExitSnapshotMatches, mapOpenPositions } from "./exitGuard.js";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import { buildReceiptBoundRuntimeConfiguration } from "./channelConfigurationRuntimeAdapter.js";
import { buildReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";

async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture",
    SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture",
    SPREAD_CAPTURE: "0" });
  const canary = buildRc54NoopConfigurationCanary();
  const runtime = buildReceiptBoundRuntimeConfiguration({ compiled: canary.simulation.candidate.compiled!,
    projection: canary.simulation.candidate.projection!, activationReceipt: canary.simulation.receipt! });
  const policy = buildReceiptBoundEntryPolicy(runtime.roots.find(r => r.takeProfit.fraction === .5)!);
  const parent: PositionRow = { id: randomUUID(), strategist_id: randomUUID(),
    occ_symbol: "SPY260916C00760000", underlying: "SPY", opt_type: "call", qty: 2,
    avg_entry_price: 2.17, strike: 760, expiration: "2026-09-16", opened_at: "2026-09-16T14:41:32Z",
    status: "open", peak_mark: 3, trough_mark: 2.17, runner_of: null,
    entry_features: { receipt_bound_entry_policy: policy } };
  type DbRow = Record<string, any>;
  const rows = new Map<string, DbRow>([[parent.id, structuredClone(parent)]]);
  const orders: DbRow[] = [], journals: DbRow[] = [];
  let held = 2, price = 3, readFails = false, partialNext = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } });
    if (u.origin === "https://paper-api.alpaca.markets") {
      assert.equal(method, "POST"); assert.equal(u.pathname, "/v2/orders");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.side, "sell"); assert.ok(Number(body.qty) <= held);
      const filled = partialNext ? 1 : Number(body.qty); partialNext = false;
      held -= filled;
      const order = { ...body, id: randomUUID(), filled_qty: filled, filled_avg_price: price,
        status: filled < Number(body.qty) ? "canceled" : "filled" };
      orders.push(order); return response(order);
    }
    assert.equal(u.origin, "https://fixture.supabase.co", "fixture must never contact a real service");
    const table = u.pathname.split("/").at(-1);
    if (table === "positions") {
      if (method === "GET" && readFails) return response({ message: "fixture unavailable" }, 503);
      const matches = (r: DbRow) => [...u.searchParams].every(([key, value]) => {
        if (["select", "or"].includes(key) || key.includes("->")) return true;
        if (value.startsWith("eq.")) return String(r[key]) === value.slice(3);
        throw new Error(`unexpected row filter ${key}`);
      });
      const project = (r: DbRow) => u.searchParams.get("select") === "*" ? structuredClone(r)
        : Object.fromEntries((u.searchParams.get("select") ?? "id").split(",").map(k => [k, r[k]]));
      if (method === "GET") {
        assert.ok(u.searchParams.has("id"), "exit reads must be bounded to one exact row");
        return response([...rows.values()].filter(matches).map(project));
      }
      const body = JSON.parse(String(init?.body));
      if (method === "PATCH") {
        const found = [...rows.values()].filter(matches);
        for (const row of found) Object.assign(row, body);
        return response(found.map(project));
      }
      assert.equal(method, "POST");
      const row = { ...body, id: body.id ?? randomUUID() }; rows.set(row.id, row);
      return response(project(row));
    }
    assert.equal(method, "POST", `unexpected observation request ${table}`);
    assert.ok(["events", "shadow_events", "position_outcome_events", "execution_observations",
      "position_plans", "policy_epochs", "manager_shadow_runs"].includes(table!));
    if (table === "events") journals.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 201 });
  };
  try {
    const { executeExit } = await import("./execute.js");
    const ctx = (): ExecCtx => ({ accountId: "fixture-account", paperMode: true,
      api: { paperHost: "https://paper-api.alpaca.markets", headers: {} },
      decisionAtMs: Date.parse("2026-09-16T15:07:00Z"), todayET: "2026-09-16", etMin: 668,
      sinceIso: "2026-09-16T00:00:00Z", allOrders: [],
      chain: { ageMs: 0, byOcc: () => ({ bid: price, ask: price + .01, mid: price + .005 }),
        executableBid: () => price, executableQuote: () => true } as unknown as ExecCtx["chain"],
      alpacaByOcc: new Map([[parent.occ_symbol, { symbol: parent.occ_symbol, qty: held, current_price: price } as any]]),
      remainingByOcc: new Map([[parent.occ_symbol, held]]), openRowQty: new Map([[parent.occ_symbol, held]]) });
    const guard = makeExitGuard();
    const run = async (row: PositionRow, reason = "target_premium") => {
      assert.equal(guard.claim(row.id), true);
      try { await executeExit({ slug: "momo-shape-2", status: "armed", action: "exit", reason } as ShadowDecision,
        row, ctx(), { frac: .5, givebackPct: 33 }); }
      finally { guard.release(row.id); }
    };
    // Exact incident: a second pass retains the original parent snapshot, but
    // reaches its exit claim AFTER the first pass has completed the tranche.
    const stale = structuredClone(parent);
    await run(parent);
    assert.equal(orders.length, 1); assert.equal(held, 1);
    assert.equal(rows.get(parent.id)!.status, "closed");
    const runnerDb = [...rows.values()].find(r => r.runner_of === parent.id)!;
    assert.ok(runnerDb); assert.equal(runnerDb.qty, 1);
    await run(stale);
    assert.equal(orders.length, 1, "stale parent must not submit a different exit and drain the runner");
    assert.equal(held, 1); assert.equal(runnerDb.status, "open");
    assert.ok(journals.some(j => j.meta?.kind === "stale-exit-suppressed"));
    const runner = mapOpenPositions({ data: [runnerDb], error: null })[0];
    assert.deepEqual(runner.entry_features, parent.entry_features, "runner keeps its native receipt-bound policy");
    price = 1.5;
    await run(runner, "premium_stop");
    assert.equal(orders.length, 2); assert.equal(held, 0, "fresh runner still obeys its native stop");
    assert.equal(runnerDb.close_reason, "premium_stop");

    const fresh = { ...structuredClone(parent), id: randomUUID() };
    rows.set(fresh.id, structuredClone(fresh)); held = 2;
    readFails = true;
    await assert.rejects(run(fresh, "event_flatten"), /exit_position:read_unavailable/);
    assert.equal(orders.length, 2); assert.equal(guard.size(), 0, "failed read cannot leak the claim");
    readFails = false;
    await run(fresh, "event_flatten");
    assert.equal(held, 0); assert.equal(rows.get(fresh.id)!.close_reason, "event_flatten");

    // Partial fills keep their existing remainder behavior, and a completed
    // partial parent cannot be used to liquidate its fresh remainder either.
    const partial = { ...structuredClone(parent), id: randomUUID(), qty: 4 };
    rows.set(partial.id, structuredClone(partial)); held = 4; partialNext = true;
    await run(partial, "premium_stop");
    const remainderDb = [...rows.values()].find(r => r.entry_reason === "partial_exit_remainder")!;
    assert.ok(remainderDb); assert.equal(remainderDb.qty, 3); assert.equal(held, 3);
    const before = orders.length; await run(partial, "premium_stop");
    assert.equal(orders.length, before); assert.equal(held, 3);
    await run(mapOpenPositions({ data: [remainderDb], error: null })[0], "halt_flatten");
    assert.equal(held, 0);

    assert.equal(legacyExitSnapshotMatches(parent, null), false);
    for (const patch of [{ qty: 3 }, { avg_entry_price: 2.5 }, { runner_of: "new-parent" },
      { configuration_epoch_id: "different" }, { strategist_id: "different" },
      { entry_features: { fixed_entry_coverage: null } }, { status: "closed" }]) {
      assert.equal(legacyExitSnapshotMatches(parent, { ...parent, ...patch }), false);
    }
    assert.equal(legacyExitSnapshotMatches(parent, { ...parent, peak_mark: 4 }), true,
      "routine quote marking must not disable native exits");
    await new Promise(r => setImmediate(r));
    console.log("exitSnapshot: PASS · real exit/tranche/book path, stale parent suppressed, runner native stop, failed read/retry, partial remainder, policy/ownership changes");
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
