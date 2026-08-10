import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./operator-experiment-preflight.ts", import.meta.url), "utf8");
assert.match(source, /loadChannelCollectionInventory/);
assert.match(source, /loadStoredReceiptBoundControlPlane/);
assert.match(source, /previewChannelCollectionCull/);
assert.match(source, /context_drift/);
assert.match(source, /paperBehaviorChangesReady/);
assert.match(source, /productionWrites: 0/);
assert.doesNotMatch(source, /\.rpc\(|\.insert\(|\.upsert\(|\.delete\(/);
assert.doesNotMatch(source, /\.from\([^)]*\)\s*\.\s*update\(/s);
console.log("operator-experiment-preflight-selftest: PASS");
