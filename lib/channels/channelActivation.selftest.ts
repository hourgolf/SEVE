import assert from "node:assert/strict";
import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  compileReleaseManifest,
  type ChannelChangeProposal,
  type DynamicReadinessEvidence,
} from "./channelControlPlane";
import {
  CHANNEL_ACTIVATION_PROTOCOL_VERSION,
  buildImmutableActivationReceipt,
  buildRollbackPlan,
  buildShadowActivationCandidate,
  buildShadowRuntimeProjection,
  buildWorkerActivationAcknowledgement,
  evaluateSafeBoundary,
  resolveOpenPositionPolicy,
  reviewActivation,
  stampEntryPolicy,
  type ActivationReview,
  type OperatorActivationApproval,
  type SafeBoundaryInput,
  type WorkerCompatibilityProof,
} from "./channelActivation";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

const EVALUATED_AT = "2026-07-28T12:00:20.000Z";
const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const activeProjection = buildShadowRuntimeProjection(active);
const orb = active.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
assert.ok(orb);

const proposal: ChannelChangeProposal = {
  schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  id: "proposal:fixture:orb-manager-v2",
  baseSpecVersionId: orb.id,
  baseSpecContentHash: orb.contentHash,
  proposedSpecVersionId: "spec:proposal:orb-manager-v2",
  proposedPatch: {
    managerProfileId: "ORB54-B35-A13",
    managerVersion: `sha256:${"a".repeat(64)}`,
    exitParameters: {
      ...orb.exitParameters,
      managerLabel: "BANK 1 @ +35% · RUN 1 ON A13",
    },
    takeProfit: { kind: "bank", targetPct: 35, fraction: 0.5 },
  },
  reason: "Exercise the local activation protocol without changing runtime.",
  evidenceRefs: ["fixture:proposal"],
  authorKind: "operator",
  authorId: "fixture-operator",
  changeClass: "code-strategy-logic",
  validationResults: [],
  replaySummary: {
    state: "sufficient",
    exactSamples: 100,
    censoredSamples: 0,
    limitations: [],
    evidenceRefs: ["fixture:replay"],
  },
  approvalState: "approved",
  requestedActivationBoundary: "next-safe-entry",
  createdAt: "2026-07-28T11:55:00.000Z",
  activationAuthorized: false,
};

const readiness: DynamicReadinessEvidence = {
  replaySufficiency: {
    ok: true,
    fact: "Exact replay fixture passed.",
    evidenceRefs: ["fixture:replay"],
  },
  evidenceReadiness: {
    ok: true,
    fact: "All required capture paths are observed.",
    evidenceRefs: ["fixture:capture"],
  },
  safeBoundary: {
    ok: true,
    fact: "The safe-boundary observer is available.",
    evidenceRefs: ["fixture:boundary-observer"],
  },
};

const candidate = buildShadowActivationCandidate({ active, proposal, readiness });
assert.ok(candidate.compiled);
assert.ok(candidate.projection);

const manifestAccountIds = [...new Set(active.channelSpecs.map((spec) => spec.accountId))].sort();
const configuredAccountIds = [
  ...manifestAccountIds,
  "11111111-1111-4111-8111-111111111111",
].sort();
const boundary: SafeBoundaryInput = {
  observedAt: "2026-07-28T12:00:10.000Z",
  accountInventoryEvidenceRef: "runtime:configured-paper-account-inventory",
  configuredAccounts: configuredAccountIds.map((accountId) => ({ accountId, mode: "paper" })),
  brokerAccounts: configuredAccountIds.map((accountId) => ({
    accountId,
    openPositions: { state: "observed", count: 0, evidenceRef: `broker:${accountId}:positions` },
    openOrders: { state: "observed", count: 0, evidenceRef: `broker:${accountId}:orders` },
  })),
  deskOpenPositions: { state: "observed", count: 0, evidenceRef: "desk:positions" },
};

const approval: OperatorActivationApproval = {
  proposalId: proposal.id,
  approvedBy: "operator:fixture",
  approvedAt: "2026-07-28T11:59:00.000Z",
  evidenceRef: "operator:approval:fixture",
};

const compatibility: WorkerCompatibilityProof = {
  workerCompatibilityVersion: candidate.projection.workerCompatibilityVersion,
  workerReleaseId: active.manifest.releaseId,
  bootId: "boot:fixture:rc54",
  paperMode: true,
  observedAt: "2026-07-28T12:00:08.000Z",
  evidenceRef: "worker:compatibility:fixture",
};

const workerAcknowledgement = buildWorkerActivationAcknowledgement({
  candidate,
  workerReleaseId: compatibility.workerReleaseId,
  bootId: compatibility.bootId,
  acknowledgedAt: "2026-07-28T12:00:15.000Z",
  evidenceRef: "worker:ack:fixture",
});

type ReviewInput = Parameters<typeof reviewActivation>[0];
const baselineReviewInput: ReviewInput = {
  candidate,
  approval,
  boundary,
  compatibility,
  workerAcknowledgement,
  evaluatedAt: EVALUATED_AT,
};

const review = (patch: Partial<ReviewInput> = {}): Readonly<ActivationReview> =>
  reviewActivation({ ...baselineReviewInput, ...patch });

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("RC5.4 manifest projects deterministically into a disabled paper-only shadow", () => {
  const repeated = buildShadowRuntimeProjection(active);
  assert.deepEqual(repeated, activeProjection);
  assert.equal(activeProjection.state, "comparable");
  assert.equal(activeProjection.mode, "disabled-shadow");
  assert.equal(activeProjection.paperOnly, true);
  assert.equal(activeProjection.readOnly, true);
  assert.equal(activeProjection.orderAuthority, false);
  assert.equal(activeProjection.activationAuthorized, false);
  assert.match(activeProjection.configurationEpochId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(activeProjection.manifestContentHash, active.manifest.contentHash);
  assert.equal(Object.isFrozen(activeProjection), true);
});

check("candidate reuses the compiler and changes only the proposed channel", () => {
  assert.equal(candidate.validationReady, true);
  assert.equal(candidate.activationAuthorized, false);
  assert.equal(candidate.projection?.activationAuthorized, false);
  assert.equal(candidate.projection?.orderAuthority, false);
  assert.equal(candidate.activeSpec?.managerProfileId, "ORB54-B30-A13");
  assert.equal(candidate.proposedSpec?.managerProfileId, "ORB54-B35-A13");
  assert.equal(candidate.proposedSpec?.takeProfit.targetPct, 35);
  assert.equal(candidate.compiled?.manifest.parentManifestId, active.manifest.id);
  assert.equal(candidate.compiled?.manifest.rollbackTargetManifestId, active.manifest.id);
  assert.equal(candidate.diffs.length, 4);
});

check("missing replay evidence fails closed at validation", () => {
  const missingReplay = buildShadowActivationCandidate({
    active,
    proposal,
    readiness: {
      evidenceReadiness: readiness.evidenceReadiness,
      safeBoundary: readiness.safeBoundary,
    },
  });
  const result = review({ candidate: missingReplay });
  assert.equal(result.state, "awaiting-validation");
  assert.equal(result.blockers.some((blocker) => blocker.includes("replay-sufficiency")), true);
});

check("missing compatibility proof fails closed at validation", () => {
  const result = review({ compatibility: null });
  assert.equal(result.state, "awaiting-validation");
  assert.deepEqual(result.blockers, ["compatibility:missing"]);
});

check("worker compatibility mismatch and non-paper posture fail closed", () => {
  const result = review({
    compatibility: {
      ...compatibility,
      workerCompatibilityVersion: "wrong-worker-version",
      paperMode: false,
    },
  });
  assert.equal(result.state, "awaiting-validation");
  assert.equal(result.blockers.includes("compatibility:version_mismatch"), true);
  assert.equal(result.blockers.includes("compatibility:not_paper"), true);
});

check("explicit operator approval is required", () => {
  const result = review({ approval: null });
  assert.equal(result.state, "awaiting-operator-approval");
  assert.deepEqual(result.blockers, ["approval:missing"]);
  assert.equal(result.activationAuthorized, false);
});

check("approval must match the exact proposal", () => {
  const result = review({ approval: { ...approval, proposalId: "proposal:other" } });
  assert.equal(result.state, "awaiting-operator-approval");
  assert.deepEqual(result.blockers, ["approval:proposal_mismatch"]);
});

check("an open broker position blocks the safe boundary", () => {
  const result = review({
    boundary: {
      ...boundary,
      brokerAccounts: boundary.brokerAccounts.map((account, index) => index === 0
        ? {
          ...account,
          openPositions: { state: "observed" as const, count: 1, evidenceRef: "broker:position:open" },
        }
        : account),
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.some((blocker) => blocker.includes("positions:not_flat:1")), true);
});

check("an open broker order blocks the safe boundary", () => {
  const result = review({
    boundary: {
      ...boundary,
      brokerAccounts: boundary.brokerAccounts.map((account, index) => index === 0
        ? {
          ...account,
          openOrders: { state: "observed" as const, count: 1, evidenceRef: "broker:order:open" },
        }
        : account),
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.some((blocker) => blocker.includes("orders:not_flat:1")), true);
});

check("a broker query failure blocks instead of estimating flatness", () => {
  const result = review({
    boundary: {
      ...boundary,
      brokerAccounts: boundary.brokerAccounts.map((account, index) => index === 0
        ? { ...account, openOrders: { state: "failed" as const, error: "timeout" } }
        : account),
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.some((blocker) => blocker.includes("orders:query_failed")), true);
});

check("every configured account must have broker observations", () => {
  assert.equal(configuredAccountIds.length > manifestAccountIds.length, true);
  const result = review({
    boundary: {
      ...boundary,
      brokerAccounts: boundary.brokerAccounts.slice(1),
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.some((blocker) => blocker.includes("account_not_queried")), true);
});

check("the configured-account inventory requires its own evidence receipt", () => {
  const result = review({
    boundary: {
      ...boundary,
      accountInventoryEvidenceRef: "",
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.includes("safe_boundary:account_inventory_evidence_missing"), true);
});

check("a non-paper configured account blocks the protocol", () => {
  const result = review({
    boundary: {
      ...boundary,
      configuredAccounts: boundary.configuredAccounts.map((account, index) => index === 0
        ? { ...account, mode: "live" as const }
        : account),
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.some((blocker) => blocker.includes("non_paper_account")), true);
});

check("a desk position blocks even when broker accounts report flat", () => {
  const result = review({
    boundary: {
      ...boundary,
      deskOpenPositions: { state: "observed", count: 1, evidenceRef: "desk:position:open" },
    },
  });
  assert.equal(result.state, "awaiting-safe-boundary");
  assert.equal(result.blockers.includes("safe_boundary:desk_positions:not_flat:1"), true);
});

check("stale safe-boundary evidence blocks", () => {
  const result = evaluateSafeBoundary({
    boundary: { ...boundary, observedAt: "2026-07-28T11:00:00.000Z" },
    evaluatedAt: EVALUATED_AT,
  });
  assert.equal(result.state, "block");
  assert.equal(result.blockers.includes("safe_boundary:stale"), true);
});

check("worker acknowledgement is required after approval and boundary proof", () => {
  const result = review({ workerAcknowledgement: null });
  assert.equal(result.state, "awaiting-worker-ack");
  assert.deepEqual(result.blockers, ["worker_ack:missing"]);
});

check("worker acknowledgement must bind the exact manifest and epoch", () => {
  const result = review({
    workerAcknowledgement: {
      ...workerAcknowledgement,
      manifestContentHash: `sha256:${"0".repeat(64)}`,
      configurationEpochId: `sha256:${"1".repeat(64)}`,
    },
  });
  assert.equal(result.state, "awaiting-worker-ack");
  assert.equal(result.blockers.includes("worker_ack:manifest_hash_mismatch"), true);
  assert.equal(result.blockers.includes("worker_ack:configuration_epoch_mismatch"), true);
});

check("complete congruence reaches receipt-ready without granting runtime authority", () => {
  const result = review();
  assert.equal(result.state, "receipt-ready");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.activationAuthorized, false);
  assert.ok(result.safeBoundaryProof);
});

check("receipt pins exact diff, validator versions, worker ack, and rollback target", () => {
  const result = review();
  const receipt = buildImmutableActivationReceipt({
    review: result,
    scheduledFor: "2026-07-28T12:00:00.000Z",
    activatedAt: "2026-07-28T12:00:20.000Z",
  });
  assert.match(receipt.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(receipt.configurationEpochId, candidate.projection?.configurationEpochId);
  assert.equal(receipt.oldContentHash, candidate.activeSpec?.contentHash);
  assert.equal(receipt.newContentHash, candidate.proposedSpec?.contentHash);
  assert.equal(receipt.manifestContentHash, candidate.projection?.manifestContentHash);
  assert.equal(receipt.rollbackTargetManifestId, active.manifest.id);
  assert.equal(receipt.workerAcknowledgement.manifestContentHash, candidate.projection?.manifestContentHash);
  assert.equal(receipt.validatorVersions.includes(CHANNEL_ACTIVATION_PROTOCOL_VERSION), true);
  assert.equal(receipt.validationResults.every((gate) => gate.state === "pass"), true);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.workerAcknowledgement), true);
});

check("receipt cannot claim activation before its scheduled time", () => {
  assert.throws(() => buildImmutableActivationReceipt({
    review: review(),
    scheduledFor: "2026-07-28T12:00:20.000Z",
    activatedAt: "2026-07-28T12:00:19.000Z",
  }), /cannot precede/);
});

check("open position keeps its immutable entry-time manager after channel activation", () => {
  const stamp = stampEntryPolicy({
    positionId: "position:fixture:old-epoch",
    enteredAt: "2026-07-28T11:30:00.000Z",
    compiled: active,
    projection: activeProjection,
    channelSlug: "orb-ustop-ctl",
  });
  const resolved = resolveOpenPositionPolicy(stamp);
  assert.equal(resolved.managerProfileId, "ORB54-B30-A13");
  assert.equal((resolved.takeProfit.targetPct as number), 30);
  assert.notEqual(resolved.managerProfileId, candidate.proposedSpec?.managerProfileId);
  assert.notEqual(resolved.channelSpecContentHash, candidate.proposedSpec?.contentHash);
  assert.equal(Object.isFrozen(resolved), true);
});

check("open position resolution fails when its immutable epoch is missing", () => {
  const stamp = stampEntryPolicy({
    positionId: "position:fixture:bad-epoch",
    enteredAt: "2026-07-28T11:30:00.000Z",
    compiled: active,
    projection: activeProjection,
    channelSlug: "orb-ustop-ctl",
  });
  assert.throws(() => resolveOpenPositionPolicy({
    ...stamp,
    configurationEpochId: "",
  }), /missing an immutable/);
});

check("rollback targets the exact prior manifest and preserves open-position epochs", () => {
  assert.ok(candidate.projection);
  const oldStamp = stampEntryPolicy({
    positionId: "position:fixture:preserved",
    enteredAt: "2026-07-28T11:30:00.000Z",
    compiled: active,
    projection: activeProjection,
    channelSlug: "orb-ustop-ctl",
  });
  const plan = buildRollbackPlan({
    current: candidate.projection,
    target: activeProjection,
    openPositions: [oldStamp],
  });
  assert.equal(plan.state, "ready-for-review");
  assert.equal(plan.targetManifestId, active.manifest.id);
  assert.equal(plan.targetManifestContentHash, active.manifest.contentHash);
  assert.equal(plan.preservedOpenPositions[0].configurationEpochId, oldStamp.configurationEpochId);
  assert.equal(plan.historicalEvidenceMutation, "forbidden");
  assert.equal(plan.activationAuthorized, false);
});

check("rollback with an unpinned target fails closed", () => {
  assert.ok(candidate.projection);
  const result = buildRollbackPlan({
    current: {
      ...candidate.projection,
      rollbackTargetManifestId: "manifest:other",
    },
    target: activeProjection,
    openPositions: [],
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("rollback:target_manifest_mismatch"), true);
});

console.log(
  `channel-activation-selftest: ${checks}/${checks} passed · ${candidate.projection.configurationEpochId}`,
);
