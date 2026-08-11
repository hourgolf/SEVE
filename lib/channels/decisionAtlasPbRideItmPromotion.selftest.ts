import assert from "node:assert/strict";
import {
  DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE,
  buildDecisionAtlasPbRideItmRegistration,
} from "./decisionAtlasPbRideItmPromotion.js";

const registration = buildDecisionAtlasPbRideItmRegistration({
  sourceContentHash: `sha256:${"a".repeat(64)}`,
  runtimeVersion: "stream-runtime-test",
  runtimeSourceCommit: "b".repeat(40),
  registeredAt: "2026-08-11T02:00:00.000Z",
  registeredBy: "operator:22222222-2222-4222-8222-222222222222",
});

assert.equal(registration.state, "paper-eligible", registration.blockers.join(";"));
assert.equal(registration.slug, "pb-ride-itm");
assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
assert.equal(registration.candidateSpec?.quantity, 1);
assert.equal(registration.candidateSpec?.accountId, DECISION_ATLAS_PB_RIDE_ITM_CANDIDATE.accountId);
assert.equal(registration.candidateSpec?.collisionDomain, "rc54-lab");
assert.equal(registration.candidateSpec?.entryParameters.entryDte, 1);
assert.equal(registration.candidateSpec?.entryParameters.strikeOffset, -1);
assert.equal(registration.candidateSpec?.entryParameters.maxEntriesPerSession, 3);
assert.equal(registration.candidateSpec?.exitParameters.underlyingStopPct, 0.35);
assert.equal(registration.candidateSpec?.exitParameters.stallMinutes, 120);
assert.equal(registration.candidateSpec?.exitParameters.stallMaxFavorablePct, 25);
assert.equal(registration.candidateSpec?.takeProfit.targetPct, 10);
assert.equal(registration.candidateSpec?.stopLoss.catastrophePct, 30);
assert.equal(registration.executionAuthority, false);
assert.equal(registration.runtimeMutationAuthorized, false);
assert.equal(registration.orderAuthority, false);

console.log("decision-atlas-pb-ride-itm-promotion-selftest: 18/18 passed");
