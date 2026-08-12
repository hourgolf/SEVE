import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./prepare-tomorrow-session-packet.ts", import.meta.url),
  "utf8",
);

assert.match(source, /SELECT\/GET-only/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /buildChannelRosterBundlePreview/);
assert.match(source, /expected one fresh exact worker/);
assert.match(source, /expected one desk operator/);
assert.match(source, /event\/manual-arm gate missing/);
assert.match(source, /ready-for-worker-ack/);
assert.match(source, /publishPreparation && !acknowledged/);
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /prepareResearchChannelRegistrationWrite/);
assert.match(source, /prepareRosterBundleDraftWrite/);
assert.match(source, /preparation-persisted-no-activation/);
assert.match(source, /activationAuthorized: false/);
assert.match(source, /runtimeMutationAuthorized: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /\.insert\(/);
assert.doesNotMatch(source, /\.upsert\(/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /activate_channel_change_proposal/);

console.log("prepare-tomorrow-session-packet-selftest: PASS");
