import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./apply-channel-collection-pause.ts", import.meta.url), "utf8");
assert.match(source, /requires --execute/);
assert.match(source, /expected-preview-hash/);
assert.match(source, /requires --packet-hash/);
assert.match(source, /executionPosture !== "observe-only"/);
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /previewChannelCollectionCull/);
assert.match(source, /apply_channel_collection_state_preview/);
assert.match(source, /historicalEvidenceChanged: false/);
assert.match(source, /brokerOrders: 0/);
assert.doesNotMatch(source, /channel_release_manifests|orders\)\.insert|positions\)\.update/);
console.log("apply channel collection pause selftest: PASS");
