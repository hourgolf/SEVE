import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /requireDeskOperator\(req\)/);
assert.match(source, /loadActiveCompiledControlPlane/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /buildChannelRosterBundlePreview/);
assert.match(source, /prepareRosterBundleDraftWrite/);
assert.match(source, /expectedConfigurationEpochId/);
assert.match(source, /capacityPolicyVersion/);
assert.match(source, /activationAuthorized: false/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /placeOrder|submitOrder|\/v2\/orders/);

console.log("channel-roster-bundle-preview-route-selftest: 10/10 passed");
