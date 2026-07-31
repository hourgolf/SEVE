import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /requireDeskOperator\(req\)/);
assert.match(source, /channel_roster_bundle_activation_receipts/);
assert.match(source, /loadCompiledControlPlaneByManifestKey/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /buildExactRosterRollbackPreview/);
assert.match(source, /rollbackRestoresExactSemantics/);
assert.match(source, /prepareExactRosterRollbackDraftWrite/);
assert.match(source, /expectedConfigurationEpochId/);
assert.match(source, /activationAuthorized: false/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /placeOrder|submitOrder|\/v2\/orders/);

console.log("channel-roster-bundle-rollback-route-selftest: 11/11 passed");
