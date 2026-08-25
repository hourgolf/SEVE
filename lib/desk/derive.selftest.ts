import assert from "node:assert/strict";
import { liveFundAdjust, liveFundPnl } from "./derive";
import { reconcileSessionNav } from "./sessionNavReconciliation";
import type { Position } from "./types";

const position = (overrides: Partial<Position> = {}): Position => ({
  id: "position-1",
  strategist_slug: "grind-v3",
  occ_symbol: "SPY260810P00774000",
  expiration: "2026-08-10",
  strike: 774,
  opt_type: "put",
  qty: 4,
  avg_entry_price: 0.87,
  current_mark: 0.91,
  unrealized_pnl: 16,
  status: "open",
  opened_at: "2026-08-18T13:45:00.000Z",
  ...overrides,
});

const accountSnapshot = { nav: 899_964, dayPnl: -36 };
const liveMarks = { SPY260810P00774000: 0.7125 };
const snapshotAt = "2026-08-18T14:12:02.000Z";

assert.equal(
  Math.round(liveFundAdjust([position()], liveMarks, -36, snapshotAt)),
  -27,
  "live adjustment must bridge from the account snapshot's -$36 unrealized basis to the -$63 live mark",
);
assert.deepEqual(
  liveFundPnl(accountSnapshot, [position()], liveMarks, -36, snapshotAt),
  { nav: 899_937, dayPnl: -63 },
  "the stale +$16 position row must not create the observed false -$115 headline",
);

const reconciliation = reconcileSessionNav({
  accounts: [{
    accountId: "lab",
    startingSnapshot: { netLiquidation: 980_071.64, unrealizedPnl: 0, capturedAt: "2026-08-24T13:31:03.000Z" },
    endingSnapshot: { netLiquidation: 979_772.94, unrealizedPnl: 0, capturedAt: "2026-08-24T19:03:03.000Z" },
    positionRows: [
      { id: "closed", status: "closed", realizedPnl: -298, unrealizedPnl: 0, openedAt: "2026-08-24T13:46:00.000Z", closedAt: "2026-08-24T15:25:00.000Z", rootPositionId: "closed" },
    ],
  }],
});
assert.equal(reconciliation.state, "complete");
assert.equal(reconciliation.brokerNavDeltaExact, -298.70);
assert.equal(reconciliation.logicalTradeAttributionExact, -298);
assert.equal(reconciliation.brokerAdjustmentExact, -0.70);
assert.equal(reconciliation.display.brokerNavDelta, -299);
assert.equal(reconciliation.display.logicalTradeAttribution, -298);

const partialAndOpen = reconcileSessionNav({
  accounts: [{
    accountId: "first-team",
    startingSnapshot: { netLiquidation: 100_000, unrealizedPnl: 0, capturedAt: "2026-08-24T13:30:00.000Z" },
    endingSnapshot: { netLiquidation: 100_012.25, unrealizedPnl: -12.75, capturedAt: "2026-08-24T16:01:00.000Z" },
    positionRows: [
      { id: "partial-bank", rootPositionId: "trade-1", status: "closed", realizedPnl: 30, unrealizedPnl: 0, openedAt: "2026-08-24T14:00:00.000Z", closedAt: "2026-08-24T15:00:00.000Z" },
      { id: "partial-runner", rootPositionId: "trade-1", status: "open", realizedPnl: 0, unrealizedPnl: -12.75, openedAt: "2026-08-24T14:00:00.000Z", closedAt: null },
      { id: "open-2", rootPositionId: "trade-2", status: "open", realizedPnl: 0, unrealizedPnl: -5, openedAt: "2026-08-24T15:30:00.000Z", closedAt: null },
    ],
  }],
});
assert.equal(partialAndOpen.logicalTradeAttributionExact, 12.25, "partial closes add booked realized to every open remainder mark");
assert.equal(partialAndOpen.brokerAdjustmentExact, 0, "open books reconcile against broker NAV without a flat-only assumption");

const multiAccount = reconcileSessionNav({
  accounts: [
    {
      accountId: "lab",
      startingSnapshot: { netLiquidation: 980_071.64, unrealizedPnl: 0, capturedAt: "2026-08-24T13:31:03.000Z" },
      endingSnapshot: { netLiquidation: 979_772.94, unrealizedPnl: 0, capturedAt: "2026-08-24T19:03:03.000Z" },
      positionRows: [{ id: "lab-row", rootPositionId: "lab-row", status: "closed" as const, realizedPnl: -298, unrealizedPnl: 0, openedAt: "2026-08-24T13:46:00.000Z", closedAt: "2026-08-24T15:25:00.000Z" }],
    },
    {
      accountId: "morgue",
      startingSnapshot: { netLiquidation: 89_376.67, unrealizedPnl: 0, capturedAt: "2026-08-24T13:31:02.000Z" },
      endingSnapshot: { netLiquidation: 89_128.25, unrealizedPnl: 0, capturedAt: "2026-08-24T19:04:02.000Z" },
      positionRows: [{ id: "morgue-row", rootPositionId: "morgue-row", status: "closed" as const, realizedPnl: -248, unrealizedPnl: 0, openedAt: "2026-08-24T14:00:00.000Z", closedAt: "2026-08-24T18:35:00.000Z" }],
    },
    {
      accountId: "first-team",
      startingSnapshot: { netLiquidation: 983_694.15, unrealizedPnl: 0, capturedAt: "2026-08-24T13:31:03.000Z" },
      endingSnapshot: { netLiquidation: 983_561.85, unrealizedPnl: 0, capturedAt: "2026-08-24T19:03:03.000Z" },
      positionRows: [{ id: "first-row", rootPositionId: "first-row", status: "closed" as const, realizedPnl: -132, unrealizedPnl: 0, openedAt: "2026-08-24T14:00:00.000Z", closedAt: "2026-08-24T15:26:00.000Z" }],
    },
  ],
});
assert.equal(multiAccount.brokerNavDeltaExact, -679.42);
assert.equal(multiAccount.logicalTradeAttributionExact, -678);
assert.equal(multiAccount.brokerAdjustmentExact, -1.42, "fees/adjustments remain an explicit residual until independently typed");
assert.equal(multiAccount.display.brokerNavDelta, -679, "round once after exact multi-account aggregation");

const lateBroker = reconcileSessionNav({
  accounts: [{
    accountId: "late",
    startingSnapshot: { netLiquidation: 10_000, unrealizedPnl: 0, capturedAt: "2026-08-24T13:30:00.000Z" },
    endingSnapshot: { netLiquidation: 9_990, unrealizedPnl: 0, capturedAt: "2026-08-24T14:00:00.000Z" },
    positionRows: [{ id: "closed-after-snapshot", rootPositionId: "closed-after-snapshot", status: "closed", realizedPnl: -20, unrealizedPnl: 0, openedAt: "2026-08-24T13:45:00.000Z", closedAt: "2026-08-24T14:01:00.000Z" }],
  }],
});
assert.equal(lateBroker.state, "partial");
assert.equal(lateBroker.brokerNavDeltaExact, null, "a late broker snapshot never becomes a final aggregate");
assert.deepEqual(
  liveFundPnl(accountSnapshot, [position()], liveMarks, null, snapshotAt),
  accountSnapshot,
  "missing snapshot basis must fail closed instead of mixing clocks",
);
assert.deepEqual(
  liveFundPnl(accountSnapshot, [position()], {}, -36, snapshotAt),
  accountSnapshot,
  "an incomplete live mark set must not partially re-mark account NAV",
);
assert.equal(
  Math.round(liveFundAdjust([
    position(),
    position({
      id: "position-2",
      occ_symbol: "SPY260810C00775000",
      qty: 2,
      avg_entry_price: 1,
      unrealized_pnl: 20,
    }),
  ], { ...liveMarks, SPY260810C00775000: 1.2 }, 4, snapshotAt)),
  -27,
  "multiple open positions must reconcile from one account-level unrealized basis",
);
assert.equal(
  liveFundAdjust([position({ status: "closed", closed_at: "2026-08-18T14:10:00.000Z" })], liveMarks, -36, snapshotAt),
  0,
  "closed positions must never re-mark the account snapshot",
);
assert.deepEqual(
  liveFundPnl(accountSnapshot, [position({ opened_at: "2026-08-18T14:12:07.000Z" })], liveMarks, -36, snapshotAt),
  accountSnapshot,
  "a newly opened position must not replace unrealized P&L from an older account book",
);
assert.deepEqual(
  liveFundPnl(accountSnapshot, [
    position(),
    position({
      id: "just-closed",
      status: "closed",
      opened_at: "2026-08-18T14:03:00.000Z",
      closed_at: "2026-08-18T14:12:19.000Z",
      realized_pnl: -276,
    }),
  ], liveMarks, -270, snapshotAt),
  accountSnapshot,
  "a close after the account snapshot must hold broker NAV instead of mixing two books",
);
assert.deepEqual(
  liveFundPnl(accountSnapshot, [position()], liveMarks, -36, null),
  accountSnapshot,
  "a missing snapshot timestamp must fail closed",
);

console.log("desk-derive-selftest: PASS");
