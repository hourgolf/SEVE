import assert from "node:assert/strict";
import { reportingSession, sessionSnapshots } from "./reportingSession";
import { reconcileSessionNav } from "./sessionNavReconciliation";
const session = reportingSession(Date.parse("2026-09-17T02:30:00Z"));
assert.equal(session.date, "2026-09-16");
assert.equal(session.openMs, Date.parse("2026-09-16T13:30:00Z"));
const rows = ["2026-09-16T13:31:02Z", "2026-09-16T21:55:13Z", "2026-09-17T01:54:59Z"].map((ts, i) => ({ ts, equity: 1000 + 10 * i }));
assert.equal(sessionSnapshots(rows, session).baseline?.ts, rows[0].ts, "after-hours gap preserves the opening baseline");
assert.equal(sessionSnapshots(rows, session, 2).curve[0].ts, rows[0].ts, "sampling preserves the first endpoint");
assert.equal(sessionSnapshots(rows.slice(1), session).baseline, null, "late snapshots cannot manufacture a session baseline");
assert.equal(reportingSession(Date.parse("2026-09-07T16:00Z")).date, "2026-09-04", "holiday uses last session");
assert.equal(reportingSession(Date.parse("2026-11-27T20:00Z")).closeMs, Date.parse("2026-11-27T18:00Z"), "half day and winter offset");
assert.equal(reportingSession(Date.parse("2026-09-17T04:01Z")).date, "2026-09-17", "ET midnight begins a new reporting date");
const late = reconcileSessionNav({ accounts: [{ accountId: "a", sessionWindow: session,
  startingSnapshot: { netLiquidation: 1000, capturedAt: rows[2].ts, unrealizedPnl: 0 },
  endingSnapshot: { netLiquidation: 1000, capturedAt: rows[2].ts, unrealizedPnl: 0 }, positionRows: [] }] });
assert.equal(late.state, "invalid");assert.equal(late.brokerNavDeltaExact, null, "late empty snapshots are not exact zero reconciliation");
console.log("reporting session regression checks passed");
