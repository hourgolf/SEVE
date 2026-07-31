import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL(
  "./ChannelRosterActivationConsole.tsx",
  import.meta.url,
), "utf8");
const hook = readFileSync(new URL(
  "../../hooks/useChannelRosterBundleControl.ts",
  import.meta.url,
), "utf8");
const inspector = readFileSync(new URL("./ChannelInspector.tsx", import.meta.url), "utf8");

assert.match(component, /ATOMIC ROSTER · PROSPECTIVE PAPER ENTRY/);
assert.match(component, /EXCLUDE · KEEP SHADOW/);
assert.match(component, /PREVIEW FLAT BOOK \+ CAPACITY/);
assert.match(component, /TYPE APPLY NEXT SAFE ENTRY/);
assert.match(component, /5 \* 60_000/);
assert.match(component, /worker acknowledgement expired · cancel and reseal/);
assert.match(component, /PREVIEW EXACT ROLLBACK/);
assert.match(component, /activationReceipt\?\.configuration_epoch_id/);
assert.match(component, /ACTIVE ROLLBACK EPOCH/);
assert.match(component, /SUPERSEDE →/);
assert.match(component, /WHY THIS RESEARCH CHANNEL CANNOT BE PROMOTED YET/);
assert.match(component, /shadow collection continues · zero order authority/);
assert.match(component, /no runtime mutation · no order authority · history untouched/);
assert.doesNotMatch(component, /\bfetch\s*\(/);
assert.match(hook, /\/api\/channel-roster-bundles\/preview/);
assert.match(hook, /\/api\/channel-roster-bundles\/apply/);
assert.match(hook, /\/api\/channel-roster-bundles\/rollback/);
assert.match(hook, /bundle supersession failed closed/);
assert.match(hook, /\/api\/research-channel-registry/);
assert.doesNotMatch(hook, /safeBoundaryProof:/);
assert.doesNotMatch(hook, /capacityEvaluation:/);
assert.doesNotMatch(hook, /brokerPositions:/);
assert.match(inspector, /<ChannelRosterActivationConsole selectedSlug=\{slug\}/);

console.log("channel roster activation console self-test passed");
