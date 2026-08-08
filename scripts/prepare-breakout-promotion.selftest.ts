import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./prepare-breakout-promotion.ts", import.meta.url),
  "utf8",
);

assert.match(source, /publish-registration/);
assert.match(source, /persist-draft/);
assert.match(source, /ack-authority-dark/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /buildDecisionAtlasBreakoutRegistration/);
assert.match(source, /prepareResearchChannelRegistrationWrite/);
assert.match(source, /prepareRosterBundleDraftWrite/);
assert.match(source, /expected one fresh exact worker/);
assert.match(source, /expected one desk operator/);
assert.match(source, /preview\.state !== "ready-for-worker-ack"/);
assert.match(source, /workerAcknowledgementWritten: false/);
assert.match(source, /activationApprovalWritten: false/);
assert.match(source, /activationReceiptWritten: false/);
assert.match(source, /runtimeMutationAuthorized: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /transition_channel_roster_bundle/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);

console.log("prepare-breakout-promotion-selftest: 17/17 passed");
