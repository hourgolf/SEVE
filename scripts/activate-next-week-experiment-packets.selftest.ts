import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "./activate-next-week-experiment-packets.ts",
  import.meta.url,
), "utf8");

assert.match(source, /if \(!execute\) throw new Error\("activation requires --execute"\)/);
assert.match(source, /packet receipt verification failed/);
assert.match(source, /grind packet base manifest drifted/);
assert.match(source, /maxEntriesPerSession !== 3/);
assert.match(source, /maxEntriesPerSession !== 2/);
assert.match(source, /grind activation changed an unapproved field/);
assert.match(source, /manifest drifted between grind and IWM preparation/);
assert.match(source, /buildChannelRosterBundlePreview/);
assert.match(source, /ready-for-worker-ack/);
assert.match(source, /safeBoundaryProof\.globalFlat !== true/);
assert.match(source, /maxOpenGlobal !== 2/);
assert.match(source, /sameOccOpenMax !== 1/);
assert.match(source, /activate_channel_change_proposal/);
assert.match(source, /activate_channel_roster_bundle/);
assert.match(source, /historicalEvidenceMutation: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /placeOrder|submitOrder|executeEntry/);

console.log("activate-next-week-experiment-packets-selftest: 17/17 passed");
