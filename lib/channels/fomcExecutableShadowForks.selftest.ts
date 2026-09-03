import assert from "node:assert/strict";
import type { CompiledReleaseManifest } from "./channelControlPlane";
import { buildFomcExecutableShadowForkRegistrations } from "./fomcExecutableShadowForks";

const active = {
  manifest: {
    admissionPolicies: [{ id: "rc54-lab", enabledForNewEntries: true }],
  },
  channelSpecs: [{
    id: "anchor",
    slug: "existing-lab-root",
    accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1",
    collisionDomain: "rc54-lab",
  }],
} as unknown as CompiledReleaseManifest;

const registrations = buildFomcExecutableShadowForkRegistrations({
  active,
  runtimeVersion: "selftest-runtime",
  runtimeSourceCommit: "a".repeat(40),
  registeredAt: "2026-09-02T23:30:00.000Z",
  registeredBy: "operator:22222222-2222-4222-8222-222222222222",
});

assert.deepEqual(registrations.map((row) => row.slug), ["pm-momentum-follow", "fomc-event-follow"]);
for (const registration of registrations) {
  assert.equal(registration.state, "paper-eligible", registration.blockers.join(";"));
  assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
  assert.equal(registration.executionAuthority, false);
  assert.equal(registration.orderAuthority, false);
  assert.equal(registration.cartridge?.lifecycle.liveMoneyAuthorized, false);
  assert.equal(registration.candidateSpec?.entryParameters.maxEntriesPerSession, 1);
}
assert.equal(registrations[0].candidateSpec?.quantity, 2);
assert.equal(registrations[1].candidateSpec?.quantity, 1);
assert.deepEqual(registrations[0].candidateSpec?.entryParameters.eventDay, { event: "fomc", present: false });
assert.deepEqual(registrations[1].candidateSpec?.entryParameters.eventDay, { event: "fomc", present: true });

console.log("fomc executable-shadow forks selftest: PASS");
