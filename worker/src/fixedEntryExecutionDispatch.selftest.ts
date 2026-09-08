import assert from "node:assert/strict";
import { fixedEntryOwnershipPresent, fixedEntryRequested, fixedEntryExecutionDriver,
  installFixedEntryExecutionDriver } from "./fixedEntryExecutionDispatch.js";
import type { ExecCtx } from "./execute.js";
import type { ChannelConfig, PositionRow } from "./store.js";
import type { ShadowDecision } from "./decide.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { rowAccountIdOf } from "./routing.js";
async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture",
    SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { executeEntry, executeExit, executeReconcile, executeAdd } = await import("./execute.js");
  const store = await import("./store.js");
  const d = { slug: "vb-macd-state", action: "enter", qty: 4 } as ShadowDecision;
  const ch = { slug: "vb-macd-state", fixedContractAdmission: null } as unknown as ChannelConfig;
  const ctx = {} as ExecCtx; // Accessing legacy broker context would fail the test.
  const fixedRows = [
    { entry_features: { fixed_entry_coverage: null } },
    { entry_features: { fixed_entry_coverage: "malformed" } },
    { entry_features: { receipt_bound_entry_policy: { policyVersion: "receipt-bound-entry-policy-v3" } } },
    { entry_features: { receipt_bound_entry_policy: { fixedContractAdmission: null } } },
  ] as unknown as PositionRow[];
  for (const row of [{}, { entry_features: null }, { entry_features: {} },
    { entry_features: { receipt_bound_entry_policy: { policyVersion: "receipt-bound-entry-policy-v2" } } }]) {
    assert.equal(fixedEntryOwnershipPresent(row), false);
  }
  assert.equal(fixedEntryRequested(ch, ctx), true, "invalid fixed config cannot enter legacy sizing/order code");
  assert.equal(fixedEntryRequested({ fixedContractAdmission: undefined } as ChannelConfig, ctx), false);
  const original = fixedEntryIntentFixture();
  const fixedRow = { strategist_id: original.strategistId,
    entry_features: { receipt_bound_entry_policy: original.writeStamp.entry_policy } };
  const moved = new Map([[original.strategistId, { account_id: "different-account" } as ChannelConfig]]);
  assert.equal(rowAccountIdOf(fixedRow, moved, []), original.accountId, "current roster cannot move original fixed management");
  assert.equal(rowAccountIdOf({ strategist_id: original.strategistId,
    entry_features: { fixed_entry_coverage: null } }, moved, []), "__fixed_unresolved__");
  assert.throws(fixedEntryExecutionDriver, /durable_driver_unavailable/);
  await assert.rejects(executeEntry(d, ch, 640, ctx), /durable_driver_unavailable/);
  for (const row of fixedRows) {
    assert.equal(fixedEntryOwnershipPresent(row), true);
    await assert.rejects(executeExit(d, row, ctx), /durable_driver_unavailable/);
    await assert.rejects(executeReconcile(d, row, ctx), /durable_driver_unavailable/);
    await assert.rejects(executeAdd(d, {} as ChannelConfig, row, ctx), /pyramiding_prohibited/);
    await assert.rejects(store.insertPosition(row as Parameters<typeof store.insertPosition>[0]), /legacy_insert_prohibited/);
    await assert.rejects(store.insertPartialRemainderRow(row, 1, 1), /legacy_remainder_prohibited/);
    await assert.rejects(store.insertRunnerRow(row, 1, 1), /legacy_remainder_prohibited/);
  }
  const calls: string[] = [];
  installFixedEntryExecutionDriver({
    async enter(received, channel, spot, context) {
      assert.equal(received, d); assert.equal(channel, ch); assert.equal(spot, 640); assert.equal(context, ctx); calls.push("enter");
    },
    async exit(received, row, context) { assert.equal(received, d); assert.equal(row, fixedRows[0]); assert.equal(context, ctx); calls.push("exit"); },
    async reconcile(row, context) { assert.equal(row, fixedRows[0]); assert.equal(context, ctx); calls.push("reconcile"); },
  });
  await executeEntry(d, ch, 640, ctx);
  await executeExit(d, fixedRows[0], ctx);
  await executeReconcile(d, fixedRows[0], ctx);
  assert.deepEqual(calls, ["enter", "exit", "reconcile"]);
  assert.throws(() => installFixedEntryExecutionDriver(fixedEntryExecutionDriver()), /already_installed/);
  console.log("fixedEntryExecutionDispatch: PASS · real execution callpoints, malformed-marker routing, missing-driver fail-closed, forbidden legacy insert/remainder/add and one boot driver");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
