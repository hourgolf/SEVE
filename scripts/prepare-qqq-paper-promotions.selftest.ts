import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./prepare-qqq-paper-promotions.ts", import.meta.url),
  "utf8",
);

assert.match(source, /publish-registrations/);
assert.match(source, /persist-draft/);
assert.match(source, /ack-authority-dark/);
assert.match(source, /vb-vwap-revert-qqq/);
assert.match(source, /qqq-thrust-trail-wd/);
assert.match(source, /rc54-morgue/);
assert.match(source, /grind-v3/);
assert.match(source, /orb-ustop-ctl/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /preview\.state !== "ready-for-worker-ack"/);
assert.match(source, /workerAcknowledgementWritten: false/);
assert.match(source, /activationApprovalWritten: false/);
assert.match(source, /activationReceiptWritten: false/);
assert.match(source, /runtimeMutationAuthorized: false/);
assert.match(source, /orderAuthority: false/);
assert.match(source, /productionRowsWritten:/);
assert.match(source, /"channel_roster_bundles"/);
assert.match(source, /"channel_roster_bundle_lifecycle_receipts"/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);

console.log("prepare-qqq-paper-promotions-selftest: 19/19 passed");
