import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import { buildResearchChannelRegistry } from "./researchChannelRegistry.js";
import { buildChannelRosterBundlePreview } from "./channelRosterBundle.js";
import { buildOperatorPaperCapacityEnvelope } from "./channelPortfolioCapacityPolicy.js";
import {
  CHANNEL_PROMOTION_CANDIDATES,
  buildPromotionCandidateRegistration,
  promotionCandidateSummary,
} from "./channelPromotionCandidates.js";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const registrations = CHANNEL_PROMOTION_CANDIDATES.map((candidate) =>
  buildPromotionCandidateRegistration({
    active,
    slug: candidate.slug,
    runtimeVersion: "stream-runtime-2026-07-27a",
    runtimeSourceCommit: "1ea682203fa5d281a5556b3f2423b4e2e4fdb6a8",
    registeredAt: "2026-08-01T01:00:00.000Z",
    registeredBy: "operator:11111111-1111-4111-8111-111111111111",
  }));

assert.deepEqual(registrations.map((registration) => registration.state), [
  "paper-eligible",
  "paper-eligible",
  "paper-eligible",
]);
for (const registration of registrations) {
  assert.equal(registration.executionAuthority, false);
  assert.equal(registration.runtimeMutationAuthorized, false);
  assert.equal(registration.orderAuthority, false);
  assert.equal(registration.candidateSpec?.executionPosture, "observe-only");
  assert.equal(registration.candidateSpec?.quantity, 1);
  assert.equal(registration.candidateSpec?.accountRole, "PAPER-2");
  assert.equal(registration.candidateSpec?.collisionDomain, "rc54-lab");
}

const lead = promotionCandidateSummary(CHANNEL_PROMOTION_CANDIDATES[0]);
assert.equal(lead.slug, "vb-gap-drift");
assert.equal(lead.displacedRoot, "vb-squeeze-break");
assert.equal(lead.evidence.sample, 10);
assert.equal(lead.evidence.netPerContractUsd, 22);
assert.equal(lead.activationAuthority, false);

const registry = buildResearchChannelRegistry(registrations.map((row) => {
  const {
    registryVersion: _registryVersion,
    state: _state,
    blockers: _blockers,
    contentHash: _contentHash,
    executionAuthority: _executionAuthority,
    runtimeMutationAuthorized: _runtimeMutationAuthorized,
    orderAuthority: _orderAuthority,
    ...draft
  } = row;
  return draft;
}));
const preview = buildChannelRosterBundlePreview({
  active,
  registry,
  draft: {
    id: "22222222-2222-4222-8222-222222222222",
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    changes: [
      {
        slug: "vb-gap-drift",
        membership: "include",
        executionPosture: "paper",
        quantity: 1,
      },
      { slug: "vb-squeeze-break", membership: "exclude" },
    ],
    reason:
      "Conservative one-contract paper canary with exact paired displacement.",
    evidenceRefs: ["sentinel:2026-07-31:opportunities-bench"],
    operatorId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-01T01:05:00.000Z",
  },
  envelope: buildOperatorPaperCapacityEnvelope({
    accounts: [
      { accountId: "cd817549-e025-4d38-805e-d32e607052f7", equityUsd: 100_000 },
      { accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1", equityUsd: 100_000 },
      { accountId: "995aa327-b0da-4050-bede-97ab462b06cd", equityUsd: 100_000 },
    ],
    underlyings: ["SPY", "QQQ", "IWM"],
  }),
  live: {
    complete: true,
    observedAt: "2026-08-01T01:05:00.000Z",
    openOrders: 0,
    positions: [],
  },
  collectionStates: new Map([
    ...active.channelSpecs.map((spec): [string, "active"] =>
      [spec.channelId, "active"]),
    [registrations[0].channelId, "active"] as [string, "active"],
  ]),
});
assert.equal(preview.state, "ready-for-worker-ack");
assert.equal(preview.capacity?.state, "pass");
assert.deepEqual(preview.diffs.map((diff) => diff.slug), [
  "vb-gap-drift",
  "vb-squeeze-break",
]);
assert.equal(preview.historicalEvidenceMutation, false);
assert.equal(preview.orderAuthority, false);

assert.throws(() => buildPromotionCandidateRegistration({
  active,
  slug: "not-shortlisted",
  runtimeVersion: "stream-runtime-2026-07-27a",
  runtimeSourceCommit: "1ea682203fa5d281a5556b3f2423b4e2e4fdb6a8",
  registeredAt: "2026-08-01T01:00:00.000Z",
  registeredBy: "operator:11111111-1111-4111-8111-111111111111",
}), /frozen shortlist/);

console.log("channel-promotion-candidates-selftest: 27/27 passed");
