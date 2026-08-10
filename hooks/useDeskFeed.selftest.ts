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
assert.match(source, /from\("execution_observations"\)/, "position scope must read immutable execution routes");
assert.match(source, /attributePositionsByImmutableExecutionAccount/, "position scope must reuse the canonical attribution helper");
assert.match(source, /recoverPositionsByImmutableOpportunityAccountForDisplay/, "legacy display recovery must reuse a pure immutable helper");
assert.match(source, /position_outcome_events[\s\S]*position_remainder_opened/, "legacy recovery must begin from immutable position outcomes");
assert.match(source, /\.eq\("event_kind", "broker_result"\)[\s\S]*\.eq\("action", "enter"\)[\s\S]*\.gt\("filled_qty", 0\)/, "legacy recovery must require positive filled-entry evidence");
assert.match(source, /state:\s*"recovered"/, "legacy recovery must remain visibly distinct from direct attribution");
assert.match(source, /positionLabel:\s*"live feed positions"/, "attribution failures must identify the affected live feed");
assert.match(source, /state:\s*"blocked"/, "routing failures must block attribution");
assert.doesNotMatch(source, /byAcct\(sb\.from\("positions"\)/, "positions must not fall back to mutable strategist account scope");
assert.match(source, /POSITION_FIELDS[\s\S]*runner_of/, "the live feed must retain immutable runner lineage");
assert.match(source, /summarizeLogicalTradeCohort/, "the session denominator must count logical trades");
assert.match(source, /net_liquidation,unrealized_pnl,captured_at/, "account NAV must carry its own unrealized basis");
assert.match(source, /snapshotUnrealizedPnl/, "the live headline must expose the matching snapshot basis");

console.log("desk-feed-egress-selftest: 20/20 passed");
