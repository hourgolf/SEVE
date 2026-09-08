import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, fixedLedgerId, buildFixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, parseFixedProtocolRecord,
  type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { coordinateFixedCommand, type FixedCommandClaim, type FixedCommandPorts, type FixedBrokerOrder } from "./fixedEntryCommandCoordinator.js";
import { authorizeFixedCommandChain } from "./fixedEntryChainAuthorization.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { bookFixedSellCommand, type FixedSellBookingPorts } from "./fixedEntrySellBooking.js";
import { materializeFixedEntryCoverage, fixedPositionIdentityMatches,
  type FixedMaterializedPosition, type FixedCoveragePorts } from "./fixedEntryCoverageMaterialization.js";
import { fixedRowCasMatches, fixedFencedProjection, readFixedRowFence } from "./fixedEntryRowFence.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import { fixedCoverageHarness as harness } from "./fixedEntryCoverage.fixtures.js";
async function main() {
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const results = await Promise.all(Array.from({ length: 12 }, () => materializeFixedEntryCoverage(h.coverage, h.intent)));
    assert.ok(results.some(r => r.state === "covered")); assert.equal(h.positions.size, 1);
    const initial = [...h.positions.values()][0];
    assert.equal(initial.qty, 2); assert.equal(initial.avg_entry_price, 2);
    assert.ok(fixedPositionIdentityMatches(h.intent, initial));
    assert.equal(initial.runner_of, null, "a fixed remainder never becomes a legacy runner");
    const before = h.counts();
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).state, "covered");
    assert.deepEqual(h.counts(), before, "identical terminality/economics need no repeated position write");
    await h.lateBuy();
    const late = await materializeFixedEntryCoverage(h.coverage, h.intent);
    assert.equal(late.state, "covered"); assert.equal(h.positions.size, 1);
    assert.equal(late.position?.qty, 4); assert.equal(late.position?.avg_entry_price, 3);
    assert.equal(late.position?.opened_at, initial.opened_at);
    assert.deepEqual(late.position?.entry_features.receipt_bound_entry_policy, initial.entry_features.receipt_bound_entry_policy);
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const insert = h.coverage.insertPosition;
    h.coverage.insertPosition = async () => "unknown";
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).state, "unresolved");
    assert.equal(h.positions.size, 0);
    await h.lateBuy(); h.coverage.insertPosition = insert;
    const recovered = await materializeFixedEntryCoverage(h.coverage, h.intent);
    assert.equal(recovered.state, "covered"); assert.equal(recovered.position?.qty, 4);
    assert.equal(recovered.position?.opened_at, "2026-09-08T14:30:03.000Z",
      "late recovery retains earliest durable positive-fill observation");
    assert.equal(h.counts().posts, 1, "failed inserts never buy again");
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const insert = h.coverage.insertPosition;
    h.coverage.insertPosition = async row => { await insert(row); return "unknown"; };
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).state, "covered",
      "lost INSERT response is recovered by exact deterministic row readback");
    assert.equal(h.positions.size, 1);
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const initial = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    await requestFixedIntentExit(h.coverage.storage, h.intent, { source: "native-manager", reason: "stop_premium",
      requestedAt: "2026-09-08T14:30:03.000Z" });
    const sell = h.makeClaim("sell", 0, 2, initial);
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, sell)).state, "resolved");
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).reason, "sell-must-be-terminal-and-booked-first");
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, sell.command.id)).state, "booked");
    const closed = structuredClone(h.positions.get(initial.id)!);
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).state, "known-flat");
    await h.lateBuy();
    const remainder = await materializeFixedEntryCoverage(h.coverage, h.intent);
    assert.equal(remainder.state, "covered"); assert.equal(remainder.position?.qty, 2);
    assert.equal(remainder.position?.avg_entry_price, 4); assert.equal(h.positions.size, 2);
    assert.equal(readFixedRowFence(remainder.position!).generation, 1);
    assert.equal(remainder.position?.opened_at, closed.opened_at);
    assert.deepEqual(h.positions.get(initial.id), closed, "late buys do not rewrite the original closed row");
    const lateSell = h.makeClaim("sell", 1, 2, remainder.position!);
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, lateSell)).state, "resolved");
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, lateSell.command.id)).state, "booked");
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).state, "known-flat");
    assert.equal(h.counts().posts, 3); assert.equal(h.positions.get(initial.id)?.realized_pnl, -200);
    assert.equal(h.positions.get(remainder.position!.id)?.realized_pnl, -600);
    h.positions.set(initial.id, { ...closed, realized_pnl: 777 });
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).reason, "closed-booking-drift");
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const row = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    h.setHeld(1);
    assert.equal((await materializeFixedEntryCoverage(h.coverage, h.intent)).reason, "broker-attribution-mismatch");
    assert.equal(h.positions.get(row.id)?.qty, 2, "manual/unregistered broker discrepancy cannot shrink coverage");
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    h.setHeld(4); h.broker.clear();
    const r = await materializeFixedEntryCoverage(h.coverage, h.intent);
    assert.equal(r.state, "covered"); assert.equal(r.position?.qty, 2); assert.equal(r.unprovenBrokerQty, 2);
    assert.deepEqual(r.unresolvedBuyCommands, [h.buy.command.id], "proven coverage does not claim unknown extra contracts have basis");
  }
  {
    const h = harness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
    const { protocol: _p, id: _id, contentHash: _hash, sessionSlotId: _slot, ...input } = h.intent;
    const altered = buildFixedEntryIntent({ ...input, writeStamp: { ...input.writeStamp,
      channel_spec_version_id: "00000000-0000-4000-8000-000000000099" } });
    assert.equal((await materializeFixedEntryCoverage(h.coverage, altered)).state, "unresolved");
    assert.equal(h.positions.size, 0);
  }
  console.log("fixedEntryCoverageMaterialization: PASS · overlapping recovery, lost inserts, earliest observed entry, late-fill expansion, deterministic remainder, closed P&L preservation, attribution and original policy");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
