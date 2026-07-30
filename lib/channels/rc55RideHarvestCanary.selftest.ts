import assert from "node:assert/strict";
import { managerIdsForChannel } from "../../engine/managerPolicy";
import {
  parseReceiptBoundEntryPolicy,
  receiptBoundA13GivebackReached,
  receiptBoundBankTargetReached,
} from "../../worker/src/receiptBoundEntryPolicy";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import { buildRc55RideHarvestCanary } from "./rc55RideHarvestCanary";

const GENERATED_AT = "2026-07-30T04:30:00.000Z";
const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const first = buildRc55RideHarvestCanary(active, GENERATED_AT);
const second = buildRc55RideHarvestCanary(active, GENERATED_AT);
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("packet is deterministic and never grants authority", () => {
  assert.deepEqual(first, second);
  assert.match(first.deterministicEvidenceHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.state, "prepared-review-only");
  assert.equal(first.authority.persistenceAuthorized, false);
  assert.equal(first.authority.proposalCreated, false);
  assert.equal(first.authority.activationAuthorized, false);
  assert.equal(first.authority.orderAuthority, false);
});

check("best-shot targets are exact and channel-specific", () => {
  assert.deepEqual(
    first.channels.map((channel) => ({
      slug: channel.slug,
      targetPct: channel.targetPct,
      strength: channel.evidenceStrength,
    })),
    [
      {
        slug: "pb-ride",
        targetPct: 50,
        strength: "exact-cap-aware-supported",
      },
      {
        slug: "grind-v3",
        targetPct: 25,
        strength: "exact-cap-aware-defensive",
      },
      {
        slug: "breakout-alt-v3-iwm",
        targetPct: 20,
        strength: "bounded-forward-canary",
      },
    ],
  );
});

check("A13 semantics are exact and cannot drift from the executable policy", () => {
  for (const channel of first.channels) {
    assert.deepEqual(channel.managerSemantics, {
      bankFraction: 0.5,
      runnerFraction: 0.5,
      catastropheStopPct: 30,
      a13: {
        description:
          "Arm after a +50% executable-bid peak, then exit the runner after it gives back 33% of peak gain, retaining 67% of peak gain.",
        priceBasis: "executable-option-bid",
        engageReturnPct: 50,
        givebackPct: 33,
        retainGainPct: 67,
      },
    });
    assert.equal(
      channel.proposal.proposedPatch.ratchetParameters?.engageReturnPct,
      channel.managerSemantics.a13.engageReturnPct,
    );
    assert.equal(
      channel.proposal.proposedPatch.ratchetParameters?.givebackPct,
      channel.managerSemantics.a13.givebackPct,
    );
    assert.equal(
      channel.proposal.proposedPatch.ratchetParameters?.retainGainPct,
      channel.managerSemantics.a13.retainGainPct,
    );
  }
});

check("each manager patch is atomic and preserves the rest of the channel", () => {
  for (const channel of first.channels) {
    assert.equal(channel.draftRpc, "create_channel_manager_policy_proposal_draft");
    assert.deepEqual(channel.semanticDiffFields, [
      "exitParameters",
      "managerProfileId",
      "managerVersion",
      "ratchetParameters",
      "takeProfit",
    ]);
    assert.equal(channel.proposal.proposedPatch.takeProfit?.fraction, 0.5);
    assert.equal(channel.proposal.proposedPatch.stopLoss?.catastrophePct, 30);
    assert.equal(channel.proposal.proposedPatch.ratchetParameters?.kind, "a13");
    assert.equal(channel.proposal.activationAuthorized, false);
    assert.equal(Object.values(channel.preservation).every(Boolean), true);
  }
});

check("worker and dashboard receive the same reviewed manager identity", () => {
  for (const channel of first.channels) {
    assert.equal(
      channel.candidate.workerRoot.channelSpecContentHash,
      channel.candidate.dashboardRoot.channelSpecContentHash,
    );
    assert.deepEqual(
      channel.candidate.workerRoot.takeProfit,
      channel.candidate.dashboardRoot.takeProfit,
    );
    assert.deepEqual(
      channel.candidate.workerRoot.ratchetParameters,
      channel.candidate.dashboardRoot.ratchetParameters,
    );
  }
});

check("old positions stay full-RIDE while the next entry receives the new epoch", () => {
  for (const channel of first.channels) {
    const oldEntry = channel.entryEpochProof.preservedOpenPosition;
    const nextEntry = channel.entryEpochProof.nextEligibleEntry;
    assert.equal(oldEntry.managerProfileId, "RC53-RIDE");
    assert.equal(oldEntry.takeProfit.kind, "ride");
    assert.equal(oldEntry.ratchetParameters.kind, "none");
    assert.equal(nextEntry.managerProfileId, channel.managerProfileId);
    assert.equal(nextEntry.takeProfit.kind, "bank");
    assert.equal(nextEntry.takeProfit.targetPct, channel.targetPct);
    assert.equal(nextEntry.ratchetParameters.kind, "a13");
    assert.notEqual(nextEntry.configurationEpochId, oldEntry.configurationEpochId);
    assert.equal(channel.entryEpochProof.openPositionPolicyChanged, false);
    assert.equal(channel.entryEpochProof.nextEntryUsesCandidatePolicy, true);
  }
});

check("same-entry full-RIDE counterfactual remains enrolled for every canary", () => {
  for (const channel of first.channels) {
    assert.equal(
      managerIdsForChannel(channel.slug).includes("BELL/no-stop"),
      true,
    );
  }
});

check("worker parses and executes each new manager without an RC5.4 profile lookup", () => {
  for (const channel of first.channels) {
    const stamp = channel.entryEpochProof.nextEligibleEntry;
    const root = channel.candidate.workerRoot;
    const policy = parseReceiptBoundEntryPolicy({
      policyVersion: "receipt-bound-entry-policy-v2",
      configuration: {
        identityVersion: 1,
        releaseManifestId: stamp.releaseManifestId,
        releaseManifestContentHash: stamp.releaseManifestContentHash,
        channelSpecVersionId: stamp.channelSpecVersionId,
        channelSpecContentHash: stamp.channelSpecContentHash,
        configurationEpochId: stamp.configurationEpochId,
        channelSlug: stamp.channelSlug,
        accountId: stamp.accountId,
        managerProfileId: stamp.managerProfileId,
        managerVersion: stamp.managerVersion,
      },
      quantity: root.quantity,
      premiumCap: root.premiumCap,
      aggregateDebitCap: root.aggregateDebitCap,
      takeProfit: root.takeProfit,
      stopLoss: root.stopLoss,
      ratchetParameters: root.ratchetParameters,
      managerProfileId: stamp.managerProfileId,
      managerVersion: stamp.managerVersion,
      reentryPolicy: root.maxEntriesPerSession === 1 ? "disabled" : "bounded",
      maxEntriesPerSession: root.maxEntriesPerSession,
      historicalMutationAuthorized: false,
    });
    assert.ok(policy);
    assert.equal(receiptBoundBankTargetReached({
      policy,
      isRunner: false,
      entryPrice: 1,
      mark: 1 + channel.targetPct / 100,
    }), true);
    assert.equal(receiptBoundBankTargetReached({
      policy,
      isRunner: true,
      entryPrice: 1,
      mark: 2,
    }), false);
    assert.equal(receiptBoundA13GivebackReached({
      policy,
      isRunner: true,
      entryPrice: 1,
      peak: 1.60,
      mark: 1.40,
    }), true);
  }
});

check("missing live readiness remains explicit and fail-closed", () => {
  for (const channel of first.channels) {
    assert.equal(channel.candidate.staticBlockers.length, 0);
    assert.equal(channel.previewEvidence.replaySummary.state, "sufficient");
    assert.equal(channel.previewEvidence.replaySummary.exactSamples > 0, true);
    assert.equal(channel.previewEvidence.capacityCollisionImpact.state, "pass");
    assert.equal(
      channel.previewEvidence.capacityCollisionImpact.changedCapacityFields.length,
      0,
    );
    assert.equal(
      channel.previewEvidence.liveEvidenceTemplate
        .refreshImmediatelyBeforePreviewAndActivation,
      true,
    );
    assert.equal(
      channel.previewEvidence.liveEvidenceTemplate.configuredPaperAccountInventory,
      "independent-runtime-inventory-must-be-queried-in-full",
    );
    assert.equal(
      channel.previewEvidence.liveEvidenceTemplate
        .configuredInventoryMustContainEveryManifestAccount,
      true,
    );
    assert.equal(channel.candidate.dynamicReadinessPending.includes("safe-boundary"), true);
    assert.equal(channel.candidate.dynamicReadinessPending.includes("evidence-readiness"), true);
  }
  assert.equal(first.remainingRuntimeProofs.length >= 8, true);
});

check("local activation rehearsals produce exact cumulative receipts and rollback identities", () => {
  let priorManifestId = first.source.manifestId;
  for (const channel of first.channels) {
    const rehearsal = channel.localActivationRehearsal;
    assert.equal(rehearsal.evidenceKind, "synthetic-local-protocol-rehearsal");
    assert.equal(rehearsal.productionEvidenceAccepted, false);
    assert.equal(rehearsal.reviewState, "receipt-ready");
    assert.equal(rehearsal.validationReady, true);
    assert.equal(rehearsal.activationAuthorized, false);
    assert.equal(rehearsal.persistenceAuthorized, false);
    assert.equal(rehearsal.receipt.releaseManifestId, channel.candidate.manifestId);
    assert.equal(
      rehearsal.receipt.manifestContentHash,
      channel.candidate.manifestContentHash,
    );
    assert.equal(rehearsal.receipt.rollbackTargetManifestId, priorManifestId);
    assert.equal(rehearsal.rollback.state, "ready-for-review");
    assert.equal(rehearsal.rollback.targetManifestId, priorManifestId);
    assert.equal(rehearsal.rollback.historicalEvidenceMutation, "forbidden");
    assert.equal(rehearsal.rollback.activationAuthorized, false);
    assert.equal(
      rehearsal.rollback.preservedOpenPositions[0].configurationEpochId,
      channel.entryEpochProof.preservedOpenPosition.configurationEpochId,
    );
    priorManifestId = channel.candidate.manifestId;
  }
  assert.equal(priorManifestId, first.finalCandidate.manifestId);
});

check("a second pass refuses to reinterpret already-modified candidates", () => {
  const modified = {
    ...RC54_CONTROL_PLANE_FIXTURE,
    channelSpecs: RC54_CONTROL_PLANE_FIXTURE.channelSpecs.map((spec) =>
      spec.slug === "pb-ride"
        ? {
          ...spec,
          takeProfit: { kind: "bank" as const, targetPct: 50, fraction: 0.5 as const },
        }
        : spec),
  };
  assert.throws(
    () => buildRc55RideHarvestCanary(
      compileReleaseManifest(modified),
      GENERATED_AT,
    ),
    /pb-ride: active baseline drifted/,
  );
});

console.log(`RC5.5 ride-harvest canary self-test passed (${checks} checks)`);
