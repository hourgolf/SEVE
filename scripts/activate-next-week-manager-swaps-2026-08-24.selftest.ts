import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("scripts/activate-next-week-manager-swaps-2026-08-24.ts"), "utf8");
assert.match(source, /activate_channel_change_proposal/);
assert.match(source, /expected-worker-commit/);
assert.match(source, /VB-MACD-CURRENT-LOCK18/);
assert.match(source, /VB-LEVEL-CURRENT-LOCK25/);
assert.match(source, /brokerWrites: 0/);
assert.doesNotMatch(source, /placeOrder|closePosition|cancelOrder/);
console.log("activate-next-week-manager-swaps-2026-08-24-selftest: 6/6 PASS");
