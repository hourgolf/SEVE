import assert from "node:assert/strict";
import {
  SENTINEL_VIRTUAL_TRADE_ORDER,
  SENTINEL_VIRTUAL_TRADE_SELECT,
} from "./virtualTradeQuery";

const selected = SENTINEL_VIRTUAL_TRADE_SELECT.split(",");

assert(selected.includes("signal_id"), "the stable primary key must be selected");
assert(!selected.includes("id"), "virtual_trades has no id column");
assert.deepEqual(
  SENTINEL_VIRTUAL_TRADE_ORDER,
  ["signal_at", "signal_id"],
  "pagination must order by time and then the unique primary key",
);

console.log("sentinel-virtual-trade-query-selftest: 3/3 PASS");
