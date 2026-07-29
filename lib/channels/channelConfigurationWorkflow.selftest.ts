import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildShadowRuntimeProjection } from "./channelActivation";
import {
  evaluateCaptureContinuity,
  projectEconomicConfiguration,
} from "./channelConfigurationWorkflow";
import {
  buildConfigurationEpochIdentity,
  stampConfigurationEvidence,
  validateConfigurationEvidenceChain,
} from "./channelEpochEvidence";
import { buildRc54NoopConfigurationCanary } from "./rc54NoopConfigurationCanary";

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

const canary = buildRc54NoopConfigurationCanary();

check("the RC5.4 no-op canary completes every inert protocol stage", () => {
  assert.equal(canary.simulation.state, "receipt-ready");
  assert.equal(canary.simulation.review.state, "receipt-ready");
  assert.ok(canary.simulation.receipt);
  assert.equal(canary.simulation.rollback?.state, "ready-for-review");
  assert.equal(canary.simulation.captureContinuity.state, "pass");
  assert.equal(canary.evidenceChain.state, "pass");
  assert.equal(canary.workerStage.state, "acknowledged");
  assert.equal(canary.workerStage.runtimeMutation, false);
  assert.equal(canary.workerStage.databaseWriteAuthority, false);
  assert.equal(canary.liveMutationPerformed, false);
  assert.equal(canary.liveProposalCreated, false);
  assert.equal(canary.activationAuthorized, false);
  assert.equal(canary.orderAuthority, false);
});

check("the no-op changes identity but not economics", () => {
  const candidate = canary.simulation.candidate;
  assert.ok(candidate.compiled);
  assert.ok(candidate.projection);
  assert.equal(canary.simulation.economicsEquivalent, true);
  assert.equal(candidate.diffs.length, 1);
  assert.equal(candidate.diffs[0]?.field, "quantity");
  assert.equal(candidate.diffs[0]?.before, candidate.diffs[0]?.after);
  assert.notEqual(candidate.activeSpec?.id, candidate.proposedSpec?.id);
  assert.equal(candidate.activeSpec?.contentHash, candidate.proposedSpec?.contentHash);
  assert.notEqual(
    candidate.projection?.manifestContentHash,
    canary.simulation.receipt?.oldContentHash,
  );
  assert.deepEqual(
    projectEconomicConfiguration(candidate.compiled),
    canary.simulation.economicProjectionBefore,
  );
});

check("worker and dashboard projections share one reviewed manifest identity", () => {
  const compiled = canary.simulation.candidate.compiled;
  const projection = canary.simulation.candidate.projection;
  assert.ok(compiled);
  assert.ok(projection);
  assert.equal(compiled.workerProjection.manifestContentHash, projection.manifestContentHash);
  assert.equal(compiled.dashboardProjection.manifestContentHash, projection.manifestContentHash);
  assert.deepEqual(
    compiled.workerProjection.roots.map((root) => root.channelSpecVersionId).sort(),
    compiled.dashboardProjection.roots.map((root) => root.channelSpecVersionId).sort(),
  );
});

check("every configured paper account is queried, including one outside the manifest", () => {
  const manifestAccounts = new Set(
    canary.simulation.candidate.activeSpec
      ? canary.simulation.review.candidate.compiled?.channelSpecs.map((spec) => spec.accountId)
      : [],
  );
  const boundary = canary.simulation.review.boundary;
  assert.ok(boundary);
  assert.equal(boundary.configuredAccounts.length, 4);
  assert.equal(boundary.brokerAccounts.length, boundary.configuredAccounts.length);
  assert.equal(boundary.configuredAccounts.some((account) => !manifestAccounts.has(account.accountId)), true);
});

check("an existing position retains its pre-activation configuration epoch", () => {
  const candidateProjection = canary.simulation.candidate.projection;
  assert.ok(candidateProjection);
  assert.notEqual(
    canary.preservedPositionPolicy.configurationEpochId,
    candidateProjection.configurationEpochId,
  );
  assert.equal(
    canary.simulation.rollback?.preservedOpenPositions[0]?.configurationEpochId,
    canary.preservedPositionPolicy.configurationEpochId,
  );
});

check("the canary evidence is deterministic", () => {
  const repeated = buildRc54NoopConfigurationCanary();
  assert.equal(repeated.deterministicEvidenceHash, canary.deterministicEvidenceHash);
  assert.deepEqual(repeated.simulation.receipt, canary.simulation.receipt);
  assert.deepEqual(repeated.simulation.rollback, canary.simulation.rollback);
});

check("capture regression and stale capture both fail closed", () => {
  const observations = canary.simulation.review.boundary
    ? [
      "quote-capture",
      "held-capture",
      "manager-observer",
      "broker-reconciliation",
      "sentinel-evidence",
    ].map((path) => ({
      path: path as Parameters<typeof evaluateCaptureContinuity>[0]["observations"][number]["path"],
      state: path === "held-capture" ? "failed" as const : "observed" as const,
      observedAt: path === "quote-capture"
        ? "2026-07-28T22:00:00.000Z"
        : "2026-07-28T23:00:10.000Z",
      evidenceRef: `fixture:${path}`,
    }))
    : [];
  const result = evaluateCaptureContinuity({
    observations,
    evaluatedAt: "2026-07-28T23:00:20.000Z",
  });
  assert.equal(result.state, "block");
  assert.equal(result.blockers.includes("capture:failed:held-capture"), true);
  assert.equal(result.blockers.includes("capture:stale:quote-capture"), true);
});

check("missing lifecycle evidence fails closed", () => {
  const missingClose = canary.evidence.filter((stamp) => stamp.evidenceKind !== "close");
  const result = validateConfigurationEvidenceChain({
    stamps: missingClose,
    requiredKinds: canary.evidence.map((stamp) => stamp.evidenceKind),
  });
  assert.equal(result.state, "block");
  assert.equal(result.blockers.includes("configuration_evidence:missing_kind:close"), true);
});

check("mixed epochs and mixed position routes fail closed", () => {
  const first = canary.evidence[0];
  assert.ok(first);
  const mismatchedEpoch = stampConfigurationEvidence({
    evidenceKind: "order",
    evidenceId: "fixture:mismatched-epoch",
    traceId: first.traceId,
    observedAt: first.observedAt,
    configuration: {
      ...first.configuration,
      configurationEpochId: `sha256:${"0".repeat(64)}`,
    },
  });
  const otherPosition = stampConfigurationEvidence({
    evidenceKind: "close",
    evidenceId: "fixture:other-position",
    traceId: first.traceId,
    positionId: "position:other",
    observedAt: first.observedAt,
    configuration: first.configuration,
  });
  const result = validateConfigurationEvidenceChain({
    stamps: [...canary.evidence, mismatchedEpoch, otherPosition],
  });
  assert.equal(result.state, "block");
  assert.equal(result.blockers.some((blocker) => blocker.includes("epoch_disagreement")), true);
  assert.equal(result.blockers.includes("configuration_evidence:position_disagreement"), true);
  assert.equal(result.configuration, null);
});

check("position-scoped evidence cannot be stamped without immutable routing", () => {
  const configuration = canary.evidence[0]?.configuration;
  assert.ok(configuration);
  assert.throws(() => stampConfigurationEvidence({
    evidenceKind: "manager-observation",
    evidenceId: "fixture:missing-position",
    traceId: "trace:fixture",
    positionId: null,
    observedAt: "2026-07-28T23:00:20.000Z",
    configuration,
  }), /immutable position id/);
});

check("a missing or mismatched activation receipt blocks the new epoch", () => {
  const compiled = canary.simulation.candidate.compiled;
  const projection = canary.simulation.candidate.projection;
  const receipt = canary.simulation.receipt;
  assert.ok(compiled);
  assert.ok(projection);
  assert.ok(receipt);
  assert.throws(() => buildConfigurationEpochIdentity({
    compiled,
    projection,
    channelSlug: "orb-ustop-ctl",
    activationReceipt: null,
  }), /requires an immutable activation receipt/);
  assert.throws(() => buildConfigurationEpochIdentity({
    compiled,
    projection,
    channelSlug: "orb-ustop-ctl",
    activationReceipt: {
      ...receipt,
      configurationEpochId: `sha256:${"f".repeat(64)}`,
    },
  }), /disagrees with projection/);
});

check("generic workflow and proposal core contain no RC5.4 economics", () => {
  const workflow = readFileSync(new URL("./channelConfigurationWorkflow.ts", import.meta.url), "utf8");
  const proposal = readFileSync(new URL("./channelProposalWrite.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /RC5\.4|RC54|rc54/);
  assert.doesNotMatch(proposal, /RC5\.4|RC54|rc54|rc54ControlPlaneFixture/);
});

check("the current sealed manifest remains independently projectable", () => {
  const rollbackTarget = canary.simulation.rollback;
  assert.ok(rollbackTarget);
  assert.match(rollbackTarget.targetConfigurationEpochId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(buildShadowRuntimeProjection(
    canary.simulation.candidate.compiled!,
  ).orderAuthority, false);
});

console.log(`channel configuration workflow self-test passed (${checks} checks)`);
