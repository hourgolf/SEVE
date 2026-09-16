import assert from "node:assert/strict";
import { buildForensicsExecutionSummary, readForensicsExecutionSummary } from "./forensicsExecutionSummary";

const input = { date: "2026-09-15", observedAt: "2026-09-15T20:45:00Z",
  from: "2026-09-15T04:00:00Z", toExclusive: "2026-09-16T04:00:00Z",
  rows: [16, -84, 140, 62, 44, 82].map((pnl, i) => ({ id: `p${i}`, account_id: `a${i % 3}`,
    qty: i === 2 ? 4 : 2, realized_pnl: pnl, runner_of: null as string | null, strategists: { slug: `channel${i}` } })) };
const summary = buildForensicsExecutionSummary(input);
assert.equal(summary.grossPnlUsd, 260);
assert.equal(summary.nClosedTranches, 6);
assert.equal(summary.nRootPositions, 6);
assert.equal(summary.feesIncluded, false);
assert.deepEqual(readForensicsExecutionSummary(summary, input.date), summary);
assert.equal(readForensicsExecutionSummary(undefined, input.date), null);
assert.equal(readForensicsExecutionSummary({ ...summary, grossPnlUsd: 82 }, input.date), null);
assert.equal(readForensicsExecutionSummary(summary, "2026-09-14"), null);
assert.equal(readForensicsExecutionSummary({ ...summary, source: "simulation" }, input.date), null);
assert.throws(() => buildForensicsExecutionSummary({ ...input, rows: [...input.rows, input.rows[0]] }), /duplicate/);
assert.throws(() => buildForensicsExecutionSummary({ ...input, rows: [{ ...input.rows[0], realized_pnl: null }] }), /Incomplete/);
assert.throws(() => buildForensicsExecutionSummary({ ...input, rows: [{ ...input.rows[0], account_id: "" }] }), /Incomplete/);
const runner = buildForensicsExecutionSummary({ ...input, rows: [input.rows[0], { ...input.rows[1], runner_of: "p0" }] });
assert.equal(runner.nClosedTranches, 2);
assert.equal(runner.nRootPositions, 1);
assert.equal(runner.grossPnlUsd, -68);
const unknownAccount = buildForensicsExecutionSummary({ ...input, rows: [{ ...input.rows[0], account_id: null }] });
assert.equal(unknownAccount.nUnattributedTranches, 1);
assert.equal(unknownAccount.grossPnlUsd, 16, "missing attribution never drops real PnL");
assert.equal(buildForensicsExecutionSummary({ ...input, rows: [] }).grossPnlUsd, 0);
console.log("forensics execution summary: all-account totals, losses, tranches, missing evidence and legacy fallback passed");
