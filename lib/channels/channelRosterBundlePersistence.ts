import {
  canonicalJson,
  contentHash,
  type JsonObject,
} from "./channelControlPlane";
import type {
  ChannelRosterBundleDraft,
  ChannelRosterBundlePreview,
} from "./channelRosterBundle";
import type {
  ResearchChannelRegistration,
  ResearchChannelRegistry,
} from "./researchChannelRegistry";

export const CHANNEL_ROSTER_BUNDLE_PERSISTENCE_VERSION =
  "channel-roster-bundle-persistence-v1" as const;

export type ChannelRosterBundleLifecycleState =
  | "draft"
  | "validated"
  | "canceled"
  | "superseded"
  | "approved"
  | "rolled-back";

export interface ResearchChannelRegistrationWrite {
  rpc: "create_research_channel_registration";
  args: {
    p_id: string;
    p_registration_key: string;
    p_channel_id: string;
    p_channel_slug: string;
    p_cartridge: JsonObject | null;
    p_candidate_spec: JsonObject | null;
    p_state: "paper-eligible" | "registered-blocked";
    p_declared_blockers: string[];
    p_blockers: string[];
    p_content_hash: string;
    p_registered_by: string;
    p_registered_at: string;
  };
  idempotencyHash: string;
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ChannelRosterBundleDraftWrite {
  rpc: "create_channel_roster_bundle_draft";
  args: {
    p_bundle_id: string;
    p_initial_receipt_id: string;
    p_base_manifest_key: string;
    p_base_manifest_content_hash: string;
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

export interface ChannelRosterBundleLifecycleWrite {
  rpc: "transition_channel_roster_bundle";
  args: {
    p_receipt_id: string;
    p_bundle_id: string;
    p_target_state: "canceled" | "superseded";
    p_successor_bundle_id: string | null;
    p_reason: string;
    p_evidence_refs: string[];
    p_operator_id: string;
    p_effective_at: string;
  };
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value) as JsonObject;
}

function jsonObjectArray(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)
      || value.some((item) => !item || typeof item !== "object"
        || Array.isArray(item))) {
    throw new Error(`${label} must be an object array`);
  }
  return structuredClone(value) as JsonObject[];
}

function printable(value: string, minimum = 1, maximum = 2_000): boolean {
  return value.trim().length >= minimum
    && value.trim().length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function refs(values: readonly string[]): string[] {
  const result = [...new Set(values.map((value) => value.trim()))]
    .filter((value) => printable(value, 1, 500))
    .sort();
  if (!result.length || result.length > 64) {
    throw new Error("bundle evidence references are invalid");
  }
  return result;
}

export function prepareResearchChannelRegistrationWrite(input: {
  registration: ResearchChannelRegistration;
  recordId: string;
}): ResearchChannelRegistrationWrite {
  const registration = input.registration;
  if (!UUID.test(input.recordId) || !UUID.test(registration.channelId)) {
    throw new Error("research registration persistence identities must be UUIDs");
  }
  if (!printable(registration.id, 3, 200)
      || !printable(registration.slug, 3, 100)
      || !printable(registration.registeredBy, 3, 200)
      || !Number.isFinite(Date.parse(registration.registeredAt))) {
    throw new Error("research registration persistence metadata is invalid");
  }
  if (registration.executionAuthority !== false
      || registration.runtimeMutationAuthorized !== false
      || registration.orderAuthority !== false) {
    throw new Error("research registration cannot carry authority");
  }
  if (registration.state === "paper-eligible"
      && (!registration.cartridge
        || !registration.candidateSpec
        || registration.blockers.length)) {
    throw new Error("paper-eligible registration is incomplete");
  }
  const args: ResearchChannelRegistrationWrite["args"] = {
    p_id: input.recordId.toLowerCase(),
    p_registration_key: registration.id,
    p_channel_id: registration.channelId.toLowerCase(),
    p_channel_slug: registration.slug,
    p_cartridge: registration.cartridge
      ? jsonObject(registration.cartridge, "research cartridge")
      : null,
    p_candidate_spec: registration.candidateSpec
      ? jsonObject(registration.candidateSpec, "research candidate spec")
      : null,
    p_state: registration.state,
    p_declared_blockers: [...registration.declaredBlockers],
    p_blockers: [...registration.blockers],
    p_content_hash: registration.contentHash,
    p_registered_by: registration.registeredBy,
    p_registered_at: registration.registeredAt,
  };
  return Object.freeze({
    rpc: "create_research_channel_registration",
    args,
    idempotencyHash: contentHash(args as unknown as JsonObject),
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function prepareRosterBundleDraftWrite(input: {
  draft: ChannelRosterBundleDraft;
  preview: ChannelRosterBundlePreview;
  registry: ResearchChannelRegistry;
  initialReceiptId: string;
}): ChannelRosterBundleDraftWrite {
  if (input.preview.state !== "ready-for-worker-ack"
      || !input.preview.candidate
      || !input.preview.capacity
      || !input.preview.configurationEpochId) {
    throw new Error("only a fully passing roster preview can be persisted");
  }
  if (input.preview.id !== input.draft.id
      || input.preview.activeManifestId !== input.draft.baseManifestId
      || input.preview.activeManifestContentHash
        !== input.draft.baseManifestContentHash
      || input.preview.rollbackTargetManifestId
        !== input.draft.baseManifestId) {
    throw new Error("bundle preview identity drifted");
  }
  if (![input.draft.id, input.draft.operatorId, input.initialReceiptId]
    .every((value) => UUID.test(value))) {
    throw new Error("bundle persistence identities must be UUIDs");
  }
  if (!printable(input.draft.reason, 8)) {
    throw new Error("bundle reason is invalid");
  }
  const candidate = input.preview.candidate;
  const evidenceRefs = refs(input.preview.evidenceRefs);
  const args: ChannelRosterBundleDraftWrite["args"] = {
    p_bundle_id: input.draft.id.toLowerCase(),
    p_initial_receipt_id: input.initialReceiptId.toLowerCase(),
    p_base_manifest_key: input.draft.baseManifestId,
    p_base_manifest_content_hash: input.draft.baseManifestContentHash,
    p_registry_content_hash: input.registry.contentHash,
    p_registry_entries: input.registry.entries.map((entry) => ({
      registrationKey: entry.id,
      channelId: entry.channelId,
      slug: entry.slug,
      state: entry.state,
      contentHash: entry.contentHash,
    })),
    p_changes: jsonObjectArray(input.draft.changes, "bundle changes"),
    p_candidate_manifest: jsonObject(candidate.manifest, "candidate manifest"),
    p_candidate_specs: jsonObjectArray(candidate.channelSpecs, "candidate specs"),
    p_worker_projection: jsonObject(
      candidate.workerProjection,
      "worker projection",
    ),
    p_dashboard_projection: jsonObject(
      candidate.dashboardProjection,
      "dashboard projection",
    ),
    p_exact_diffs: jsonObjectArray(input.preview.diffs, "bundle diffs"),
    p_validation_results: jsonObjectArray(
      candidate.validationResults,
      "validation results",
    ),
    p_capacity_evaluation: jsonObject(
      input.preview.capacity,
      "capacity evaluation",
    ),
    p_configuration_epoch_id: input.preview.configurationEpochId,
    p_reason: input.draft.reason.trim(),
    p_evidence_refs: evidenceRefs,
    p_operator_id: input.draft.operatorId.toLowerCase(),
    p_created_at: input.draft.createdAt,
  };
  return Object.freeze({
    rpc: "create_channel_roster_bundle_draft",
    args,
    idempotencyHash: contentHash(args as unknown as JsonObject),
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function prepareRosterBundleLifecycleWrite(input: {
  receiptId: string;
  bundleId: string;
  targetState: "canceled" | "superseded";
  successorBundleId?: string | null;
  reason: string;
  evidenceRefs: string[];
  operatorId: string;
  effectiveAt: string;
}): ChannelRosterBundleLifecycleWrite {
  if (![input.receiptId, input.bundleId, input.operatorId]
    .every((value) => UUID.test(value))) {
    throw new Error("bundle lifecycle identities must be UUIDs");
  }
  const successor = input.successorBundleId ?? null;
  if (input.targetState === "superseded") {
    if (!successor || !UUID.test(successor) || successor === input.bundleId) {
      throw new Error("supersession requires a distinct successor bundle");
    }
  } else if (successor) {
    throw new Error("cancellation cannot name a successor bundle");
  }
  if (!printable(input.reason, 8)
      || !Number.isFinite(Date.parse(input.effectiveAt))) {
    throw new Error("bundle lifecycle reason or timestamp is invalid");
  }
  return Object.freeze({
    rpc: "transition_channel_roster_bundle",
    args: {
      p_receipt_id: input.receiptId.toLowerCase(),
      p_bundle_id: input.bundleId.toLowerCase(),
      p_target_state: input.targetState,
      p_successor_bundle_id: successor?.toLowerCase() ?? null,
      p_reason: input.reason.trim(),
      p_evidence_refs: refs(input.evidenceRefs),
      p_operator_id: input.operatorId.toLowerCase(),
      p_effective_at: input.effectiveAt,
    },
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function rosterBundleWriteIsStable(
  left: ChannelRosterBundleDraftWrite,
  right: ChannelRosterBundleDraftWrite,
): boolean {
  return left.idempotencyHash === right.idempotencyHash
    && canonicalJson(left.args) === canonicalJson(right.args);
}
