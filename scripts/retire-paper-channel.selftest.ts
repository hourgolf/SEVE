import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./retire-paper-channel.ts", import.meta.url),
  "utf8",
);

assert.match(source, /executionPosture: "observe-only"/);
assert.match(source, /context\.safeBoundaryProof\.globalFlat/);
assert.match(source, /freshContext\.safeBoundaryProof\.globalFlat/);
assert.match(source, /if \(!mutationWindow\.allowed\)/);
assert.match(source, /channel_roster_bundle_worker_acknowledgements/);
assert.match(source, /activate_channel_roster_bundle/);
assert.match(source, /preview\.diffs\.length !== 1/);
assert.match(source, /collectionStates\.get\(current\.channelId\) !== "active"/);
assert.match(source, /historicalEvidenceMutation: false/);
assert.match(source, /buildShadowRuntimeProjection\(before\)\.configurationEpochId/);
assert.match(source, /configurationEpochId: preview\.configurationEpochId/);
assert.match(source, /brokerOrders: 0/);
assert.doesNotMatch(source, /\.from\("(?:orders|positions|virtual_trades|events)"\)/);

console.log("retire-paper-channel.selftest: PASS");
