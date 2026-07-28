import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BASELINE_ADOPTION_PACKET_IDENTITY,
  BaselineAdoptionInputError,
  buildBaselineAdoptionRpcArgs,
} from "./channelBaselineAdoption";
import {
  CHANNEL_ACTIVATION_PROTOCOL_VERSION,
  buildShadowRuntimeProjection,
} from "./channelActivation";
import { compileReleaseManifest } from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

const NOW = "2026-07-28T12:00:20.000Z";
const OPERATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const projection = buildShadowRuntimeProjection(compiled);
const accountIds = [...new Set(compiled.channelSpecs.map((spec) => spec.accountId))].sort();

const packet = {
  safeBoundaryProof: {
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    observedAt: "2026-07-28T12:00:10.000Z",
    accountInventoryEvidenceRef: "fixture:account-inventory",
    configuredPaperAccountIds: accountIds,
    brokerAccounts: accountIds.map((accountId) => ({
      accountId,
      openPositions: { state: "observed", count: 0, evidenceRef: `fixture:${accountId}:positions` },
      openOrders: { state: "observed", count: 0, evidenceRef: `fixture:${accountId}:orders` },
    })),
    deskOpenPositions: { state: "observed", count: 0, evidenceRef: "fixture:desk" },
    globalFlat: true,
  },
  workerAcknowledgement: {
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    manifestId: projection.manifestId,
    manifestContentHash: projection.manifestContentHash,
    configurationEpochId: projection.configurationEpochId,
    workerCompatibilityVersion: projection.workerCompatibilityVersion,
    workerReleaseId: compiled.manifest.releaseId,
    bootId: "boot:fixture",
    accountMode: "paper",
    posture: "baseline-observed-no-order-authority",
    acknowledgedAt: "2026-07-28T12:00:15.000Z",
    evidenceRef: "fixture:worker-ack",
  },
  startupReceipt: {
    workerVersion: compiled.manifest.workerCompatibilityVersion,
    releaseId: compiled.manifest.releaseId,
    releaseConfigurationSha256: compiled.manifest.legacyConfigurationHash,
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
  },
};

const build = (value: unknown = packet) => buildBaselineAdoptionRpcArgs({
  value,
  operatorId: OPERATOR,
  requestId: REQUEST,
  adoptedAt: NOW,
});

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("server derives exact immutable baseline identities", () => {
  const args = build();
  assert.equal(args.p_manifest_key, projection.manifestId);
  assert.equal(args.p_manifest_content_hash, projection.manifestContentHash);
  assert.equal(args.p_configuration_epoch_id, projection.configurationEpochId);
  assert.equal(args.p_operator_id, OPERATOR);
  assert.match(args.p_approval_evidence_ref, new RegExp(`${OPERATOR}.*${REQUEST}`));
  assert.deepEqual(args.p_validator_versions, [
    "channel-control-plane-compiler-v1",
    "channel-activation-protocol-v1",
  ]);
  assert.equal(BASELINE_ADOPTION_PACKET_IDENTITY.activationAuthorized, false);
});

check("unknown request fields fail closed", () => {
  assert.throws(() => build({ ...packet, activateRuntime: true }), BaselineAdoptionInputError);
});

check("safe boundary must be current and globally flat", () => {
  assert.throws(() => build({
    ...packet,
    safeBoundaryProof: {
      ...packet.safeBoundaryProof,
      observedAt: "2026-07-28T11:00:00.000Z",
      globalFlat: false,
    },
  }), BaselineAdoptionInputError);
});

check("every configured account requires zero broker positions and orders", () => {
  assert.throws(() => build({
    ...packet,
    safeBoundaryProof: {
      ...packet.safeBoundaryProof,
      brokerAccounts: packet.safeBoundaryProof.brokerAccounts.map((account, index) => index === 0
        ? { ...account, openOrders: { ...account.openOrders, count: 1 } }
        : account),
    },
  }), /not proven flat/);
});

check("worker acknowledgement must bind the exact manifest and epoch", () => {
  assert.throws(() => build({
    ...packet,
    workerAcknowledgement: {
      ...packet.workerAcknowledgement,
      manifestContentHash: `sha256:${"0".repeat(64)}`,
    },
  }), /does not match/);
});

check("worker acknowledgement must be fresh", () => {
  assert.throws(() => build({
    ...packet,
    workerAcknowledgement: {
      ...packet.workerAcknowledgement,
      acknowledgedAt: "2026-07-28T11:00:00.000Z",
    },
  }), /stale or future/);
});

check("startup receipt must preserve exact RC5.4 economics and roster", () => {
  assert.throws(() => build({
    ...packet,
    startupReceipt: {
      ...packet.startupReceipt,
      roots: packet.startupReceipt.roots.map((root, index) => index === 0
        ? { ...root, quantity: 8 }
        : root),
    },
  }), /root roster/);
});

check("server route is authenticated, service-role-only and authority-free", () => {
  const source = readFileSync(new URL(
    "../../app/api/channel-control-plane/adopt-baseline/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(source, /requireDeskOperator/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /adopt_channel_control_plane_baseline/);
  assert.match(source, /idempotency-key/);
  assert.match(source, /runtimeMutation: false/);
  assert.match(source, /orderAuthority: false/);
  assert.match(source, /activationAuthorized: false/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

console.log(`channel-baseline-adoption-request-selftest: ${checks}/${checks} passed`);
