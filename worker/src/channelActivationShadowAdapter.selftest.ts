import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  compileReleaseManifest,
  type ChannelChangeProposal,
  type DynamicReadinessEvidence,
} from "../../lib/channels/channelControlPlane.js";
import {
  buildShadowActivationCandidate,
} from "../../lib/channels/channelActivation.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "../../lib/channels/rc54ControlPlaneFixture.js";
import {
  CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE,
  stageControlPlaneBaselineShadow,
  stageChannelActivationShadow,
  type ChannelActivationWorkerStageInput,
} from "./channelActivationShadowAdapter.js";
import {
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
  RC54_ROOTS,
} from "./rc54ReleasePolicy.js";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "./version.js";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const orb = active.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
assert.ok(orb);

const proposal: ChannelChangeProposal = {
  schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  id: "proposal:fixture:worker-stage",
  baseSpecVersionId: orb.id,
  baseSpecContentHash: orb.contentHash,
  proposedSpecVersionId: "spec:fixture:worker-stage",
  proposedPatch: {
    takeProfit: { kind: "bank", targetPct: 35, fraction: 0.5 },
  },
  reason: "Worker staging fixture only.",
  evidenceRefs: ["fixture:proposal"],
  authorKind: "operator",
  authorId: "fixture",
  changeClass: "bounded-parameter",
  validationResults: [],
  replaySummary: {
    state: "sufficient",
    exactSamples: 10,
    censoredSamples: 0,
    limitations: [],
    evidenceRefs: ["fixture:replay"],
  },
  approvalState: "approved",
  requestedActivationBoundary: "next-safe-entry",
  createdAt: "2026-07-28T12:00:00.000Z",
  activationAuthorized: false,
};

const readiness: DynamicReadinessEvidence = {
  replaySufficiency: {
    ok: true,
    fact: "Fixture replay passed.",
    evidenceRefs: ["fixture:replay"],
  },
  evidenceReadiness: {
    ok: true,
    fact: "Fixture capture paths passed.",
    evidenceRefs: ["fixture:capture"],
  },
  safeBoundary: {
    ok: true,
    fact: "Fixture safe-boundary observer passed.",
    evidenceRefs: ["fixture:boundary"],
  },
};

const candidate = buildShadowActivationCandidate({ active, proposal, readiness });
assert.ok(candidate.compiled);
assert.ok(candidate.projection);

const startupReceipt: Record<string, unknown> = {
  schemaVersion: 1,
  workerVersion: RC54_WORKER_VERSION,
  releaseId: RC54_RELEASE_ID,
  releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
  expectedConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
  fundMode: "paper",
  roots: RC54_ROOTS.map((root) => ({
    slug: root.slug,
    accountId: root.accountId,
    managerProfileId: root.managerProfileId,
    quantity: root.quantity,
  })),
  runtimeReadiness: {
    heldCaptureReady: true,
    heldCaptureStartedBeforeBootDecision: true,
    flatEraBoundaryProven: true,
  },
};

const baseline: ChannelActivationWorkerStageInput = {
  candidate,
  currentReleaseId: RC54_RELEASE_ID,
  currentWorkerVersion: RC54_WORKER_VERSION,
  currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
  bootId: "boot:fixture:rc54",
  paperMode: true,
  heldCaptureReady: true,
  startupReceipt,
  observedAt: "2026-07-28T12:00:10.000Z",
  evidenceRef: "worker:startup-receipt:fixture",
};

const stage = (
  patch: Partial<ChannelActivationWorkerStageInput> = {},
) => stageChannelActivationShadow({ ...baseline, ...patch });

const stageBaseline = (
  patch: Partial<Parameters<typeof stageControlPlaneBaselineShadow>[0]> = {},
) => stageControlPlaneBaselineShadow({
  compiled: active,
  currentReleaseId: RC54_RELEASE_ID,
  currentWorkerVersion: RC54_WORKER_VERSION,
  currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
  bootId: "boot:fixture:rc54",
  paperMode: true,
  heldCaptureReady: true,
  startupReceipt,
  observedAt: "2026-07-28T12:00:10.000Z",
  evidenceRef: "worker:baseline:fixture",
  ...patch,
});

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("exact current RC5.4 receipt stages the candidate in disabled shadow", () => {
  const result = stage();
  assert.equal(result.state, "acknowledged");
  assert.equal(result.adapterMode, CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.acknowledgement?.manifestId, candidate.projection?.manifestId);
  assert.equal(result.acknowledgement?.manifestContentHash, candidate.projection?.manifestContentHash);
  assert.equal(result.acknowledgement?.configurationEpochId, candidate.projection?.configurationEpochId);
  assert.equal(result.acknowledgement?.workerCompatibilityVersion, RC54_WORKER_VERSION);
});

check("exact current RC5.4 receipt acknowledges the no-change baseline manifest", () => {
  const result = stageBaseline();
  assert.equal(result.state, "acknowledged");
  assert.equal(result.acknowledgement?.manifestId, active.manifest.id);
  assert.equal(result.acknowledgement?.manifestContentHash, active.manifest.contentHash);
  assert.equal(result.acknowledgement?.configurationEpochId, result.projection.configurationEpochId);
  assert.equal(result.acknowledgement?.workerRuntimeVersion, WORKER_RUNTIME_VERSION);
  assert.equal(result.acknowledgement?.posture, "baseline-observed-no-order-authority");
  assert.equal(result.activationAuthorized, false);
});

check("baseline acknowledgement fails on startup roster drift", () => {
  const roots = startupReceipt.roots as Array<Record<string, unknown>>;
  const result = stageBaseline({
    startupReceipt: {
      ...startupReceipt,
      roots: roots.map((root, index) => index === 0 ? { ...root, accountId: "wrong-account" } : root),
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("startup_receipt:root_roster_mismatch"), true);
  assert.equal(result.acknowledgement, null);
});

check("adapter never acquires runtime, database, order, or activation authority", () => {
  const result = stage();
  assert.equal(result.runtimeMutation, false);
  assert.equal(result.databaseWriteAuthority, false);
  assert.equal(result.orderAuthority, false);
  assert.equal(result.activationAuthorized, false);
  assert.equal(result.acknowledgement?.posture, "staged-no-order-authority");
});

check("candidate without complete validation cannot be acknowledged", () => {
  const unready = buildShadowActivationCandidate({
    active,
    proposal,
    readiness: {
      evidenceReadiness: readiness.evidenceReadiness,
      safeBoundary: readiness.safeBoundary,
    },
  });
  const result = stage({ candidate: unready });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("candidate:not_validation_ready"), true);
  assert.equal(result.acknowledgement, null);
});

check("wrong active release fails closed", () => {
  const result = stage({ currentReleaseId: "week2-other" });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("worker:release_mismatch"), true);
});

check("wrong sealed worker version fails closed", () => {
  const result = stage({ currentWorkerVersion: "stream-other" });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("worker:compatibility_mismatch"), true);
  assert.equal(result.blockers.includes("worker:sealed_version_mismatch"), true);
});

check("wrong runtime implementation version fails closed", () => {
  const result = stage({ currentWorkerRuntimeVersion: "runtime-other" });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("worker:runtime_version_mismatch"), true);
});

check("non-paper or capture-degraded worker fails closed", () => {
  const result = stage({ paperMode: false, heldCaptureReady: false });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("worker:not_paper"), true);
  assert.equal(result.blockers.includes("worker:held_capture_not_ready"), true);
});

check("missing startup receipt fails closed", () => {
  const result = stage({ startupReceipt: null });
  assert.equal(result.state, "blocked");
  assert.deepEqual(result.blockers, ["startup_receipt:missing"]);
});

check("startup receipt must carry the exact RC5.4 release and configuration hash", () => {
  const result = stage({
    startupReceipt: {
      ...startupReceipt,
      releaseId: "week2-other",
      releaseConfigurationSha256: "0".repeat(64),
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("startup_receipt:release_mismatch"), true);
  assert.equal(result.blockers.includes("startup_receipt:configuration_hash_mismatch"), true);
});

check("startup receipt must prove capture was ready before boot decision", () => {
  const result = stage({
    startupReceipt: {
      ...startupReceipt,
      runtimeReadiness: {
        heldCaptureReady: true,
        heldCaptureStartedBeforeBootDecision: false,
      },
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("startup_receipt:capture_readiness_missing"), true);
});

check("startup receipt root roster must match the pre-change active manifest", () => {
  const roots = startupReceipt.roots as Array<Record<string, unknown>>;
  const result = stage({
    startupReceipt: {
      ...startupReceipt,
      roots: roots.map((root, index) => index === 0 ? { ...root, quantity: 99 } : root),
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("startup_receipt:root_roster_mismatch"), true);
});

check("adapter remains disconnected from the worker entrypoint", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /channelActivationShadowAdapter/);
});

console.log(
  `channel-activation-shadow-adapter-selftest: ${checks}/${checks} passed · ${candidate.projection.configurationEpochId}`,
);
