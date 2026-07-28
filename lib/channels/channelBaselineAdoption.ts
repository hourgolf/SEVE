import {
  CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
  compileReleaseManifest,
  canonicalJson,
  type JsonObject,
} from "./channelControlPlane";
import {
  CHANNEL_ACTIVATION_PROTOCOL_VERSION,
  buildShadowRuntimeProjection,
} from "./channelActivation";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = ["safeBoundaryProof", "workerAcknowledgement", "startupReceipt"] as const;
const MAX_PACKET_BYTES = 128 * 1024;
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const projection = buildShadowRuntimeProjection(compiled);

export interface BaselineAdoptionRequest {
  safeBoundaryProof: JsonObject;
  workerAcknowledgement: JsonObject;
  startupReceipt: JsonObject;
}

export interface BaselineAdoptionRpcArgs {
  p_manifest_key: string;
  p_manifest_content_hash: string;
  p_configuration_epoch_id: string;
  p_operator_id: string;
  p_approval_evidence_ref: string;
  p_approved_at: string;
  p_adopted_at: string;
  p_safe_boundary_proof: JsonObject;
  p_worker_acknowledgement: JsonObject;
  p_startup_receipt: JsonObject;
  p_validator_versions: string[];
}

export class BaselineAdoptionInputError extends Error {
  readonly status: 400 | 409 | 422;

  constructor(message: string, status: 400 | 409 | 422 = 400) {
    super(message);
    this.name = "BaselineAdoptionInputError";
    this.status = status;
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BaselineAdoptionInputError(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timestamp(value: unknown, field: string): number {
  const parsed = Date.parse(string(value));
  if (!Number.isFinite(parsed)) throw new BaselineAdoptionInputError(`${field} is invalid`, 422);
  return parsed;
}

function assertFresh(value: unknown, nowMs: number, maxAgeMs: number, field: string): void {
  const observedMs = timestamp(value, field);
  if (observedMs > nowMs + 5_000 || nowMs - observedMs > maxAgeMs) {
    throw new BaselineAdoptionInputError(`${field} is stale or future`, 409);
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new BaselineAdoptionInputError(`${field} must contain exactly: ${expected.join(", ")}`);
  }
}

function parseSafeBoundary(value: unknown, nowMs: number): JsonObject {
  const proof = object(value, "safeBoundaryProof");
  if (proof.protocolVersion !== CHANNEL_ACTIVATION_PROTOCOL_VERSION || proof.globalFlat !== true) {
    throw new BaselineAdoptionInputError("safeBoundaryProof is not a passing activation-protocol proof", 422);
  }
  assertFresh(proof.observedAt, nowMs, 30_000, "safeBoundaryProof.observedAt");
  if (!string(proof.accountInventoryEvidenceRef).trim()) {
    throw new BaselineAdoptionInputError("safeBoundaryProof is missing account inventory evidence", 422);
  }
  if (!Array.isArray(proof.configuredPaperAccountIds)
      || !proof.configuredPaperAccountIds.length
      || proof.configuredPaperAccountIds.some((id) => typeof id !== "string" || !id.trim())
      || new Set(proof.configuredPaperAccountIds).size !== proof.configuredPaperAccountIds.length) {
    throw new BaselineAdoptionInputError("safeBoundaryProof configured accounts are invalid", 422);
  }
  if (!Array.isArray(proof.brokerAccounts)
      || proof.brokerAccounts.length !== proof.configuredPaperAccountIds.length) {
    throw new BaselineAdoptionInputError("safeBoundaryProof must include every configured broker account", 422);
  }
  const configured = [...proof.configuredPaperAccountIds].sort();
  const observed = proof.brokerAccounts.map((entry, index) => {
    const account = object(entry, `safeBoundaryProof.brokerAccounts[${index}]`);
    const positions = object(account.openPositions, `brokerAccounts[${index}].openPositions`);
    const orders = object(account.openOrders, `brokerAccounts[${index}].openOrders`);
    for (const [label, observation] of [["positions", positions], ["orders", orders]] as const) {
      if (observation.state !== "observed" || observation.count !== 0
          || !string(observation.evidenceRef).trim()) {
        throw new BaselineAdoptionInputError(
          `brokerAccounts[${index}].${label} is not proven flat`,
          422,
        );
      }
    }
    return string(account.accountId);
  }).sort();
  if (canonicalJson(configured) !== canonicalJson(observed)) {
    throw new BaselineAdoptionInputError("safeBoundaryProof broker accounts do not match inventory", 422);
  }
  const desk = object(proof.deskOpenPositions, "safeBoundaryProof.deskOpenPositions");
  if (desk.state !== "observed" || desk.count !== 0 || !string(desk.evidenceRef).trim()) {
    throw new BaselineAdoptionInputError("safeBoundaryProof desk ledger is not proven flat", 422);
  }
  return proof as JsonObject;
}

function parseWorkerAcknowledgement(value: unknown, nowMs: number): JsonObject {
  const acknowledgement = object(value, "workerAcknowledgement");
  if (acknowledgement.protocolVersion !== CHANNEL_ACTIVATION_PROTOCOL_VERSION
      || acknowledgement.manifestId !== projection.manifestId
      || acknowledgement.manifestContentHash !== projection.manifestContentHash
      || acknowledgement.configurationEpochId !== projection.configurationEpochId
      || acknowledgement.workerCompatibilityVersion !== projection.workerCompatibilityVersion
      || acknowledgement.workerReleaseId !== compiled.manifest.releaseId
      || acknowledgement.accountMode !== "paper"
      || acknowledgement.posture !== "baseline-observed-no-order-authority"
      || !string(acknowledgement.bootId).trim()
      || !string(acknowledgement.evidenceRef).trim()) {
    throw new BaselineAdoptionInputError("workerAcknowledgement does not match the baseline manifest", 422);
  }
  assertFresh(acknowledgement.acknowledgedAt, nowMs, 60_000, "workerAcknowledgement.acknowledgedAt");
  return acknowledgement as JsonObject;
}

function parseStartupReceipt(value: unknown): JsonObject {
  const receipt = object(value, "startupReceipt");
  if (receipt.releaseId !== compiled.manifest.releaseId
      || receipt.workerVersion !== compiled.manifest.workerCompatibilityVersion
      || receipt.releaseConfigurationSha256 !== compiled.manifest.legacyConfigurationHash
      || string(receipt.fundMode).toLowerCase() !== "paper") {
    throw new BaselineAdoptionInputError("startupReceipt does not match the current paper release", 422);
  }
  const readiness = object(receipt.runtimeReadiness, "startupReceipt.runtimeReadiness");
  if (readiness.heldCaptureReady !== true || readiness.heldCaptureStartedBeforeBootDecision !== true) {
    throw new BaselineAdoptionInputError("startupReceipt is not capture-ready", 422);
  }
  if (!Array.isArray(receipt.roots)) {
    throw new BaselineAdoptionInputError("startupReceipt roots are missing", 422);
  }
  const actual = receipt.roots.map((entry, index) => {
    const root = object(entry, `startupReceipt.roots[${index}]`);
    return {
      slug: string(root.slug),
      accountId: string(root.accountId),
      managerProfileId: string(root.managerProfileId),
      quantity: root.quantity,
    };
  }).sort((left, right) => left.slug.localeCompare(right.slug));
  const expected = compiled.channelSpecs.map((spec) => ({
    slug: spec.slug,
    accountId: spec.accountId,
    managerProfileId: spec.managerProfileId,
    quantity: spec.quantity,
  })).sort((left, right) => left.slug.localeCompare(right.slug));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new BaselineAdoptionInputError("startupReceipt root roster does not match the baseline", 422);
  }
  return receipt as JsonObject;
}

export function buildBaselineAdoptionRpcArgs(input: {
  value: unknown;
  operatorId: string;
  requestId: string;
  adoptedAt?: string;
}): BaselineAdoptionRpcArgs {
  if (!UUID.test(input.operatorId)) {
    throw new BaselineAdoptionInputError("authenticated operator identity is invalid", 409);
  }
  if (!UUID.test(input.requestId)) {
    throw new BaselineAdoptionInputError("Idempotency-Key must be a UUID");
  }
  const adoptedAt = input.adoptedAt ?? new Date().toISOString();
  const nowMs = timestamp(adoptedAt, "server adoption timestamp");
  const value = object(input.value, "request body");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PACKET_BYTES) {
    throw new BaselineAdoptionInputError(`request body exceeds ${MAX_PACKET_BYTES} bytes`);
  }
  exactKeys(value, REQUEST_KEYS, "request body");
  if (projection.state !== "comparable") {
    throw new BaselineAdoptionInputError("checked-in baseline projection is blocked", 409);
  }
  return {
    p_manifest_key: projection.manifestId,
    p_manifest_content_hash: projection.manifestContentHash,
    p_configuration_epoch_id: projection.configurationEpochId,
    p_operator_id: input.operatorId.toLowerCase(),
    p_approval_evidence_ref: `operator:${input.operatorId.toLowerCase()}:request:${input.requestId.toLowerCase()}`,
    p_approved_at: adoptedAt,
    p_adopted_at: adoptedAt,
    p_safe_boundary_proof: parseSafeBoundary(value.safeBoundaryProof, nowMs),
    p_worker_acknowledgement: parseWorkerAcknowledgement(value.workerAcknowledgement, nowMs),
    p_startup_receipt: parseStartupReceipt(value.startupReceipt),
    p_validator_versions: [
      CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
      CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    ],
  };
}

export const BASELINE_ADOPTION_PACKET_IDENTITY = Object.freeze({
  releaseId: compiled.manifest.releaseId,
  manifestId: projection.manifestId,
  manifestContentHash: projection.manifestContentHash,
  configurationEpochId: projection.configurationEpochId,
  workerCompatibilityVersion: projection.workerCompatibilityVersion,
  activationAuthorized: false as const,
});
