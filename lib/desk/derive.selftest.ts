import assert from "node:assert/strict";
import { liveFundAdjust, liveFundPnl } from "./derive";
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
