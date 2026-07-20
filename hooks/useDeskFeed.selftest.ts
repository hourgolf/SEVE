import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useDeskFeed.ts", import.meta.url), "utf8");

assert.match(source, /async function loadCurve\(\)/, "curve history should have a one-time loader");
assert.match(source, /equityQuery\(\)\.limit\(2\)/, "recurring feed should fetch only the equity tail");
assert.match(source, /\.limit\(100\)/, "closed positions should be bounded to the current-session display need");
assert.doesNotMatch(source, /select\(sel\)/, "recurring positions must not select every column");
assert.doesNotMatch(source, /table: "signals"/, "signal inserts must not refetch the full desk bundle");
assert.doesNotMatch(source, /table: "equity_snapshots"/, "equity inserts must not refetch the full desk bundle");
assert.match(source, /if \(pollInFlight \|\| !mounted\.current\) return;/, "overlapping desk polls must be rejected");

console.log("desk-feed-egress-selftest: 7/7 passed");
