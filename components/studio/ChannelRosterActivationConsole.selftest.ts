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
const mobileRackRow = readFileSync(new URL(
  "../mobile2/MobileRackRow.tsx",
  import.meta.url,
), "utf8");
const mobileStudio = readFileSync(new URL(
  "../mobile2/MobileStudio.tsx",
  import.meta.url,
), "utf8");
const canary = readFileSync(new URL(
  "./CanaryCommandCenter.tsx",
  import.meta.url,
), "utf8");
const fleet = readFileSync(new URL("./StudioFleet.tsx", import.meta.url), "utf8");

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
assert.match(component, /MONDAY PAPER CANDIDATES/);
assert.match(component, /FREEZE PAPER ELIGIBILITY/);
assert.match(component, /STAGE CONSERVATIVE CANARY/);
assert.match(component, /GIVEBACK/);
assert.match(component, /EVIDENCE LIMITS/);
assert.match(component, /NEXT SAFE ENTRY/);
assert.match(component, /HISTORY/);
assert.match(component, /SAFE CHANGE WORKFLOW/);
assert.match(component, /ONE REVIEWABLE BUNDLE · NO DIRECT WRITES/);
assert.doesNotMatch(component, /<CanaryCommandCenter/);
assert.match(canary, /CANARY COMMAND CENTER/);
assert.match(canary, /SEALED · PREOPEN GATE NEXT/);
assert.match(canary, /PAPER · NEXT SAFE ENTRY/);
assert.match(canary, /EXECUTION EXCLUDED · COLLECTION INDEPENDENT/);
assert.match(canary, /Authority card, not liveness/);
assert.match(canary, /rollback_target_manifest_key/);
assert.match(mobileStudio, /<CanaryCommandCenter/);
assert.match(mobileStudio, /PAPER IN VIEW/);
assert.match(fleet, /RUNTIME ROSTER RECONCILIATION/);
assert.match(fleet, /<CanaryCommandCenter/);
assert.match(fleet, /IMMUTABLE RECEIPT AUTHORITY/);
assert.match(fleet, /PAPER IN VIEW/);
assert.doesNotMatch(component, /\bfetch\s*\(/);
assert.match(hook, /\/api\/channel-roster-bundles\/preview/);
assert.match(hook, /\/api\/channel-roster-bundles\/apply/);
assert.match(hook, /\/api\/channel-roster-bundles\/rollback/);
assert.match(hook, /bundle supersession failed closed/);
assert.match(hook, /\/api\/research-channel-registry/);
assert.match(hook, /\/api\/channel-promotion-candidates/);
assert.match(hook, /candidate qualification failed closed/);
assert.doesNotMatch(hook, /safeBoundaryProof:/);
assert.doesNotMatch(hook, /capacityEvaluation:/);
assert.doesNotMatch(hook, /brokerPositions:/);
assert.match(inspector, /<ChannelRosterActivationConsole selectedSlug=\{slug\}/);
assert.match(mobileRackRow, /<ChannelRosterActivationConsole selectedSlug=\{slug\}/);

console.log("channel roster activation console self-test passed");
