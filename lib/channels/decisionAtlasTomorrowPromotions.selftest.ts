import assert from "node:assert/strict";
import {
  buildTomorrowPromotionRegistration,
  DECISION_ATLAS_TOMORROW_PROMOTIONS,
} from "./decisionAtlasTomorrowPromotions.js";
import type { CompiledReleaseManifest } from "./channelControlPlane.js";

const routes = [
  ["rc54-control", "cd817549-e025-4d38-805e-d32e607052f7", "momo-shape-2", 3],
  ["rc54-lab", "56daa293-e6bc-447d-83ac-2bfafb4d0ac1", "vb-macd-state", 1],
  ["rc54-morgue", "995aa327-b0da-4050-bede-97ab462b06cd", "orb-ustop-ctl", 4],
] as const;

const active = {
  manifest: {
    admissionPolicies: routes.map(([id, , slug, priority]) => ({
      id,
      enabledForNewEntries: true,
      maxOpenPerFamily: 1,
      maxOpenByUnderlying: { SPY: 2 },
      maxOpenGlobal: 2,
      sameOccOpenMax: 1,
      reentry: "disabled",
      sameClockMaxByUnderlying: { SPY: 1 },
      priorityBySlug: { [slug]: priority },
      crossDomainSameOcc: "allow-with-receipt",
    })),
  },
  channelSpecs: routes.map(([collisionDomain, accountId, slug, priority], index) => ({
    id: `anchor:${index}`,
    slug,
    channelId: `${index + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
    accountId,
    collisionDomain,
    symbolScope: ["SPY"],
    priority,
  })),
} as unknown as CompiledReleaseManifest;

for (const candidate of DECISION_ATLAS_TOMORROW_PROMOTIONS) {
  const registration = buildTomorrowPromotionRegistration({
    active,
    slug: candidate.slug,
    sourceContentHash: `sha256:${"a".repeat(64)}`,
    runtimeVersion: "stream-runtime-test",
    runtimeSourceCommit: "b".repeat(40),
    registeredAt: "2026-08-11T23:30:00.000Z",
    registeredBy: "operator:22222222-2222-4222-8222-222222222222",
  });
  assert.equal(registration.candidateSpec?.accountId, candidate.accountId);
  assert.equal(registration.candidateSpec?.collisionDomain, candidate.collisionDomain);
  assert.equal(registration.candidateSpec?.quantity, 2);
  assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
  assert.equal(registration.candidateSpec?.entryParameters.maxEntriesPerSession, 1);
  assert.equal(registration.executionAuthority, false);
  assert.equal(registration.runtimeMutationAuthorized, false);
  assert.equal(registration.orderAuthority, false);
  if (candidate.slug === "fomc-follow") {
    assert.equal(registration.state, "registered-blocked");
    assert.deepEqual(registration.blockers, [
      "promotion:custom_arm35_runtime_compatibility_not_sealed",
      "promotion:event_session_or_manual_arm_gate_missing",
    ]);
  } else {
    assert.equal(registration.state, "paper-eligible", registration.blockers.join(";"));
  }
}

assert.deepEqual(
  DECISION_ATLAS_TOMORROW_PROMOTIONS.map((row) => [
    row.slug,
    row.accountName,
    row.priority,
  ]),
  [
    ["grind-smart-entries", "FIRST-TEAM", 2],
    ["grind-v3-2", "LAB", 2],
    ["breakout-alt-v3-itm", "MORGUE", 1],
    ["fomc-follow", "MORGUE", 3],
  ],
);

console.log("decision-atlas-tomorrow-promotions-selftest: PASS");
