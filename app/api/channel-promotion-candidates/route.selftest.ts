import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /requireDeskOperator/);
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /loadActiveCompiledControlPlane/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /exactly one current worker/);
assert.match(source, /candidate strategy source identity drifted/);
assert.match(source, /candidate shadow collection must be active/);
assert.match(source, /paper-eligible/);
assert.match(source, /executionAuthority: false/);
assert.match(source, /runtimeMutationAuthorized: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /placeOrder|submitOrder|cancelOrder/);
assert.doesNotMatch(source, /channel_roster_bundle_activations/);

console.log("channel-promotion-candidates-route-selftest: 13/13 passed");
