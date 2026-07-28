import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRc54ControlPlaneBootstrap,
  reconstructRc54Bootstrap,
} from "../../lib/channels/rc54ControlPlaneBootstrap.js";
import {
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
} from "./rc54ReleasePolicy.js";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "./version.js";
import {
  observeRc54ControlPlaneBaseline,
  type Rc54ControlPlaneBaselineObservationInput,
} from "./rc54ControlPlaneBaselineObserver.js";

const bootstrap = buildRc54ControlPlaneBootstrap();
const compiled = reconstructRc54Bootstrap(bootstrap);
const startupReceipt = {
  releaseId: RC54_RELEASE_ID,
  workerVersion: RC54_WORKER_VERSION,
  releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
  fundMode: "paper",
  roots: compiled.channelSpecs.map((spec) => ({
    slug: spec.slug,
    accountId: spec.accountId,
    managerProfileId: spec.managerProfileId,
    quantity: spec.quantity,
  })),
  runtimeReadiness: {
    heldCaptureReady: true,
    heldCaptureStartedBeforeBootDecision: true,
    flatEraBoundaryProven: true,
  },
};
const baseline: Rc54ControlPlaneBaselineObservationInput = {
  manifest: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    manifestKey: bootstrap.manifest.manifestKey,
    releaseId: bootstrap.manifest.releaseId,
    contentHash: bootstrap.manifest.contentHash,
    legacyConfigurationHash: bootstrap.manifest.legacyConfigurationHash,
    workerCompatibilityVersion: bootstrap.manifest.workerCompatibilityVersion,
    status: "draft",
  },
  memberships: bootstrap.memberships.map((membership) => {
    const spec = bootstrap.specs.find((candidate) =>
      candidate.versionKey === membership.versionKey);
    assert.ok(spec);
    return {
      ordinal: membership.ordinal,
      versionKey: spec.versionKey,
      contentHash: spec.contentHash,
      status: "draft",
    };
  }),
  worker: {
    currentReleaseId: RC54_RELEASE_ID,
    currentWorkerVersion: RC54_WORKER_VERSION,
    currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
    bootId: "boot:fixture:rc54",
    paperMode: true,
    heldCaptureReady: true,
    startupReceipt,
    observedAt: "2026-07-28T12:00:10.000Z",
  },
};

const observe = (
  patch: Partial<Rc54ControlPlaneBaselineObservationInput> = {},
) => observeRc54ControlPlaneBaseline({ ...baseline, ...patch });

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("exact draft baseline produces a no-authority acknowledgement", () => {
  const result = observe();
  assert.equal(result.state, "acknowledged");
  assert.equal(result.manifestStatus, "draft");
  assert.equal(result.acknowledgement?.manifestId, bootstrap.manifest.manifestKey);
  assert.equal(result.acknowledgement?.manifestContentHash, bootstrap.manifest.contentHash);
  assert.equal(result.acknowledgement?.posture, "baseline-observed-no-order-authority");
  assert.equal(result.runtimeMutation, false);
  assert.equal(result.databaseWriteAuthority, false);
  assert.equal(result.orderAuthority, false);
  assert.equal(result.activationAuthorized, false);
});

check("exact adopted baseline remains comparable after lifecycle promotion", () => {
  const result = observe({
    manifest: { ...baseline.manifest!, status: "active" },
    memberships: baseline.memberships.map((membership) => ({
      ...membership,
      status: "active",
    })),
  });
  assert.equal(result.state, "acknowledged");
  assert.equal(result.manifestStatus, "active");
});

check("database read failure blocks without manufacturing an acknowledgement", () => {
  const result = observe({ readError: "timeout" });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("control_plane:read_failed"), true);
  assert.equal(result.acknowledgement, null);
});

check("missing or reordered membership blocks exact parity", () => {
  const missing = observe({ memberships: baseline.memberships.slice(1) });
  assert.equal(missing.state, "blocked");
  assert.equal(missing.blockers.includes("control_plane:membership_identity_mismatch"), true);

  const reorderedOrdinal = observe({
    memberships: baseline.memberships.map((membership, index) => index === 0
      ? { ...membership, ordinal: 99 }
      : membership),
  });
  assert.equal(reorderedOrdinal.state, "blocked");
});

check("manifest or channel hash drift blocks", () => {
  const manifestDrift = observe({
    manifest: {
      ...baseline.manifest!,
      contentHash: `sha256:${"0".repeat(64)}`,
    },
  });
  assert.equal(manifestDrift.blockers.includes("control_plane:manifest_hash_mismatch"), true);

  const channelDrift = observe({
    memberships: baseline.memberships.map((membership, index) => index === 0
      ? { ...membership, contentHash: `sha256:${"1".repeat(64)}` }
      : membership),
  });
  assert.equal(channelDrift.blockers.includes("control_plane:membership_identity_mismatch"), true);
});

check("mixed draft and active lifecycle state blocks", () => {
  const result = observe({
    memberships: baseline.memberships.map((membership, index) => index === 0
      ? { ...membership, status: "active" }
      : membership),
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("control_plane:spec_status_invalid"), true);
});

check("observer is still disconnected from the worker execution entrypoint", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /rc54ControlPlaneBaselineObserver/);
});

console.log(`rc54-control-plane-baseline-observer-selftest: ${checks}/${checks} passed`);
