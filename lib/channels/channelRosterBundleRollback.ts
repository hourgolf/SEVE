import {
  canonicalJson,
  compileReleaseManifest,
  contentHash,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type JsonObject,
} from "./channelControlPlane";
import {
  evaluatePortfolioCapacity,
  type LivePortfolioTruth,
  type PortfolioCapacityEnvelope,
} from "./channelPortfolioCapacity";
import { buildShadowRuntimeProjection } from "./channelActivation";
import type {
  ChannelRosterBundleDiff,
  ChannelRosterBundlePreview,
} from "./channelRosterBundle";
import type { ResearchChannelRegistry } from "./researchChannelRegistry";

export const CHANNEL_ROSTER_BUNDLE_ROLLBACK_VERSION =
  "channel-roster-bundle-rollback-v1" as const;

export interface ExactRosterRollbackDraft {
  id: string;
  rollbackOfActivationReceiptId: string;
  activeManifestId: string;
  activeManifestContentHash: string;
  exactTargetManifestId: string;
  exactTargetManifestContentHash: string;
  reason: string;
  evidenceRefs: string[];
  operatorId: string;
  createdAt: string;
}

export interface ExactRosterRollbackPreview {
  version: typeof CHANNEL_ROSTER_BUNDLE_ROLLBACK_VERSION;
  state: "ready-for-worker-ack" | "blocked";
  bundlePreview: ChannelRosterBundlePreview | null;
  rollbackOfActivationReceiptId: string;
  exactTargetManifestId: string;
  exactTargetManifestContentHash: string;
  blockers: string[];
  historicalEvidenceMutation: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ExactRosterRollbackDraftWrite {
  rpc: "create_channel_roster_rollback_draft";
  args: {
    p_bundle_id: string;
    p_initial_receipt_id: string;
    p_rollback_activation_receipt_id: string;
    p_base_manifest_key: string;
    p_base_manifest_content_hash: string;
    p_target_manifest_key: string;
    p_target_manifest_content_hash: string;
    p_registry_content_hash: string;
    p_registry_entries: JsonObject[];
    p_changes: JsonObject[];
    p_candidate_manifest: JsonObject;
    p_candidate_specs: JsonObject[];
    p_worker_projection: JsonObject;
    p_dashboard_projection: JsonObject;
    p_exact_diffs: JsonObject[];
    p_validation_results: JsonObject[];
    p_capacity_evaluation: JsonObject;
    p_configuration_epoch_id: string;
    p_reason: string;
    p_evidence_refs: string[];
    p_operator_id: string;
    p_created_at: string;
  };
  idempotencyHash: string;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort();
}

function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}

function restoredSpec(input: {
  target: ChannelSpecVersion;
  current: ChannelSpecVersion | null;
  draft: ExactRosterRollbackDraft;
}): ChannelSpecVersionDraft {
  return {
    ...withoutHash(input.target),
    id: `spec:rollback:${input.draft.id}:${input.target.slug}`,
    parentVersionId: input.current?.id ?? input.target.id,
    validFrom: input.draft.createdAt,
    validUntil: null,
    createdBy: `operator:${input.draft.operatorId}`,
    createdAt: input.draft.createdAt,
    status: "draft",
  };
}

export function buildExactRosterRollbackPreview(input: {
  active: CompiledReleaseManifest;
  target: CompiledReleaseManifest;
  draft: ExactRosterRollbackDraft;
  envelope: PortfolioCapacityEnvelope;
  live: LivePortfolioTruth;
  collectionStates: ReadonlyMap<string, "active" | "paused" | "archived">;
}): ExactRosterRollbackPreview {
  const blockers: string[] = [];
  const refs = unique(input.draft.evidenceRefs);
  if (![input.draft.id, input.draft.rollbackOfActivationReceiptId,
    input.draft.operatorId].every((value) => UUID.test(value))) {
    blockers.push("rollback:identity_invalid");
  }
  if (!Number.isFinite(Date.parse(input.draft.createdAt))) {
    blockers.push("rollback:created_at_invalid");
  }
  if (input.draft.reason.trim().length < 8 || !refs.length) {
    blockers.push("rollback:evidence_invalid");
  }
  if (input.draft.activeManifestId !== input.active.manifest.id
      || input.draft.activeManifestContentHash
        !== input.active.manifest.contentHash) {
    blockers.push("rollback:active_manifest_drift");
  }
  if (input.draft.exactTargetManifestId !== input.target.manifest.id
      || input.draft.exactTargetManifestContentHash
        !== input.target.manifest.contentHash) {
    blockers.push("rollback:target_manifest_drift");
  }
  if (input.active.manifest.paperLiveAuthority !== "paper-only"
      || input.target.manifest.paperLiveAuthority !== "paper-only"
      || input.active.manifest.workerCompatibilityVersion
        !== input.target.manifest.workerCompatibilityVersion) {
    blockers.push("rollback:paper_or_worker_incompatible");
  }
  if (blockers.length) return Object.freeze({
    version: CHANNEL_ROSTER_BUNDLE_ROLLBACK_VERSION,
    state: "blocked",
    bundlePreview: null,
    rollbackOfActivationReceiptId: input.draft.rollbackOfActivationReceiptId,
    exactTargetManifestId: input.draft.exactTargetManifestId,
    exactTargetManifestContentHash:
      input.draft.exactTargetManifestContentHash,
    blockers: unique(blockers),
    historicalEvidenceMutation: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
  const currentBySlug = new Map(input.active.channelSpecs.map((spec) =>
    [spec.slug, spec]));
  const targetBySlug = new Map(input.target.channelSpecs.map((spec) =>
    [spec.slug, spec]));
  const diffs: ChannelRosterBundleDiff[] = [];
  for (const slug of unique([
    ...currentBySlug.keys(),
    ...targetBySlug.keys(),
  ])) {
    const current = currentBySlug.get(slug);
    const target = targetBySlug.get(slug);
    if (!target && current) {
      diffs.push({
        slug,
        source: "active-manifest",
        fields: [{ field: "membership", before: "included", after: "excluded" }],
      });
    } else if (target && !current) {
      diffs.push({
        slug,
        source: "active-manifest",
        fields: [{ field: "membership", before: "excluded", after: "included" }],
      });
    } else if (target && current && target.contentHash !== current.contentHash) {
      diffs.push({
        slug,
        source: "active-manifest",
        fields: [{
          field: "semanticContentHash",
          before: current.contentHash,
          after: target.contentHash,
        }],
      });
    }
  }
  if (!diffs.length) blockers.push("rollback:already_exact_target");
  const specs = input.target.channelSpecs.map((target) => {
    const current = currentBySlug.get(target.slug) ?? null;
    return current?.contentHash === target.contentHash
      ? withoutHash(current)
      : restoredSpec({ target, current, draft: input.draft });
  });
  for (const spec of specs) {
    if ((spec.executionPosture ?? "paper") === "paper"
        && input.collectionStates.get(spec.channelId) !== "active") {
      blockers.push(`rollback:paper_collection_not_active:${spec.slug}`);
    }
  }
  const flat = input.live.complete && input.live.openOrders === 0
    && input.live.positions.length === 0;
  const protocolRef = contentHash({
    version: CHANNEL_ROSTER_BUNDLE_ROLLBACK_VERSION,
    rollbackOfActivationReceiptId: input.draft.rollbackOfActivationReceiptId,
    activeManifestContentHash: input.active.manifest.contentHash,
    targetManifestContentHash: input.target.manifest.contentHash,
  });
  const candidate = compileReleaseManifest({
    ...input.target.manifest,
    id: `manifest:rollback:${input.draft.id}`,
    releaseId: `release:rollback:${input.draft.id}`,
    cohortId: `operator-rollback:${input.draft.id}`,
    rollbackTargetManifestId: input.active.manifest.id,
    parentManifestId: input.active.manifest.id,
    channelSpecs: specs,
    createdBy: `operator:${input.draft.operatorId}`,
    createdAt: input.draft.createdAt,
    status: "draft",
  }, {
    replaySufficiency: {
      ok: true,
      fact: "Exact immutable prior-manifest semantics were reconstructed.",
      evidenceRefs: [protocolRef],
    },
    evidenceReadiness: {
      ok: refs.length > 0,
      fact: "The operator supplied rollback evidence and a reason.",
      evidenceRefs: refs,
    },
    safeBoundary: {
      ok: flat,
      fact: flat
        ? "The paper broker, order, and desk boundary is complete and flat."
        : "Exact rollback requires a complete flat paper boundary.",
      evidenceRefs: flat ? [`portfolio-flat:${input.live.observedAt}`] : [],
    },
  });
  const capacity = evaluatePortfolioCapacity({
    specs: candidate.channelSpecs,
    admissionPolicies: candidate.manifest.admissionPolicies,
    envelope: input.envelope,
    live: input.live,
  });
  blockers.push(...candidate.validationResults
    .filter((result) => result.state !== "pass")
    .map((result) => `rollback:validation:${result.code}`));
  blockers.push(...capacity.blockers);
  const configurationEpochId = buildShadowRuntimeProjection(
    candidate,
  ).configurationEpochId;
  const bundlePreview: ChannelRosterBundlePreview = Object.freeze({
    version: "channel-roster-bundle-v1",
    id: input.draft.id,
    state: blockers.length ? "blocked" : "ready-for-worker-ack",
    activeManifestId: input.active.manifest.id,
    activeManifestContentHash: input.active.manifest.contentHash,
    candidate,
    configurationEpochId,
    diffs,
    capacity,
    blockers: unique(blockers),
    evidenceRefs: unique([...refs, protocolRef]),
    rollbackTargetManifestId: input.active.manifest.id,
    historicalEvidenceMutation: false,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
  return Object.freeze({
    version: CHANNEL_ROSTER_BUNDLE_ROLLBACK_VERSION,
    state: blockers.length ? "blocked" : "ready-for-worker-ack",
    bundlePreview,
    rollbackOfActivationReceiptId: input.draft.rollbackOfActivationReceiptId,
    exactTargetManifestId: input.draft.exactTargetManifestId,
    exactTargetManifestContentHash: input.draft.exactTargetManifestContentHash,
    blockers: unique(blockers),
    historicalEvidenceMutation: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function rollbackRestoresExactSemantics(input: {
  preview: ExactRosterRollbackPreview;
  target: CompiledReleaseManifest;
}): boolean {
  const candidate = input.preview.bundlePreview?.candidate;
  if (!candidate) return false;
  const semantic = (compiled: CompiledReleaseManifest) => compiled.channelSpecs
    .map((spec) => ({ slug: spec.slug, contentHash: spec.contentHash }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return canonicalJson(semantic(candidate)) === canonicalJson(semantic(input.target))
    && canonicalJson(candidate.manifest.admissionPolicies)
      === canonicalJson(input.target.manifest.admissionPolicies);
}

export function prepareExactRosterRollbackDraftWrite(input: {
  draft: ExactRosterRollbackDraft;
  preview: ExactRosterRollbackPreview;
  registry: ResearchChannelRegistry;
  initialReceiptId: string;
}): ExactRosterRollbackDraftWrite {
  const bundle = input.preview.bundlePreview;
  const candidate = bundle?.candidate;
  if (input.preview.state !== "ready-for-worker-ack" || !bundle || !candidate
      || !bundle.capacity || !bundle.configurationEpochId
      || bundle.capacity.state !== "pass"
      || !candidate.validationReady
      || input.preview.historicalEvidenceMutation !== false
      || input.preview.runtimeMutationAuthorized !== false
      || input.preview.orderAuthority !== false) {
    throw new Error("only a fully passing exact rollback can be persisted");
  }
  if (![input.draft.id, input.draft.rollbackOfActivationReceiptId,
    input.draft.operatorId, input.initialReceiptId]
    .every((value) => UUID.test(value))) {
    throw new Error("rollback persistence identities must be UUIDs");
  }
  if (bundle?.activeManifestId !== input.draft.activeManifestId
      || bundle.activeManifestContentHash
        !== input.draft.activeManifestContentHash
      || input.preview.exactTargetManifestId
        !== input.draft.exactTargetManifestId
      || input.preview.exactTargetManifestContentHash
        !== input.draft.exactTargetManifestContentHash
      || !bundle.capacity || !bundle.configurationEpochId || !candidate) {
    throw new Error("rollback persistence identity drifted");
  }
  const registryEntries = input.registry.entries.map((entry) => ({
    registrationKey: entry.id,
    channelId: entry.channelId,
    slug: entry.slug,
    state: entry.state,
    contentHash: entry.contentHash,
  }));
  const args: ExactRosterRollbackDraftWrite["args"] = {
    p_bundle_id: input.draft.id.toLowerCase(),
    p_initial_receipt_id: input.initialReceiptId.toLowerCase(),
    p_rollback_activation_receipt_id:
      input.draft.rollbackOfActivationReceiptId.toLowerCase(),
    p_base_manifest_key: input.draft.activeManifestId,
    p_base_manifest_content_hash: input.draft.activeManifestContentHash,
    p_target_manifest_key: input.draft.exactTargetManifestId,
    p_target_manifest_content_hash:
      input.draft.exactTargetManifestContentHash,
    p_registry_content_hash: input.registry.contentHash,
    p_registry_entries: registryEntries,
    p_changes: bundle.diffs.map((diff) => ({
      slug: diff.slug,
      rollbackFields: diff.fields as unknown as JsonObject[],
    })),
    p_candidate_manifest: candidate.manifest as unknown as JsonObject,
    p_candidate_specs: candidate.channelSpecs as unknown as JsonObject[],
    p_worker_projection: candidate.workerProjection as unknown as JsonObject,
    p_dashboard_projection:
      candidate.dashboardProjection as unknown as JsonObject,
    p_exact_diffs: bundle.diffs as unknown as JsonObject[],
    p_validation_results:
      candidate.validationResults as unknown as JsonObject[],
    p_capacity_evaluation: bundle.capacity as unknown as JsonObject,
    p_configuration_epoch_id: bundle.configurationEpochId,
    p_reason: input.draft.reason.trim(),
    p_evidence_refs: [...bundle.evidenceRefs],
    p_operator_id: input.draft.operatorId.toLowerCase(),
    p_created_at: input.draft.createdAt,
  };
  return Object.freeze({
    rpc: "create_channel_roster_rollback_draft",
    args,
    idempotencyHash: contentHash(args),
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
