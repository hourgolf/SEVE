import {
  canonicalJson,
  compileReleaseManifest,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type JsonObject,
  type ReleaseManifestDraft,
  type ValidationGateResult,
} from "../../lib/channels/channelControlPlane.js";
import type { PortfolioCapacityEvaluation } from "../../lib/channels/channelPortfolioCapacity.js";
import type {
  ChannelRosterBundleDiff,
  ChannelRosterBundlePreview,
} from "../../lib/channels/channelRosterBundle.js";
import {
  buildShadowRuntimeProjection,
} from "../../lib/channels/channelActivation.js";
import {
  prepareRosterBundleAcknowledgementWrite,
} from "../../lib/channels/channelRosterBundleActivationPersistence.js";
import {
  stageRosterBundleShadow,
  type RosterBundleWorkerStageResult,
} from "./channelActivationShadowAdapter.js";

export const CHANNEL_ROSTER_BUNDLE_WATCHER_VERSION =
  "channel-roster-bundle-watcher-v1" as const;

export interface StoredChannelRosterBundleEnvelope {
  bundle: Record<string, unknown>;
}

export interface StagedStoredChannelRosterBundle {
  version: typeof CHANNEL_ROSTER_BUNDLE_WATCHER_VERSION;
  state: "acknowledged" | "blocked";
  blockers: string[];
  bundleId: string;
  preview: ChannelRosterBundlePreview | null;
  workerStage: Readonly<RosterBundleWorkerStageResult> | null;
  acknowledgementRpcArgs: ReturnType<
    typeof prepareRosterBundleAcknowledgementWrite
  >["args"] | null;
  runtimeMutation: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function draftSpec(value: unknown): ChannelSpecVersionDraft | null {
  const row = record(value);
  if (!row) return null;
  const { contentHash: _contentHash, ...draft } = row;
  return draft as unknown as ChannelSpecVersionDraft;
}

function compileStoredCandidate(
  bundle: Record<string, unknown>,
): CompiledReleaseManifest | null {
  const manifest = record(bundle.candidate_manifest);
  const specs = Array.isArray(bundle.candidate_specs)
    ? bundle.candidate_specs.map(draftSpec)
    : [];
  const storedResults = Array.isArray(bundle.validation_results)
    ? bundle.validation_results
    : [];
  if (!manifest || !specs.length || specs.some((spec) => !spec)
      || !storedResults.length
      || storedResults.some((value) => {
        const result = record(value);
        return !result || result.state !== "pass"
          || typeof result.gate !== "string"
          || typeof result.code !== "string"
          || typeof result.fact !== "string"
          || !Array.isArray(result.evidenceRefs)
          || result.evidenceRefs.some((ref) => typeof ref !== "string");
      })) return null;
  try {
    const compiled = compileReleaseManifest({
      schemaVersion: 1,
      id: string(manifest, "id"),
      releaseId: string(manifest, "releaseId"),
      cohortId: string(manifest, "cohortId"),
      workerCompatibilityVersion: string(
        manifest,
        "workerCompatibilityVersion",
      ),
      legacyConfigurationHash: string(manifest, "legacyConfigurationHash"),
      paperLiveAuthority: String(manifest.paperLiveAuthority) as "paper-only",
      admissionPolicyVersion: string(manifest, "admissionPolicyVersion"),
      collisionPolicyVersion: string(manifest, "collisionPolicyVersion"),
      activationBoundary: String(
        manifest.activationBoundary,
      ) as "next-safe-entry",
      rollbackTargetManifestId: string(
        manifest,
        "rollbackTargetManifestId",
      ),
      channelSpecs: specs as ChannelSpecVersionDraft[],
      admissionPolicies: manifest.admissionPolicies as ReleaseManifestDraft["admissionPolicies"],
      createdBy: string(manifest, "createdBy"),
      createdAt: string(manifest, "createdAt"),
      parentManifestId: typeof manifest.parentManifestId === "string"
        ? manifest.parentManifestId
        : null,
      status: String(manifest.status) as "draft",
    }, {
      replaySufficiency: {
        ok: true,
        fact: "Stored atomic roster bundle protocol validation.",
        evidenceRefs: [],
      },
      evidenceReadiness: {
        ok: true,
        fact: "Stored atomic roster bundle evidence validation.",
        evidenceRefs: [],
      },
      safeBoundary: {
        ok: true,
        fact: "Stored preview boundary; activation requires a fresh recheck.",
        evidenceRefs: [],
      },
    });
    return Object.freeze({
      ...compiled,
      validationResults: structuredClone(
        storedResults,
      ) as ValidationGateResult[],
      validationReady: true,
    });
  } catch {
    return null;
  }
}

function storedPreview(input: {
  active: CompiledReleaseManifest;
  bundle: Record<string, unknown>;
}): { preview: ChannelRosterBundlePreview | null; blockers: string[] } {
  const blockers: string[] = [];
  const bundle = input.bundle;
  const id = string(bundle, "id");
  const baseManifestId = string(bundle, "base_manifest_key");
  const baseManifestContentHash = string(bundle, "base_manifest_content_hash");
  const configurationEpochId = string(bundle, "configuration_epoch_id");
  const candidate = compileStoredCandidate(bundle);
  const storedManifest = record(bundle.candidate_manifest);
  const storedWorker = record(bundle.worker_projection);
  const storedDashboard = record(bundle.dashboard_projection);
  const capacity = record(bundle.capacity_evaluation) as unknown as PortfolioCapacityEvaluation | null;
  const diffs = Array.isArray(bundle.exact_diffs)
    ? bundle.exact_diffs as unknown as ChannelRosterBundleDiff[]
    : [];
  const evidenceRefs = Array.isArray(bundle.evidence_refs)
    && bundle.evidence_refs.every((ref) => typeof ref === "string")
    ? bundle.evidence_refs as string[]
    : [];
  if (!UUID.test(id)) blockers.push("bundle:id_invalid");
  if (!["draft", "validated"].includes(string(bundle, "state"))) {
    blockers.push("bundle:lifecycle_not_stageable");
  }
  if (baseManifestId !== input.active.manifest.id
      || baseManifestContentHash !== input.active.manifest.contentHash) {
    blockers.push("bundle:base_manifest_drift");
  }
  if (!candidate || !storedManifest || !storedWorker || !storedDashboard) {
    blockers.push("bundle:candidate_invalid");
  } else {
    if (canonicalJson(candidate.manifest) !== canonicalJson(storedManifest)) {
      blockers.push("bundle:manifest_drift");
    }
    if (canonicalJson(candidate.workerProjection) !== canonicalJson(storedWorker)) {
      blockers.push("bundle:worker_projection_drift");
    }
    if (canonicalJson(candidate.dashboardProjection)
        !== canonicalJson(storedDashboard)) {
      blockers.push("bundle:dashboard_projection_drift");
    }
    if (canonicalJson(candidate.validationResults)
        !== canonicalJson(bundle.validation_results)) {
      blockers.push("bundle:validation_drift");
    }
    const storedSpecs = bundle.candidate_specs as unknown[];
    if (canonicalJson(candidate.channelSpecs)
        !== canonicalJson(storedSpecs as ChannelSpecVersion[])) {
      blockers.push("bundle:spec_roster_drift");
    }
    const expectedEpoch = buildShadowRuntimeProjection(
      candidate,
    ).configurationEpochId;
    if (!SHA256.test(configurationEpochId)
        || expectedEpoch !== configurationEpochId) {
      blockers.push("bundle:configuration_epoch_drift");
    }
  }
  if (!capacity || capacity.state !== "pass"
      || capacity.executionAuthority !== false
      || capacity.runtimeMutationAuthorized !== false
      || capacity.orderAuthority !== false) {
    blockers.push("bundle:capacity_invalid");
  }
  if (!diffs.length || !evidenceRefs.length) {
    blockers.push("bundle:diff_or_evidence_missing");
  }
  if (blockers.length || !candidate || !capacity) {
    return { preview: null, blockers: [...new Set(blockers)].sort() };
  }
  return {
    preview: Object.freeze({
      version: "channel-roster-bundle-v1",
      id,
      state: "ready-for-worker-ack",
      activeManifestId: baseManifestId,
      activeManifestContentHash: baseManifestContentHash,
      candidate,
      configurationEpochId,
      diffs,
      capacity,
      blockers: [],
      evidenceRefs,
      rollbackTargetManifestId: baseManifestId,
      historicalEvidenceMutation: false,
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    }),
    blockers: [],
  };
}

export function stageStoredChannelRosterBundle(input: {
  active: CompiledReleaseManifest;
  envelope: StoredChannelRosterBundleEnvelope;
  acknowledgementId: string;
  validatedLifecycleReceiptId: string;
  currentReleaseId: string;
  currentWorkerVersion: string;
  currentWorkerRuntimeVersion: string;
  bootId: string;
  paperMode: boolean;
  heldCaptureReady: boolean;
  startupReceipt: Record<string, unknown> | null;
  observedAt: string;
}): Readonly<StagedStoredChannelRosterBundle> {
  const rebuilt = storedPreview({
    active: input.active,
    bundle: input.envelope.bundle,
  });
  const blockers = [...rebuilt.blockers];
  if (!UUID.test(input.acknowledgementId)) blockers.push("acknowledgement:id_invalid");
  if (!UUID.test(input.validatedLifecycleReceiptId)) {
    blockers.push("acknowledgement:lifecycle_id_invalid");
  }
  const bundleId = string(input.envelope.bundle, "id");
  const evidenceRef =
    `worker:${input.bootId}:roster-bundle:${bundleId}:${input.observedAt}`;
  const workerStage = !blockers.length && rebuilt.preview
    ? stageRosterBundleShadow({
      preview: rebuilt.preview,
      acknowledgementId: input.acknowledgementId,
      current: input.active,
      currentReleaseId: input.currentReleaseId,
      currentWorkerVersion: input.currentWorkerVersion,
      currentWorkerRuntimeVersion: input.currentWorkerRuntimeVersion,
      bootId: input.bootId,
      paperMode: input.paperMode,
      heldCaptureReady: input.heldCaptureReady,
      startupReceipt: input.startupReceipt,
      observedAt: input.observedAt,
      evidenceRef,
    })
    : null;
  blockers.push(...workerStage?.blockers ?? []);
  let acknowledgementRpcArgs: StagedStoredChannelRosterBundle[
    "acknowledgementRpcArgs"
  ] = null;
  if (!blockers.length && workerStage?.acknowledgement) {
    acknowledgementRpcArgs = prepareRosterBundleAcknowledgementWrite({
      acknowledgement: workerStage.acknowledgement,
      validatedLifecycleReceiptId: input.validatedLifecycleReceiptId,
    }).args;
  }
  return Object.freeze({
    version: CHANNEL_ROSTER_BUNDLE_WATCHER_VERSION,
    state: blockers.length || !acknowledgementRpcArgs
      ? "blocked"
      : "acknowledged",
    blockers: [...new Set(blockers)].sort(),
    bundleId,
    preview: rebuilt.preview,
    workerStage,
    acknowledgementRpcArgs,
    runtimeMutation: false,
    orderAuthority: false,
  });
}
