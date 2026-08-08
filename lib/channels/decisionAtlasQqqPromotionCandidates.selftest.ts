import assert from "node:assert/strict";
import {
  DECISION_ATLAS_QQQ_CANDIDATES,
  buildDecisionAtlasQqqRegistration,
} from "./decisionAtlasQqqPromotionCandidates.js";

for (const candidate of DECISION_ATLAS_QQQ_CANDIDATES) {
  const registration = buildDecisionAtlasQqqRegistration({
    candidate,
    sourceContentHash: `sha256:${"a".repeat(64)}`,
    runtimeVersion: "stream-runtime-test",
    runtimeSourceCommit: "b".repeat(40),
    registeredAt: "2026-08-08T14:00:00.000Z",
    registeredBy: "operator:22222222-2222-4222-8222-222222222222",
  });
  assert.equal(registration.state, "paper-eligible", registration.blockers.join(";"));
  assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
  assert.equal(registration.candidateSpec?.quantity, 2);
  assert.equal(registration.candidateSpec?.accountId, candidate.accountId);
  assert.equal(registration.candidateSpec?.collisionDomain, candidate.collisionDomain);
  assert.equal(registration.executionAuthority, false);
  assert.equal(registration.runtimeMutationAuthorized, false);
  assert.equal(registration.orderAuthority, false);
}

assert.equal(DECISION_ATLAS_QQQ_CANDIDATES[0].slug, "vb-vwap-revert-qqq");
assert.equal(DECISION_ATLAS_QQQ_CANDIDATES[1].slug, "qqq-thrust-trail-wd");
assert.notEqual(
  DECISION_ATLAS_QQQ_CANDIDATES[0].collisionDomain,
  DECISION_ATLAS_QQQ_CANDIDATES[1].collisionDomain,
);

console.log("decision-atlas-qqq-promotion-candidates-selftest: 19/19 passed");
