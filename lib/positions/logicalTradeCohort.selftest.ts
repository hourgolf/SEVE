import assert from "node:assert/strict";
import { summarizeLogicalTradeCohort } from "./logicalTradeCohort.js";

const split = summarizeLogicalTradeCohort([
  { id: "root", runner_of: null, status: "closed", realized_pnl: 78, close_reason: "target_tranche" },
  { id: "runner", runner_of: "root", status: "closed", realized_pnl: 53, close_reason: "runner_giveback" },
]);
assert.deepEqual(
  [split.opened, split.closed, split.open, split.positionRows, split.realizedPnl],
  [1, 1, 0, 2, 131],
);

const stillOpen = summarizeLogicalTradeCohort([
  { id: "root", runner_of: null, status: "closed", realized_pnl: 78 },
  { id: "runner", runner_of: "root", status: "open", realized_pnl: 0 },
]);
assert.deepEqual([stillOpen.closed, stillOpen.open, stillOpen.realizedPnl], [0, 1, 0]);

const missing = summarizeLogicalTradeCohort([
  { id: "runner", runner_of: "missing", status: "open", realized_pnl: 0 },
]);
assert.match(missing.issues.join("\n"), /missing runner parent/);
const bounded = summarizeLogicalTradeCohort([
  { id: "runner", runner_of: "missing", status: "open", realized_pnl: 0 },
], { allowExternalParents: true });
assert.equal(bounded.issues.length, 0);
assert.equal(bounded.groups[0].rootPositionId, "missing");

const cycle = summarizeLogicalTradeCohort([
  { id: "a", runner_of: "b", status: "open" },
  { id: "b", runner_of: "a", status: "open" },
]);
assert.match(cycle.issues.join("\n"), /cycle/);

const manual = summarizeLogicalTradeCohort([
  { id: "root", runner_of: null, status: "closed", realized_pnl: -10, close_reason: "manual:risk" },
  { id: "runner", runner_of: "root", status: "closed", realized_pnl: 3, close_reason: "trail" },
]);
assert.equal(manual.manualCloses, 1);
assert.equal(manual.realizedPnl, -7);

const missingPnl = summarizeLogicalTradeCohort([
  { id: "root", runner_of: null, status: "closed", realized_pnl: null },
]);
assert.equal(missingPnl.realizedPnl, null);

console.log("logical-trade-cohort-selftest: 17/17 passed");
