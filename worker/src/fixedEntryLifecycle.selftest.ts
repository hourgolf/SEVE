import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { reconcileFixedLifecycle, fixedLifecycleCommandPorts, type FixedLifecyclePorts } from "./fixedEntryLifecycle.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { fixedLedgerId } from "./fixedEntryLedgerModel.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { inspectFixedSellPlans } from "./fixedEntrySellPlan.js";
import { readFixedRowFence } from "./fixedEntryRowFence.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
function harness(options: { spreadCapture?: boolean } = {}) {
  const h = fixedCoverageHarness(options);
  let bid = 1.9, canEnter = true, canManage = true, cancelConfirmed = false, cancelCalls = 0;
  const ports: FixedLifecyclePorts = { coverage: h.coverage, booking: h.bookPorts, commands: h.commandPorts,
    observeManagement: async (intent, s) => {
      const row = s.positions.find(r => r.status === "open");
      const reason = row && bid <= row.avg_entry_price * 0.5 ? "stop_premium"
        : row && bid >= row.avg_entry_price * 1.2 ? "target_premium" : null;
      return { quote: { bid, ask: bid + 0.1, observedAt: new Date(h.coverage.now()).toISOString() },
        exit: reason ? { source: "native-manager", reason, requestedAt: new Date(h.coverage.now()).toISOString() } : null };
    },
    authorizeSubmission: async (_intent, claim) => ({ allowed: claim.command.side === "buy" ? canEnter : canManage,
      validUntilMs: h.coverage.now() + 2_000 }),
    mayManage: async () => canManage,
    cancelExact: async c => {
      cancelCalls++;
      const order = h.broker.get(c.clientOrderId);
      if (order && cancelConfirmed) h.broker.set(c.clientOrderId, { ...order, status: "canceled" });
      return { state: "cancellation-requested" };
    } };
  return { h, ports, setBid: (n: number) => { bid = n; }, setEnter: (v: boolean) => { canEnter = v; },
    setManage: (v: boolean) => { canManage = v; }, confirmCancel: () => { cancelConfirmed = true; }, cancels: () => cancelCalls };
}
async function main() {
  {
    const { h, ports } = harness();
    await reconcileFixedLifecycle(ports, h.intent);
    await requestFixedIntentExit(ports.coverage.storage, h.intent, { source: "manual", reason: "manual",
      requestedAt: new Date(h.coverage.now()).toISOString() });
    ports.observeManagement = async () => { throw new Error("fixture unrelated manager state unavailable"); };
    const result = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 2, "a durable exit survives unavailable manager inputs under independent sell permission");
    assert.equal([...h.positions.values()][0].close_reason, "manual");
    assert.ok(result.reasons.includes("management-observation-unavailable"));
  }
  {
    const { h, ports, setBid, setEnter, cancels } = harness();
    const entered = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 1); assert.equal(entered.coverage?.position?.qty, 2);
    assert.equal(entered.state, "active");
    const originalRow = entered.coverage!.position!;
    setEnter(false); setBid(1); // Entry authority may be withdrawn; native management persists.
    const lookup = ports.commands.lookupExact;
    let lookupSawProtectedPartial = false;
    ports.commands.lookupExact = async (account, coid) => {
      if (coid === h.buy.command.clientOrderId) {
        lookupSawProtectedPartial = [...h.positions.values()].some(r => r.status === "closed" && r.qty === 2);
        return null; // Lost buy visibility must not block the independent known exit.
      }
      return lookup(account, coid);
    };
    const exitedPartial = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 2);
    assert.ok(lookupSawProtectedPartial, "known native exit completed before unavailable buy lookup");
    assert.equal(exitedPartial.state, "unresolved");
    assert.ok(cancels() > 0);
    assert.equal(h.positions.get(originalRow.id)?.realized_pnl, -200);
    ports.commands.lookupExact = lookup;
    await h.lateBuy();
    setBid(3.9); // Late buys retain the original exit even after price recovers.
    const settled = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(settled.state, "settled"); assert.equal(h.counts().posts, 3);
    const rows = [...h.positions.values()].sort((a, b) => readFixedRowFence(a).generation - readFixedRowFence(b).generation);
    assert.deepEqual(rows.map(r => [r.status, r.qty, r.avg_entry_price, r.realized_pnl]), [["closed", 2, 2, -200], ["closed", 2, 4, -600]]);
    assert.ok(rows.every(r => r.close_reason === "stop_premium"));
    assert.equal(inspectFixedSellPlans(h.intent, (await h.coverage.snapshot(h.intent)).records).plans.length, 2);
    for (let restart = 0; restart < 3; restart++) assert.equal((await reconcileFixedLifecycle(ports, h.intent)).state, "settled");
    assert.equal(h.counts().posts, 3);
  }
  {
    const { h, ports, setBid } = harness();
    await Promise.all(Array.from({ length: 8 }, () => reconcileFixedLifecycle(ports, h.intent)));
    assert.equal(h.counts().posts, 1, "overlapping lifecycle workers submit the entry once");
    await h.lateBuy(); setBid(3.6);
    await Promise.all(Array.from({ length: 8 }, () => reconcileFixedLifecycle(ports, h.intent)));
    assert.equal(h.counts().posts, 2, "overlapping native exits share one sell command and booking");
    assert.equal((await reconcileFixedLifecycle(ports, h.intent)).state, "settled");
  }
  {
    const { h, ports, confirmCancel, cancels } = harness();
    await reconcileFixedLifecycle(ports, h.intent);
    h.setNow(h.coverage.now() + 3_001);
    await reconcileFixedLifecycle(ports, h.intent);
    assert.ok(cancels() > 0);
    assert.equal(h.counts().posts, 1, "requested cancellation cannot authorize another buy");
    confirmCancel();
    await reconcileFixedLifecycle(ports, h.intent);
    const s = await h.coverage.snapshot(h.intent), inventory = inspectFixedEntryInventory(h.intent, s.records);
    assert.ok(inventory.buySeal, "confirmed terminal partial exhausts the original single-market plan");
    assert.equal(h.counts().posts, 1, "partial terminal market fill is not topped up by an invented buy rung");
  }
  {
    const { h, ports, setBid, setManage } = harness();
    await reconcileFixedLifecycle(ports, h.intent); setBid(1); setManage(false);
    await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 1); assert.equal((await h.coverage.snapshot(h.intent)).brokerNetQty, 2);
    assert.ok((await h.coverage.snapshot(h.intent)).records.some(r => r.id === fixedLedgerId("exit-required", [h.intent.id])));
    setManage(true); await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 2);
  }
  {
    const { h, ports } = harness();
    ports.authorizeSubmission = async () => ({ allowed: true, validUntilMs: h.coverage.now() });
    await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(h.counts().posts, 0, "expired authority cannot survive the final holdings read");
  }
  {
    const { h, ports, setBid, confirmCancel } = harness({ spreadCapture: true });
    const requests: { side: string; qty: string; type: string; limit_price?: string }[] = [];
    let held = 0, sellCount = 0;
    ports.commands.submitOnce = async (_account, request) => {
      requests.push(structuredClone(request));
      const requested = Number(request.qty), index = request.side === "sell" ? sellCount++ : -1;
      const filled = index === 0 ? 1 : index === 1 ? 0 : requested;
      held += request.side === "buy" ? filled : -filled; h.setHeld(held);
      const order = { id: fixedLedgerId("ladder-broker", [request.client_order_id]), client_order_id: request.client_order_id,
        symbol: request.symbol, qty: request.qty, side: request.side, filled_qty: String(filled),
        filled_avg_price: filled > 0 ? "2" : null, status: filled === requested ? "filled" : filled > 0 ? "partially_filled" : "new" };
      h.broker.set(request.client_order_id, order); return order;
    };
    await reconcileFixedLifecycle(ports, h.intent);
    setBid(2.4); await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(sellCount, 1);
    const frozen = inspectFixedSellPlans(h.intent, (await h.coverage.snapshot(h.intent)).records).plans[0];
    confirmCancel(); h.setNow(h.coverage.now() + 1_001);
    await reconcileFixedLifecycle(ports, h.intent); // confirm partial first-rung cancellation, book one contract
    setBid(10); await reconcileFixedLifecycle(ports, h.intent); // next generation continues original wave/rung
    assert.equal(sellCount, 2);
    const sells = requests.filter(r => r.side === "sell");
    assert.deepEqual(sells.map(r => [r.qty, r.type, r.limit_price]), [["4", "limit", frozen.rungs[0].limitPrice], ["3", "limit", frozen.rungs[1].limitPrice]]);
    h.setNow(h.coverage.now() + 1_001);
    await reconcileFixedLifecycle(ports, h.intent); // terminal zero second limit, no invented sale
    assert.equal(sellCount, 2);
    const final = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(final.state, "settled"); assert.equal(sellCount, 3);
    assert.equal(requests.at(-1)?.type, "market"); assert.equal(requests.at(-1)?.qty, "3");
    assert.equal(inspectFixedSellPlans(h.intent, (await h.coverage.snapshot(h.intent)).records).plans.length, 1,
      "partial sells carry the same frozen ladder across remainder rows");
    assert.deepEqual([...h.positions.values()].map(r => [r.status, r.qty]), [["closed", 1], ["closed", 3]]);
  }
  {
    const { h, ports, setBid } = harness({ spreadCapture: true });
    await reconcileFixedLifecycle(ports, h.intent);
    const buy = h.broker.get(h.buy.command.clientOrderId)!;
    h.broker.set(h.buy.command.clientOrderId, { ...buy, status: "canceled" });
    const insert = ports.coverage.storage.insert;
    ports.coverage.storage.insert = row => row.reason === "fixed_entry_protocol:exit-required" ? Promise.resolve("unknown") : insert(row);
    setBid(1);
    const stopped = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(stopped.state, "unresolved"); assert.ok(stopped.reasons.includes("exit-request-unconfirmed"));
    assert.equal(h.counts().posts, 1, "observed stop blocks a fresh buy rung even when its durable latch cannot be written");
  }
  {
    const { h, ports } = harness({ spreadCapture: true });
    ports.coverage.insertPosition = async () => "unknown";
    await reconcileFixedLifecycle(ports, h.intent);
    const buy = h.broker.get(h.buy.command.clientOrderId)!;
    h.broker.set(h.buy.command.clientOrderId, { ...buy, status: "canceled" });
    const result = await reconcileFixedLifecycle(ports, h.intent);
    assert.equal(result.state, "unresolved");
    assert.equal(h.counts().posts, 1, "do not increase exposure while earlier partial fills lack verified position coverage");
  }
  console.log("fixedEntryLifecycle: PASS · combined entry/coverage/native exit/late fill/settlement, concurrent workers, terminal cancellation, original exit latch and authority expiry");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
