import assert from "node:assert/strict";
import {
  DECISION_ATLAS_IWM_PROMOTION,
  buildDecisionAtlasIwmRegistration,
} from "./decisionAtlasIwmPromotionCandidate";

const registration = buildDecisionAtlasIwmRegistration({
  sourceContentHash: `sha256:${"a".repeat(64)}`,
  runtimeVersion: "stream-runtime-test",
  runtimeSourceCommit: "b".repeat(40),
  registeredAt: "2026-08-14T22:30:00.000Z",
  registeredBy: "operator:22222222-2222-4222-8222-222222222222",
});

assert.equal(registration.state, "paper-eligible", registration.blockers.join(";"));
assert.equal(registration.slug, "vb-ribbon-cross-iwm");
assert.equal(registration.candidateSpec?.symbolScope[0], "IWM");
assert.equal(registration.candidateSpec?.accountId, DECISION_ATLAS_IWM_PROMOTION.accountId);
assert.equal(registration.candidateSpec?.collisionDomain, "rc54-lab");
assert.equal(registration.candidateSpec?.quantity, 2);
assert.equal(registration.candidateSpec?.entryParameters.maxEntriesPerSession, 1);
assert.equal(registration.candidateSpec?.takeProfit.targetPct, 25);
assert.equal(registration.candidateSpec?.stopLoss.catastrophePct, 30);
assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
assert.equal(registration.executionAuthority, false);
assert.equal(registration.runtimeMutationAuthorized, false);
assert.equal(registration.orderAuthority, false);

console.log("decision-atlas-iwm-promotion-candidate-selftest: 13/13 passed");
