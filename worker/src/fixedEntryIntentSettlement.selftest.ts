import assert from "node:assert/strict";
import { fixedCoverageHarness as harness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { bookFixedSellCommand } from "./fixedEntrySellBooking.js";
import { sealFixedEntryBuys, settleFixedEntryIntent, type FixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { fixedProtocolRecord, fixedProtocolObservation } from "./fixedEntryLedgerPersistence.js";
const at = "2026-09-08T14:30:03.000Z";
async function exit(h: ReturnType<typeof harness>) {
  return requestFixedIntentExit(h.coverage.storage, h.intent, { source: "native-manager", reason: "stop_premium", requestedAt: at });
}
async function seal(h: ReturnType<typeof harness>, reason: "exit-required" | "buy-plan-finished" = "exit-required") {
  const s = await h.coverage.snapshot(h.intent);
  return sealFixedEntryBuys(h.coverage.storage, h.intent, s.records, reason, new Date(h.coverage.now()).toISOString());
}
async function settle(h: ReturnType<typeof harness>) {
  return settleFixedEntryIntent(h.coverage.storage, h.intent, await h.coverage.snapshot(h.intent), h.coverage.now());
}
async function main() {
  {
    const h = harness();
    assert.equal(await settle(h), null, "flatness without a buy seal cannot complete an intent");
    assert.equal(await seal(h, "buy-plan-finished"), null, "an unused buy plan has not finished");
    await exit(h); assert.ok(await seal(h));
    const done = await settle(h); assert.ok(done);
    assert.equal((done.body.intentSettlement as FixedIntentSettlement).sessionEntryConsumed, false);
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, h.buy)).reason, "buy-plan-sealed");
    assert.equal(h.counts().posts, 0);
    assert.equal((await settle(h))?.contentHash, done.contentHash);
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    assert.equal(await seal(h, "buy-plan-finished"), null, "partial working buy cannot be called a finished plan");
    const row = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    await exit(h); assert.ok(await seal(h));
    const sell = h.makeClaim("sell", 0, 2, row);
    await coordinateFixedCommand(h.commandPorts, h.intent, sell);
    await bookFixedSellCommand(h.bookPorts, h.intent, sell.command.id);
    assert.equal(await settle(h), null, "broker flat after partial exit does not retire a still-working buy");
    const pending = h.broker.get(h.buy.command.clientOrderId)!;
    h.broker.set(h.buy.command.clientOrderId, { ...pending, status: "canceled" });
    await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const done = await settle(h); assert.ok(done);
    const evidence = done.body.intentSettlement as FixedIntentSettlement;
    assert.equal(evidence.sessionEntryConsumed, true); assert.equal(evidence.boughtQty, 2); assert.equal(evidence.soldQty, 2);
    h.positions.set(row.id, { ...h.positions.get(row.id)!, realized_pnl: 777 });
    assert.equal(await settle(h), null, "even an existing receipt cannot conceal closed-row drift");
  }
  {
    const h = harness(); let attempts = 0;
    h.commandPorts.submitOnce = async () => { attempts++; throw new Error("owner disappeared before broker visibility"); };
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, h.buy)).state, "unresolved");
    await exit(h); assert.ok(await seal(h));
    for (let restart = 0; restart < 3; restart++) {
      await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
      assert.equal(await settle(h), null, "unknown claimed buy retains its capability even while positions/orders are empty");
    }
    assert.equal(attempts, 1);
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy); await h.lateBuy();
    assert.ok(await seal(h, "buy-plan-finished"));
    assert.equal(await settle(h), null, "terminal buys and a seal do not make held contracts flat");
    const row = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    await exit(h);
    const sell = h.makeClaim("sell", 0, 4, row);
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, sell)).state, "resolved");
    assert.equal(await settle(h), null, "unbooked sell effects must be completed before global settlement");
    await bookFixedSellCommand(h.bookPorts, h.intent, sell.command.id);
    const done = await settle(h); assert.ok(done);
    assert.equal((done.body.intentSettlement as FixedIntentSettlement).boughtQty, 4);
    const incomplete = await h.coverage.snapshot(h.intent);
    incomplete.positions = [];
    assert.equal(await settleFixedEntryIntent(h.coverage.storage, h.intent, incomplete, h.coverage.now()), null);
  }
  {
    const h = harness(); const stale = await h.coverage.snapshot(h.intent);
    const claim = fixedProtocolRecord({ id: h.buy.command.id, intentId: h.intent.id, kind: "command", recordedAt: at, body: { ...h.buy } });
    await h.coverage.storage.insert(fixedProtocolObservation(h.intent, claim));
    await exit(h);
    const afterExit = await h.coverage.snapshot(h.intent);
    stale.records = afterExit.records.filter(r => r.id !== claim.id);
    assert.equal(await sealFixedEntryBuys(h.coverage.storage, h.intent, stale.records, "exit-required", at), null,
      "stale zero-command view collides with a real claim instead of sealing around it");
    assert.ok(await seal(h));
    assert.equal(await settle(h), null);
  }
  {
    const h = harness(); let guards = 0;
    h.commandPorts.authorizeFresh = async () => ++guards === 1;
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, h.buy)).reason, "guard-rejected");
    assert.ok(await seal(h, "buy-plan-finished"));
    const done = await settle(h); assert.ok(done);
    assert.equal((done.body.intentSettlement as FixedIntentSettlement).sessionEntryConsumed, false,
      "a winner's durable not-submitted proof does not become a phantom session entry");
  }
  console.log("fixedEntryIntentSettlement: PASS · buy sealing, unknown-capability flatness trap, partial exit, terminal+booked requirements, stale seal collision, zero-fill quota evidence and closed drift");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
