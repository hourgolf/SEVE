import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import { buildResearchChannelRegistry } from "./researchChannelRegistry.js";
import {
  DECISION_ATLAS_BREAKOUT_CANDIDATE,
  buildDecisionAtlasBreakoutRegistration,
} from "./decisionAtlasPromotionCandidate.js";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const registration = buildDecisionAtlasBreakoutRegistration({
  active,
  runtimeVersion: "stream-runtime-2026-08-03a",
  runtimeSourceCommit: "d30a9954595e2db177a8d829e2452a4da0d5acab",
  registeredAt: "2026-08-08T00:00:00.000Z",
  registeredBy: "operator:11111111-1111-4111-8111-111111111111",
});

assert.equal(registration.state, "paper-eligible");
assert.deepEqual(registration.blockers, []);
assert.equal(registration.executionAuthority, false);
assert.equal(registration.runtimeMutationAuthorized, false);
assert.equal(registration.orderAuthority, false);
assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
assert.equal(registration.candidateSpec?.quantity, 2);
assert.equal(registration.candidateSpec?.accountId, DECISION_ATLAS_BREAKOUT_CANDIDATE.accountId);
assert.equal(registration.candidateSpec?.collisionDomain, "rc54-lab");
assert.equal(registration.candidateSpec?.riskLimits.maxDebitUsd, 600);
assert.equal(registration.candidateSpec?.riskLimits.maxRiskUsd, 240);
assert.equal(registration.cartridge?.management.managerId, "PREMIUM-ALL-OUT-22");
assert.equal(registration.cartridge?.risk.maxContracts, 2);

const registry = buildResearchChannelRegistry([{
  id: registration.id,
  channelId: registration.channelId,
  slug: registration.slug,
  registeredAt: registration.registeredAt,
  registeredBy: registration.registeredBy,
  cartridge: registration.cartridge,
  candidateSpec: registration.candidateSpec,
  declaredBlockers: registration.declaredBlockers,
}]);
assert.equal(registry.summary.paperEligible, 1);
assert.equal(registry.executionAuthority, false);

console.log("decision-atlas-promotion-candidate-selftest: 16/16 passed");
