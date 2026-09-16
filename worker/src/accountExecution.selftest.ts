import assert from "node:assert/strict";
import { executeAccountBatches } from "./accountExecution.js";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
async function main() {
  const macd = gate();
  const calls: string[] = [];
  const batches = [
    { account: "lab", name: "macd" },
    { account: "lab", name: "same-account-followup" },
    { account: "control", name: "momo" },
    { account: "third", name: "native-stop" },
  ];
  let complete = false;
  const cycle = executeAccountBatches(batches, b => b.account, async b => {
    calls.push(b.name);
    if (b.name === "macd") await macd.promise;
  }).then(() => { complete = true; });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ["macd", "momo", "native-stop"],
    "MACD's unresolved broker/coverage work must not hold another account's entry or stop");
  assert.equal(complete, false, "next cycle cannot start while MACD occupancy is unsettled");
  macd.resolve(); await cycle;
  assert.equal(calls.at(-1), "same-account-followup", "same-account batches remain serial");
  assert.equal(complete, true);

  const slow = gate(); let rejected = false;
  const errors: string[] = [];
  const failed = executeAccountBatches(batches, b => b.account, async b => {
    errors.push(b.name);
    if (b.name === "macd") throw new Error("fixture:failed-proof");
    if (b.name === "momo") await slow.promise;
  }).catch(e => { assert.ok(e instanceof AggregateError); rejected = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(rejected, false, "a failed lane must not release cycle lock while another lane is active");
  assert.deepEqual(errors, ["macd", "momo", "native-stop"]);
  slow.resolve(); await failed; assert.equal(rejected, true);

  let executed = 0;
  await assert.rejects(executeAccountBatches(["valid", ""], x => x, async () => { executed++; }), /account_identity_missing/);
  assert.equal(executed, 0, "validate all lane identities before any execution");
  await executeAccountBatches([], x => String(x), async () => { executed++; });
  assert.equal(executed, 0);
  console.log("accountExecution: PASS · blocked MACD, independent entry/stop, serial same-account work, complete cycle drain on failure, invalid identity");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
