import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./activate-tomorrow-session-packet.ts", import.meta.url),
  "utf8",
);

assert.match(source, /activation requires --execute/);
assert.match(source, /activation requires a printable --approval-ref/);
assert.match(source, /channelControlMutationWindow/);
assert.match(source, /packet\.intendedSession !== "2026-08-12"/);
assert.match(source, /activate_channel_roster_bundle/);
assert.match(source, /p_approved_lifecycle_receipt_id: randomUUID\(\)/);
assert.doesNotMatch(
  source,
  /p_approved_lifecycle_receipt_id:\s*acknowledgement\.validated_lifecycle_receipt_id/,
);
assert.match(source, /prepare_channel_change_proposal_preview/);
assert.match(source, /activate_channel_change_proposal/);
assert.match(source, /promotionsActive/);
assert.match(source, /managerProfileId === definition\.managerProfileId/);
assert.match(source, /worker acknowledgement payload drifted/);
assert.match(source, /active manifest drifted before apply/);
assert.match(source, /historicalEvidenceMutation: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /events.*insert/s);
assert.doesNotMatch(source, /positions.*(?:insert|update|delete)/s);
assert.doesNotMatch(source, /orders.*(?:insert|update|delete)/s);

console.log("activate-tomorrow-session-packet.selftest: PASS");
