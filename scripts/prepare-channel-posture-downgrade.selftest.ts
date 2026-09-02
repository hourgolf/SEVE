import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./prepare-channel-posture-downgrade.ts", import.meta.url), "utf8");
assert.match(source, /no production write or activation mode/);
assert.match(source, /productionWrites: 0, activation: false, brokerOrders: 0/);
assert.match(source, /executionPosture: "observe-only"/);
assert.match(source, /collectionStates\.get\(current\.channelId\) !== "active"/);
assert.match(source, /preview\.diffs\.length !== 1/);
assert.match(source, /globalFlat/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /prepareRosterBundleDraftWrite/);

console.log("prepare-channel-posture-downgrade-selftest: PASS");
