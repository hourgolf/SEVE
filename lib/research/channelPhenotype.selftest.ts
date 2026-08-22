import assert from "node:assert/strict";
import { channelFamily, conversionScore, median, pathDisposition, type PhenotypeOpportunity } from "./channelPhenotype.js";

assert.equal(median([9, 1, 5]), 5);
assert.equal(median([1, 3]), 2);
assert.equal(channelFamily("breakout-alt-v3-itm"), "breakout");
assert.equal(channelFamily("vb-gap-drift-qqq"), "vb-gap-drift");

const base: PhenotypeOpportunity = {
  id: "signal:1", channel: "alpha", family: "alpha", session: "2026-08-01",
  entryAt: "2026-08-01T14:00:00Z", entryMinute: "2026-08-01T14:00", entryPrice: 1,
  direction: "call", underlying: "SPY", mfePct: 30, nativeReturnPct: -5, ordinal: 1, buckets: {},
};
assert.equal(pathDisposition(base), "available_but_lost");
assert.equal(pathDisposition({ ...base, nativeReturnPct: 10 }), "profit_leaked");
assert.equal(pathDisposition({ ...base, nativeReturnPct: 20 }), "profit_retained");
assert.equal(conversionScore({ ...base, nativeReturnPct: 15 }), 50);

console.log("channelPhenotype.selftest: PASS");
