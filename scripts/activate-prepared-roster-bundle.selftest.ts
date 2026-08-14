import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("scripts/activate-prepared-roster-bundle.ts"), "utf8");
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /channel_roster_bundle_worker_acknowledgements/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /globalFlat/);
assert.match(source, /activate_channel_roster_bundle/);
assert.match(source, /prepared bundle identity drifted/);
assert.match(source, /prepared bundle base manifest drifted/);
assert.match(source, /buildShadowRuntimeProjection/);
assert.match(source, /entry-epoch-immutable/);
assert.match(source, /orderAuthority: false/);
console.log("activate-prepared-roster-bundle.selftest: PASS");
