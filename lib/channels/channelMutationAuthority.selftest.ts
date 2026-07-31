import assert from "node:assert/strict";
import {
  CHANNEL_MUTATION_AUTHORITY_VERSION,
  LEGACY_CONFIGURATION_WRITES_ENABLED,
  channelMutationDecision,
} from "./channelMutationAuthority.js";

assert.equal(CHANNEL_MUTATION_AUTHORITY_VERSION, "receipt-bound-channel-mutation-authority-v1");
assert.equal(LEGACY_CONFIGURATION_WRITES_ENABLED, false);

for (const kind of [
  "configuration",
  "execution-posture",
  "executor-route",
  "channel-create",
  "channel-delete",
] as const) {
  const decision = channelMutationDecision(kind);
  assert.equal(decision.allowed, false);
  assert.equal(decision.authority, "governed-proposal");
  assert.match(decision.fact, /governed proposal/);
}

for (const kind of ["presentation", "manual-position-risk"] as const) {
  const decision = channelMutationDecision(kind);
  assert.equal(decision.allowed, true);
  assert.equal(decision.authority, "operator-authentication");
}

console.log("channel mutation authority self-test passed");
