import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "./prepare-next-week-experiment-packets.ts",
  import.meta.url,
), "utf8");

assert.match(source, /Default and only mode is read-only preview/);
assert.match(source, /loadActiveCompiledControlPlane/);
assert.match(source, /buildOperatorProposal/);
assert.match(source, /proposedPatch: \{ maxEntriesPerSession: 2 \}/);
assert.match(source, /buildDecisionAtlasIwmRegistration/);
assert.match(source, /maxOpenByUnderlying: \{ \.\.\.lab\.maxOpenByUnderlying, IWM: 1 \}/);
assert.match(source, /sameClockMaxByUnderlying: \{ \.\.\.lab\.sameClockMaxByUnderlying, IWM: 1 \}/);
assert.match(source, /executionPosture: "paper"/);
assert.match(source, /quantity: DECISION_ATLAS_IWM_PROMOTION\.quantity/);
assert.match(source, /ready-for-worker-ack/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /activation: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /\.insert\(/);
assert.doesNotMatch(source, /\.upsert\(/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /activate_channel_change_proposal/);
assert.doesNotMatch(source, /placeOrder|submitOrder|executeEntry/);

console.log("prepare-next-week-experiment-packets-selftest: 18/18 passed");
