import {
  buildWorkerActivationAcknowledgement,
  type ShadowActivationCandidate,
  type WorkerActivationAcknowledgement,
} from "../../lib/channels/channelActivation.js";
import {
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
} from "./rc54ReleasePolicy.js";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "./version.js";

export const CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE = "disabled-shadow" as const;

interface CurrentWorkerRootReceipt {
  slug: string;
  accountId: string;
  managerProfileId: string;
  quantity: number;
}

export interface ChannelActivationWorkerStageInput {
  candidate: Readonly<ShadowActivationCandidate>;
  currentReleaseId: string;
  currentWorkerVersion: string;
  currentWorkerRuntimeVersion: string;
  bootId: string;
  paperMode: boolean;
  heldCaptureReady: boolean;
  startupReceipt: Record<string, unknown> | null;
  observedAt: string;
  evidenceRef: string;
}

export interface ChannelActivationWorkerStageResult {
  adapterMode: typeof CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE;
  state: "acknowledged" | "blocked";
  blockers: readonly string[];
  acknowledgement: Readonly<WorkerActivationAcknowledgement> | null;
  runtimeMutation: false;
  databaseWriteAuthority: false;
  orderAuthority: false;
  activationAuthorized: false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function receiptRoots(value: unknown): CurrentWorkerRootReceipt[] | null {
  if (!Array.isArray(value)) return null;
  const roots: CurrentWorkerRootReceipt[] = [];
  for (const item of value) {
    const root = record(item);
    if (!root) return null;
    const quantity = number(root.quantity);
    if (!string(root.slug) || !string(root.accountId) || !string(root.managerProfileId)
        || quantity === null) return null;
    roots.push({
      slug: string(root.slug),
      accountId: string(root.accountId),
      managerProfileId: string(root.managerProfileId),
      quantity,
    });
  }
  return roots;
}

function canonicalRoster(roots: CurrentWorkerRootReceipt[]): string {
  return JSON.stringify([...roots]
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
      managerProfileId: root.managerProfileId,
      quantity: root.quantity,
    })));
}

/**
 * Converts an already-observed RC5.4 startup receipt into a staged worker
 * acknowledgement. This adapter is intentionally not imported by index.ts and
 * has no store, broker, environment, timer, or order dependency.
 */
export function stageChannelActivationShadow(
  input: ChannelActivationWorkerStageInput,
): Readonly<ChannelActivationWorkerStageResult> {
  const blockers: string[] = [];
  const projection = input.candidate.projection;
  const compiled = input.candidate.compiled;

  if (!projection || !compiled) blockers.push("candidate:not_compiled");
  else {
    if (projection.mode !== CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE) {
      blockers.push("candidate:not_disabled_shadow");
    }
    if (projection.activationAuthorized || projection.orderAuthority) {
      blockers.push("candidate:unexpected_authority");
    }
    if (!input.candidate.validationReady) blockers.push("candidate:not_validation_ready");
    if (projection.workerCompatibilityVersion !== input.currentWorkerVersion) {
      blockers.push("worker:compatibility_mismatch");
    }
    if (compiled.manifest.legacyConfigurationHash !== RC54_RELEASE_CONFIGURATION_SHA256) {
      blockers.push("worker:legacy_configuration_mismatch");
    }
  }

  if (input.currentReleaseId !== RC54_RELEASE_ID) blockers.push("worker:release_mismatch");
  if (input.currentWorkerVersion !== RC54_WORKER_VERSION) blockers.push("worker:sealed_version_mismatch");
  if (input.currentWorkerRuntimeVersion !== WORKER_RUNTIME_VERSION) {
    blockers.push("worker:runtime_version_mismatch");
  }
  if (!input.bootId.trim()) blockers.push("worker:boot_id_missing");
  if (!input.paperMode) blockers.push("worker:not_paper");
  if (!input.heldCaptureReady) blockers.push("worker:held_capture_not_ready");
  if (!Number.isFinite(Date.parse(input.observedAt))) blockers.push("worker:observed_at_invalid");
  if (!input.evidenceRef.trim()) blockers.push("worker:evidence_ref_missing");

  const receipt = input.startupReceipt;
  if (!receipt) {
    blockers.push("startup_receipt:missing");
  } else {
    if (string(receipt.releaseId) !== RC54_RELEASE_ID) blockers.push("startup_receipt:release_mismatch");
    if (string(receipt.workerVersion) !== RC54_WORKER_VERSION) {
      blockers.push("startup_receipt:worker_version_mismatch");
    }
    if (string(receipt.releaseConfigurationSha256) !== RC54_RELEASE_CONFIGURATION_SHA256) {
      blockers.push("startup_receipt:configuration_hash_mismatch");
    }
    if (string(receipt.fundMode).toLowerCase() !== "paper") blockers.push("startup_receipt:not_paper");

    const readiness = record(receipt.runtimeReadiness);
    if (!readiness || boolean(readiness.heldCaptureReady) !== true
        || boolean(readiness.heldCaptureStartedBeforeBootDecision) !== true) {
      blockers.push("startup_receipt:capture_readiness_missing");
    }

    const actualRoots = receiptRoots(receipt.roots);
    if (!actualRoots || !compiled || !input.candidate.activeSpec || !input.candidate.proposedSpec) {
      blockers.push("startup_receipt:root_roster_invalid");
    } else {
      const expectedRoots = compiled.channelSpecs.map((spec): CurrentWorkerRootReceipt => {
        const current = spec.id === input.candidate.proposedSpec?.id
          ? input.candidate.activeSpec as typeof spec
          : spec;
        return {
          slug: current.slug,
          accountId: current.accountId,
          managerProfileId: current.managerProfileId,
          quantity: current.quantity,
        };
      });
      if (canonicalRoster(actualRoots) !== canonicalRoster(expectedRoots)) {
        blockers.push("startup_receipt:root_roster_mismatch");
      }
    }
  }

  const acknowledgement = blockers.length || !projection
    ? null
    : buildWorkerActivationAcknowledgement({
      candidate: input.candidate,
      workerReleaseId: input.currentReleaseId,
      bootId: input.bootId,
      acknowledgedAt: input.observedAt,
      evidenceRef: input.evidenceRef,
    });

  return Object.freeze({
    adapterMode: CHANNEL_ACTIVATION_WORKER_ADAPTER_MODE,
    state: blockers.length ? "blocked" : "acknowledged",
    blockers: Object.freeze([...blockers]),
    acknowledgement,
    runtimeMutation: false,
    databaseWriteAuthority: false,
    orderAuthority: false,
    activationAuthorized: false,
  });
}
