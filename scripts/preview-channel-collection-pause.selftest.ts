import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./preview-channel-collection-pause.ts", import.meta.url), "utf8");
assert.match(source, /has no production write mode/);
assert.match(source, /productionWrites: 0, executionChanges: 0, brokerOrders: 0/);
assert.match(source, /previewChannelCollectionCull/);
assert.match(source, /RetainedHistory|retainedHistory/);
assert.doesNotMatch(source, /apply_channel_collection_state_preview/);

console.log("preview-channel-collection-pause-selftest: PASS");
