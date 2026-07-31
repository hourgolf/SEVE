import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalJson,
  compileReleaseManifest,
  type ActivationReceipt,
  type ChangeClass,
  type ChannelChangeProposal,
  type ChannelSpecStatus,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type JsonObject,
  type ProposalReplaySummary,
  type ReleaseManifestDraft,
  type ValidationGateResult,
} from "./channelControlPlane";
import { buildShadowRuntimeProjection } from "./channelActivation";
import type {
  ConfigurationActivationAuthority,
} from "./channelEpochEvidence";

export interface StoredControlPlaneRead {
  compiled: CompiledReleaseManifest | null;
  state: "active" | "not-adopted" | "failed";
  error: string | null;
}

export interface StoredManifestControlPlaneRead {
  compiled: CompiledReleaseManifest | null;
  state: "loaded" | "failed";
  error: string | null;
}

export interface StoredControlPlaneDatabaseIdentity {
  releaseManifestDatabaseId: string;
  channelSpecDatabaseIdsByVersionKey: Record<string, string>;
}

export interface StoredReceiptBoundControlPlaneRead {
  compiled: CompiledReleaseManifest | null;
  activationReceipt: ConfigurationActivationAuthority | null;
  databaseIdentity: StoredControlPlaneDatabaseIdentity | null;
  state: "receipt-bound" | "baseline-active" | "not-adopted" | "failed";
  error: string | null;
}

interface StoredManifest {
  id: string;
  manifestKey: string;
  releaseId: string;
  cohortId: string;
  workerCompatibilityVersion: string;
  legacyConfigurationHash: string;
  paperLiveAuthority: "paper-only";
  admissionPolicyVersion: string;
  collisionPolicyVersion: string;
  activationBoundary: "next-safe-entry";
  admissionPolicies: ReleaseManifestDraft["admissionPolicies"];
  rollbackTargetManifestId: string;
  parentManifestKey: string | null;
  manifestJson: JsonObject;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  validFrom: string | null;
  status: ChannelSpecStatus;
}

interface StoredSpec {
  databaseId: string;
  versionKey: string;
  channelId: string;
  channelSlug: string;
  strategyIdentity: string;
  strategyVersion: string;
  signalVersion: string;
  managerProfileId: string;
  managerVersion: string;
  accountId: string;
  accountRole: string;
  accountMode: "paper";
  symbolScope: string[];
  familyId: string;
  cohort: "control" | "lab";
  priority: number;
  quantity: number;
  maxDebitUsd: number;
  entryParameters: JsonObject;
  exitParameters: JsonObject;
  takeProfit: ChannelSpecVersionDraft["takeProfit"];
  stopLoss: ChannelSpecVersionDraft["stopLoss"];
  ratchetParameters: ChannelSpecVersionDraft["ratchetParameters"];
  reentryPolicy: "disabled" | "bounded";
  scalePolicy: ChannelSpecVersionDraft["scalePolicy"];
  collisionDomain: string;
  riskLimits: ChannelSpecVersionDraft["riskLimits"];
  executionPosture?: "paper" | "observe-only";
  validFrom: string;
  validUntil: string | null;
  createdBy: string;
  createdAt: string;
  parentVersionKey: string | null;
  contentHash: string;
  status: ChannelSpecStatus;
}

interface StoredMembership {
  ordinal: number;
  specDatabaseId: string;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const LEGACY_SHA256 = /^[0-9a-f]{64}$/;
const STATUSES = new Set<ChannelSpecStatus>([
  "draft",
  "validated",
  "scheduled",
  "active",
  "superseded",
  "rejected",
  "rolled_back",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function finite(row: Record<string, unknown>, key: string): number | null {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
}

function relationKey(value: unknown, key: string): string | null {
  const related = Array.isArray(value) ? record(value[0]) : record(value);
  const candidate = related?.[key];
  return typeof candidate === "string" && candidate ? candidate : null;
}

function parseValidationResults(value: unknown): ValidationGateResult[] | null {
  if (!Array.isArray(value)) return null;
  const results: ValidationGateResult[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row
        || typeof row.gate !== "string"
        || !["pass", "block", "not-run"].includes(text(row, "state"))
        || !text(row, "code")
        || !text(row, "fact")
        || !Array.isArray(row.evidenceRefs)
        || row.evidenceRefs.some((ref) => typeof ref !== "string")) {
      return null;
    }
    results.push({
      gate: text(row, "gate") as ValidationGateResult["gate"],
      state: text(row, "state") as ValidationGateResult["state"],
      code: text(row, "code"),
      fact: text(row, "fact"),
      evidenceRefs: row.evidenceRefs as string[],
    });
  }
  return results;
}

function parseReplaySummary(value: unknown): ProposalReplaySummary | null {
  const row = record(value);
  if (!row
      || !["not-run", "sufficient", "insufficient", "censored"].includes(
        text(row, "state"),
      )
      || !Number.isInteger(row.exactSamples)
      || !Number.isInteger(row.censoredSamples)
      || !Array.isArray(row.limitations)
      || row.limitations.some((item) => typeof item !== "string")
      || !Array.isArray(row.evidenceRefs)
      || row.evidenceRefs.some((item) => typeof item !== "string")) {
    return null;
  }
  return {
    state: text(row, "state") as ProposalReplaySummary["state"],
    exactSamples: row.exactSamples as number,
    censoredSamples: row.censoredSamples as number,
    limitations: row.limitations as string[],
    evidenceRefs: row.evidenceRefs as string[],
  };
}

export function reconstructStoredChannelProposal(
  row: Record<string, unknown>,
): ChannelChangeProposal {
  const baseSpecVersionId = relationKey(row.base, "version_key");
  const proposedSpecVersionId = relationKey(row.proposed, "version_key");
  const proposedPatch = jsonObject(row.proposed_patch);
  const validationResults = parseValidationResults(row.validation_results);
  const replaySummary = parseReplaySummary(row.replay_summary);
  const approvalState = text(row, "approval_state");
  const authorKind = text(row, "author_kind");
  const evidenceRefs = row.evidence_refs;
  if (!text(row, "id")
      || !baseSpecVersionId
      || !proposedSpecVersionId
      || !SHA256.test(text(row, "base_spec_content_hash"))
      || !proposedPatch
      || !Array.isArray(evidenceRefs)
      || evidenceRefs.some((ref) => typeof ref !== "string")
      || !["operator", "sentinel", "system"].includes(authorKind)
      || !text(row, "author_id")
      || !validationResults
      || !replaySummary
      || !["draft", "validated", "approved", "rejected", "canceled"].includes(
        approvalState,
      )
      || text(row, "requested_activation_boundary") !== "next-safe-entry"
      || row.activation_authorized !== false
      || !Number.isFinite(Date.parse(text(row, "created_at")))) {
    throw new Error("stored channel proposal is malformed");
  }
  return {
    schemaVersion: 1,
    id: text(row, "id"),
    baseSpecVersionId,
    baseSpecContentHash: text(row, "base_spec_content_hash"),
    proposedSpecVersionId,
    proposedPatch,
    reason: text(row, "reason"),
    evidenceRefs: evidenceRefs as string[],
    authorKind: authorKind as ChannelChangeProposal["authorKind"],
    authorId: text(row, "author_id"),
    changeClass: text(row, "change_class") as ChangeClass,
    validationResults,
    replaySummary,
    approvalState: approvalState as ChannelChangeProposal["approvalState"],
    requestedActivationBoundary: "next-safe-entry",
    createdAt: text(row, "created_at"),
    activationAuthorized: false,
  };
}

const PROPOSAL_SELECT = [
  "id",
  "base_spec_content_hash",
  "proposed_patch",
  "reason",
  "evidence_refs",
  "author_kind",
  "author_id",
  "change_class",
  "validation_results",
  "replay_summary",
  "capacity_collision_impact",
  "approval_state",
  "requested_activation_boundary",
  "created_at",
  "activation_authorized",
  "base:base_spec_version_id(version_key)",
  "proposed:proposed_spec_version_id(version_key)",
].join(",");

export async function loadStoredChannelProposal(
  client: SupabaseClient,
  proposalId: string,
): Promise<{
  proposal: ChannelChangeProposal | null;
  capacityCollisionImpact: JsonObject | null;
  row: Record<string, unknown> | null;
  error: string | null;
}> {
  const read = await client.from("channel_change_proposals")
    .select(PROPOSAL_SELECT)
    .eq("id", proposalId)
    .maybeSingle();
  if (read.error) {
    return {
      proposal: null,
      capacityCollisionImpact: null,
      row: null,
      error: read.error.message,
    };
  }
  const row = read.data as unknown as Record<string, unknown> | null;
  if (!row) {
    return {
      proposal: null,
      capacityCollisionImpact: null,
      row: null,
      error: null,
    };
  }
  try {
    return {
      proposal: reconstructStoredChannelProposal(row),
      capacityCollisionImpact: jsonObject(row.capacity_collision_impact),
      row,
      error: null,
    };
  } catch (readError) {
    return {
      proposal: null,
      capacityCollisionImpact: null,
      row,
      error: readError instanceof Error
        ? readError.message
        : "stored proposal is malformed",
    };
  }
}

export function reconstructStoredActivationReceipt(
  row: Record<string, unknown>,
  compiled: CompiledReleaseManifest,
): ActivationReceipt {
  const projection = buildShadowRuntimeProjection(compiled);
  const oldSpecVersionId = relationKey(row.old_spec, "version_key");
  const newSpecVersionId = relationKey(row.new_spec, "version_key");
  const releaseManifestId = relationKey(row.manifest, "manifest_key");
  const exactDiff = jsonObject(row.exact_diff);
  const safeBoundaryProof = jsonObject(row.safe_boundary_proof);
  const workerAcknowledgement = jsonObject(row.worker_acknowledgement);
  const validationResults = Array.isArray(row.validation_results)
    ? row.validation_results as ActivationReceipt["validationResults"]
    : null;
  const validatorVersions = Array.isArray(row.validator_versions)
    ? row.validator_versions.filter((value): value is string => typeof value === "string")
    : [];
  const receipt: ActivationReceipt = {
    schemaVersion: Number(row.schema_version) as 1,
    id: text(row, "id"),
    configurationEpochId: text(row, "configuration_epoch_id"),
    proposalId: text(row, "proposal_id"),
    oldSpecVersionId: oldSpecVersionId ?? "",
    newSpecVersionId: newSpecVersionId ?? "",
    releaseManifestId: releaseManifestId ?? "",
    exactDiff: exactDiff ?? {},
    validationResults: validationResults ?? [],
    validatorVersions,
    approvedBy: text(row, "approved_by"),
    scheduledFor: text(row, "scheduled_for"),
    activatedAt: text(row, "activated_at"),
    safeBoundaryProof: safeBoundaryProof ?? {},
    workerAcknowledgement: workerAcknowledgement ?? {},
    rollbackTargetManifestId: text(row, "rollback_target_manifest_id"),
    oldContentHash: text(row, "old_content_hash"),
    newContentHash: text(row, "new_content_hash"),
    manifestContentHash: text(row, "manifest_content_hash"),
  };
  if (receipt.schemaVersion !== 1
      || !receipt.id
      || !receipt.proposalId
      || !receipt.oldSpecVersionId
      || !receipt.newSpecVersionId
      || receipt.releaseManifestId !== compiled.manifest.id
      || receipt.newSpecVersionId
        !== compiled.channelSpecs.find((spec) => spec.id === receipt.newSpecVersionId)?.id
      || receipt.configurationEpochId !== projection.configurationEpochId
      || receipt.manifestContentHash !== compiled.manifest.contentHash
      || !SHA256.test(receipt.oldContentHash)
      || !SHA256.test(receipt.newContentHash)
      || !receipt.validatorVersions.length
      || !Number.isFinite(Date.parse(receipt.scheduledFor))
      || !Number.isFinite(Date.parse(receipt.activatedAt))
      || Date.parse(receipt.activatedAt) < Date.parse(receipt.scheduledFor)) {
    throw new Error("active control-plane activation receipt is malformed or drifted");
  }
  return receipt;
}

export function reconstructStoredRosterBundleActivationAuthority(
  row: Record<string, unknown>,
  compiled: CompiledReleaseManifest,
): ConfigurationActivationAuthority {
  const projection = buildShadowRuntimeProjection(compiled);
  const exactDiffs = row.exact_diffs;
  const capacity = jsonObject(row.capacity_evaluation);
  const safeBoundary = jsonObject(row.safe_boundary_proof);
  const acknowledgement = jsonObject(row.worker_acknowledgement);
  const authority: ConfigurationActivationAuthority = {
    id: text(row, "id"),
    receiptKind: "roster-bundle",
    configurationEpochId: text(row, "configuration_epoch_id"),
    releaseManifestId: compiled.manifest.id,
    manifestContentHash: text(row, "candidate_manifest_content_hash"),
    activatedAt: text(row, "activated_at"),
    activatedSpecs: compiled.channelSpecs.map((spec) => ({
      versionId: spec.id,
      contentHash: spec.contentHash,
    })),
  };
  if (Number(row.schema_version) !== 1
      || !authority.id
      || text(row, "candidate_manifest_key") !== compiled.manifest.id
      || authority.manifestContentHash !== compiled.manifest.contentHash
      || authority.configurationEpochId !== projection.configurationEpochId
      || text(row, "rollback_target_manifest_key")
        !== compiled.manifest.rollbackTargetManifestId
      || !Array.isArray(exactDiffs)
      || exactDiffs.length === 0
      || capacity?.state !== "pass"
      || !safeBoundary
      || safeBoundary.globalFlat !== true
      || !acknowledgement
      || text(row, "activation_scope") !== "prospective-new-entry-only"
      || text(row, "open_position_policy_preservation")
        !== "entry-epoch-immutable"
      || row.historical_evidence_mutation !== false
      || row.order_authority !== false
      || !Number.isFinite(Date.parse(authority.activatedAt))) {
    throw new Error(
      "active control-plane roster activation receipt is malformed or drifted",
    );
  }
  return Object.freeze({
    ...authority,
    activatedSpecs: Object.freeze(
      authority.activatedSpecs?.map((spec) => Object.freeze(spec)) ?? [],
    ),
  });
}

function jsonObject(value: unknown): JsonObject | null {
  return record(value) as JsonObject | null;
}

function parseManifest(row: Record<string, unknown>): StoredManifest | null {
  const status = text(row, "status") as ChannelSpecStatus;
  const admissionPolicies = row.admission_policies;
  const manifestJson = jsonObject(row.manifest_json);
  if (!STATUSES.has(status)
      || text(row, "paper_live_authority") !== "paper-only"
      || text(row, "activation_boundary") !== "next-safe-entry"
      || !Array.isArray(admissionPolicies)
      || !manifestJson
      || !SHA256.test(text(row, "content_hash"))
      || !LEGACY_SHA256.test(text(row, "legacy_configuration_hash"))) {
    return null;
  }
  return {
    id: text(row, "id"),
    manifestKey: text(row, "manifest_key"),
    releaseId: text(row, "release_id"),
    cohortId: text(row, "cohort_id"),
    workerCompatibilityVersion: text(row, "worker_compatibility_version"),
    legacyConfigurationHash: text(row, "legacy_configuration_hash"),
    paperLiveAuthority: "paper-only",
    admissionPolicyVersion: text(row, "admission_policy_version"),
    collisionPolicyVersion: text(row, "collision_policy_version"),
    activationBoundary: "next-safe-entry",
    admissionPolicies: admissionPolicies as ReleaseManifestDraft["admissionPolicies"],
    rollbackTargetManifestId: text(row, "rollback_target_manifest_id"),
    parentManifestKey: relationKey(row.parent, "manifest_key"),
    manifestJson,
    contentHash: text(row, "content_hash"),
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
    validFrom: typeof row.valid_from === "string" ? row.valid_from : null,
    status,
  };
}

function parseSpec(row: Record<string, unknown>): StoredSpec | null {
  const status = text(row, "status") as ChannelSpecStatus;
  const priority = finite(row, "priority");
  const quantity = finite(row, "quantity");
  const maxDebitUsd = finite(row, "max_debit_usd");
  const symbolScope = row.symbol_scope;
  const entryParameters = jsonObject(row.entry_parameters);
  const exitParameters = jsonObject(row.exit_parameters);
  const takeProfit = jsonObject(row.take_profit);
  const stopLoss = jsonObject(row.stop_loss);
  const ratchetParameters = jsonObject(row.ratchet_parameters);
  const scalePolicy = jsonObject(row.scale_policy);
  const riskLimits = jsonObject(row.risk_limits);
  if (!STATUSES.has(status)
      || text(row, "account_mode") !== "paper"
      || (text(row, "execution_posture")
        && !["paper", "observe-only"].includes(text(row, "execution_posture")))
      || !["control", "lab"].includes(text(row, "cohort"))
      || !["disabled", "bounded"].includes(text(row, "reentry_policy"))
      || !Array.isArray(symbolScope)
      || symbolScope.some((symbol) => typeof symbol !== "string")
      || priority === null
      || quantity === null
      || maxDebitUsd === null
      || !entryParameters
      || !exitParameters
      || !takeProfit
      || !stopLoss
      || !ratchetParameters
      || !scalePolicy
      || !riskLimits
      || !SHA256.test(text(row, "content_hash"))) {
    return null;
  }
  return {
    databaseId: text(row, "id"),
    versionKey: text(row, "version_key"),
    channelId: text(row, "channel_id"),
    channelSlug: text(row, "channel_slug"),
    strategyIdentity: text(row, "strategy_identity"),
    strategyVersion: text(row, "strategy_version"),
    signalVersion: text(row, "signal_version"),
    managerProfileId: text(row, "manager_profile_id"),
    managerVersion: text(row, "manager_version"),
    accountId: text(row, "account_id"),
    accountRole: text(row, "account_role"),
    accountMode: "paper",
    symbolScope: symbolScope as string[],
    familyId: text(row, "family_id"),
    cohort: text(row, "cohort") as "control" | "lab",
    priority,
    quantity,
    maxDebitUsd,
    entryParameters,
    exitParameters,
    takeProfit: takeProfit as unknown as ChannelSpecVersionDraft["takeProfit"],
    stopLoss: stopLoss as unknown as ChannelSpecVersionDraft["stopLoss"],
    ratchetParameters: ratchetParameters as unknown as ChannelSpecVersionDraft["ratchetParameters"],
    reentryPolicy: text(row, "reentry_policy") as "disabled" | "bounded",
    scalePolicy: scalePolicy as unknown as ChannelSpecVersionDraft["scalePolicy"],
    collisionDomain: text(row, "collision_domain"),
    riskLimits: riskLimits as unknown as ChannelSpecVersionDraft["riskLimits"],
    ...(text(row, "execution_posture")
      ? {
        executionPosture: text(row, "execution_posture") as
          "paper" | "observe-only",
      }
      : {}),
    validFrom: text(row, "valid_from"),
    validUntil: typeof row.valid_until === "string" ? row.valid_until : null,
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
    parentVersionKey: relationKey(row.parent, "version_key"),
    contentHash: text(row, "content_hash"),
    status,
  };
}

export function reconstructStoredControlPlane(input: {
  manifestRow: Record<string, unknown>;
  membershipRows: Array<Record<string, unknown>>;
  specRows: Array<Record<string, unknown>>;
}): CompiledReleaseManifest {
  const manifest = parseManifest(input.manifestRow);
  if (!manifest) throw new Error("active control-plane manifest is malformed");
  if (manifest.status !== "active") throw new Error("control-plane manifest is not active");
  const memberships: StoredMembership[] = input.membershipRows.map((row) => ({
    ordinal: Number(row.ordinal),
    specDatabaseId: text(row, "channel_spec_version_id"),
  })).sort((left, right) => left.ordinal - right.ordinal);
  if (!memberships.length
      || memberships.some((membership, index) =>
        !Number.isInteger(membership.ordinal)
        || membership.ordinal !== index
        || !membership.specDatabaseId)) {
    throw new Error("active control-plane membership is incomplete");
  }
  const specs = input.specRows.map(parseSpec);
  if (specs.some((spec) => spec === null)) {
    throw new Error("active control-plane specification is malformed");
  }
  const specsByDatabaseId = new Map(
    (specs as StoredSpec[]).map((spec) => [spec.databaseId, spec]),
  );
  const ordered = memberships.map((membership) => specsByDatabaseId.get(membership.specDatabaseId) ?? null);
  if (ordered.some((spec) => spec === null)
      || new Set(ordered.map((spec) => spec?.databaseId)).size !== memberships.length) {
    throw new Error("active control-plane membership cannot be resolved exactly");
  }
  const channelSpecs: ChannelSpecVersionDraft[] = (ordered as StoredSpec[]).map((spec) => ({
    schemaVersion: 1,
    id: spec.versionKey,
    channelId: spec.channelId,
    slug: spec.channelSlug,
    strategyIdentity: spec.strategyIdentity,
    strategyVersion: spec.strategyVersion,
    signalVersion: spec.signalVersion,
    managerProfileId: spec.managerProfileId,
    managerVersion: spec.managerVersion,
    accountId: spec.accountId,
    accountRole: spec.accountRole,
    accountMode: spec.accountMode,
    symbolScope: spec.symbolScope,
    familyId: spec.familyId,
    cohort: spec.cohort,
    priority: spec.priority,
    quantity: spec.quantity,
    maxDebitUsd: spec.maxDebitUsd,
    entryParameters: spec.entryParameters,
    exitParameters: spec.exitParameters,
    takeProfit: spec.takeProfit,
    stopLoss: spec.stopLoss,
    ratchetParameters: spec.ratchetParameters,
    reentryPolicy: spec.reentryPolicy,
    scalePolicy: spec.scalePolicy,
    collisionDomain: spec.collisionDomain,
    riskLimits: spec.riskLimits,
    ...(spec.executionPosture
      ? { executionPosture: spec.executionPosture }
      : {}),
    validFrom: spec.validFrom,
    validUntil: spec.validUntil,
    createdBy: spec.createdBy,
    createdAt: spec.createdAt,
    parentVersionId: spec.parentVersionKey,
    status: spec.status,
  }));
  const compiled = compileReleaseManifest({
    schemaVersion: 1,
    id: manifest.manifestKey,
    releaseId: manifest.releaseId,
    cohortId: manifest.cohortId,
    workerCompatibilityVersion: manifest.workerCompatibilityVersion,
    legacyConfigurationHash: manifest.legacyConfigurationHash,
    paperLiveAuthority: manifest.paperLiveAuthority,
    admissionPolicyVersion: manifest.admissionPolicyVersion,
    collisionPolicyVersion: manifest.collisionPolicyVersion,
    activationBoundary: manifest.activationBoundary,
    rollbackTargetManifestId: manifest.rollbackTargetManifestId,
    channelSpecs,
    admissionPolicies: manifest.admissionPolicies,
    createdBy: manifest.createdBy,
    createdAt: manifest.createdAt,
    parentManifestId: manifest.parentManifestKey,
    status: manifest.status,
  });
  const storedSpecsByKey = new Map((ordered as StoredSpec[]).map((spec) => [spec.versionKey, spec]));
  for (const spec of compiled.channelSpecs) {
    if (storedSpecsByKey.get(spec.id)?.contentHash !== spec.contentHash) {
      throw new Error(`active control-plane spec hash drifted: ${spec.id}`);
    }
  }
  if (compiled.manifest.contentHash !== manifest.contentHash) {
    throw new Error("active control-plane manifest hash drifted");
  }
  const manifestJson = manifest.manifestJson;
  if (manifestJson.contentHash !== compiled.manifest.contentHash
      || manifestJson.releaseId !== compiled.manifest.releaseId
      || canonicalJson(manifestJson.channelSpecVersionIds)
        !== canonicalJson(compiled.manifest.channelSpecVersionIds)
      || canonicalJson(manifestJson.channelSpecContentHashes)
        !== canonicalJson(compiled.manifest.channelSpecContentHashes)) {
    throw new Error("active control-plane manifest receipt disagrees with compiled projection");
  }
  return compiled;
}

const MANIFEST_SELECT = [
  "id",
  "manifest_key",
  "release_id",
  "cohort_id",
  "worker_compatibility_version",
  "legacy_configuration_hash",
  "paper_live_authority",
  "admission_policy_version",
  "collision_policy_version",
  "activation_boundary",
  "admission_policies",
  "rollback_target_manifest_id",
  "manifest_json",
  "content_hash",
  "created_by",
  "created_at",
  "valid_from",
  "status",
  "parent:parent_manifest_id(manifest_key)",
].join(",");

const SPEC_SELECT = [
  "id",
  "version_key",
  "channel_id",
  "channel_slug",
  "strategy_identity",
  "strategy_version",
  "signal_version",
  "manager_profile_id",
  "manager_version",
  "account_id",
  "account_role",
  "account_mode",
  "symbol_scope",
  "family_id",
  "cohort",
  "priority",
  "quantity",
  "max_debit_usd",
  "entry_parameters",
  "exit_parameters",
  "take_profit",
  "stop_loss",
  "ratchet_parameters",
  "reentry_policy",
  "scale_policy",
  "collision_domain",
  "risk_limits",
  "execution_posture",
  "valid_from",
  "valid_until",
  "created_by",
  "created_at",
  "content_hash",
  "status",
  "parent:parent_version_id(version_key)",
].join(",");
const LEGACY_SPEC_SELECT = SPEC_SELECT
  .split(",")
  .filter((field) => field !== "execution_posture")
  .join(",");

function missingExecutionPostureColumn(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  return error.code === "42703"
    || /execution_posture/i.test(error.message ?? "");
}

export async function loadActiveCompiledControlPlane(
  client: SupabaseClient,
): Promise<StoredControlPlaneRead> {
  const manifestRead = await client.from("release_manifests")
    .select(MANIFEST_SELECT)
    .eq("status", "active")
    .order("valid_from", { ascending: false })
    .limit(2);
  if (manifestRead.error) {
    return { compiled: null, state: "failed", error: `release_manifests:${manifestRead.error.message}` };
  }
  const manifests = (manifestRead.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (!manifests.length) return { compiled: null, state: "not-adopted", error: null };
  if (manifests.length !== 1) {
    return { compiled: null, state: "failed", error: "release_manifests:multiple_active" };
  }
  const manifestId = text(manifests[0], "id");
  const membershipRead = await client.from("release_manifest_channels")
    .select("ordinal,channel_spec_version_id")
    .eq("release_manifest_id", manifestId)
    .order("ordinal", { ascending: true });
  if (membershipRead.error) {
    return {
      compiled: null,
      state: "failed",
      error: `release_manifest_channels:${membershipRead.error.message}`,
    };
  }
  const memberships = (membershipRead.data ?? []) as Array<Record<string, unknown>>;
  const specIds = memberships.map((membership) => text(membership, "channel_spec_version_id"));
  if (!specIds.length || specIds.some((id) => !id)) {
    return {
      compiled: null,
      state: "failed",
      error: "release_manifest_channels:membership_missing",
    };
  }
  let specsRead = await client.from("channel_spec_versions")
    .select(SPEC_SELECT)
    .in("id", specIds);
  // A dashboard deploy may briefly precede the additive migration. Keep the
  // existing active control-plane read available in that interval; collection
  // and posture writes still fail closed until the new column exists.
  if (missingExecutionPostureColumn(specsRead.error)) {
    specsRead = await client.from("channel_spec_versions")
      .select(LEGACY_SPEC_SELECT)
      .in("id", specIds);
  }
  if (specsRead.error) {
    return { compiled: null, state: "failed", error: `channel_spec_versions:${specsRead.error.message}` };
  }
  try {
    return {
      compiled: reconstructStoredControlPlane({
        manifestRow: manifests[0],
        membershipRows: memberships,
        specRows: (specsRead.data ?? []) as unknown as Array<Record<string, unknown>>,
      }),
      state: "active",
      error: null,
    };
  } catch (error) {
    return {
      compiled: null,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadCompiledControlPlaneByManifestKey(
  client: SupabaseClient,
  manifestKey: string,
): Promise<StoredManifestControlPlaneRead> {
  if (!manifestKey.trim()) {
    return { compiled: null, state: "failed", error: "release_manifests:key_missing" };
  }
  const manifestRead = await client.from("release_manifests")
    .select(MANIFEST_SELECT)
    .eq("manifest_key", manifestKey)
    .limit(2);
  if (manifestRead.error) {
    return { compiled: null, state: "failed", error: `release_manifests:${manifestRead.error.message}` };
  }
  const manifests = (manifestRead.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (manifests.length !== 1) {
    return {
      compiled: null,
      state: "failed",
      error: `release_manifests:expected_one:${manifests.length}`,
    };
  }
  const manifestId = text(manifests[0], "id");
  const membershipRead = await client.from("release_manifest_channels")
    .select("ordinal,channel_spec_version_id")
    .eq("release_manifest_id", manifestId)
    .order("ordinal", { ascending: true });
  if (membershipRead.error) {
    return {
      compiled: null,
      state: "failed",
      error: `release_manifest_channels:${membershipRead.error.message}`,
    };
  }
  const memberships = (membershipRead.data ?? []) as Array<Record<string, unknown>>;
  const specIds = memberships.map((membership) =>
    text(membership, "channel_spec_version_id"));
  if (!specIds.length || specIds.some((id) => !id)) {
    return { compiled: null, state: "failed", error: "release_manifest_channels:membership_missing" };
  }
  let specsRead = await client.from("channel_spec_versions")
    .select(SPEC_SELECT).in("id", specIds);
  if (missingExecutionPostureColumn(specsRead.error)) {
    specsRead = await client.from("channel_spec_versions")
      .select(LEGACY_SPEC_SELECT).in("id", specIds);
  }
  if (specsRead.error) {
    return { compiled: null, state: "failed", error: `channel_spec_versions:${specsRead.error.message}` };
  }
  try {
    return {
      compiled: reconstructStoredControlPlane({
        manifestRow: manifests[0],
        membershipRows: memberships,
        specRows: (specsRead.data ?? []) as unknown as Array<Record<string, unknown>>,
      }),
      state: "loaded",
      error: null,
    };
  } catch (error) {
    return {
      compiled: null,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const ACTIVATION_RECEIPT_SELECT = [
  "id",
  "schema_version",
  "configuration_epoch_id",
  "proposal_id",
  "exact_diff",
  "validation_results",
  "validator_versions",
  "approved_by",
  "scheduled_for",
  "activated_at",
  "safe_boundary_proof",
  "worker_acknowledgement",
  "rollback_target_manifest_id",
  "old_content_hash",
  "new_content_hash",
  "manifest_content_hash",
  "old_spec:old_spec_version_id(version_key)",
  "new_spec:new_spec_version_id(version_key)",
  "manifest:release_manifest_id(manifest_key)",
].join(",");

const ROSTER_BUNDLE_ACTIVATION_RECEIPT_SELECT = [
  "id",
  "schema_version",
  "configuration_epoch_id",
  "candidate_manifest_key",
  "candidate_manifest_content_hash",
  "rollback_target_manifest_key",
  "exact_diffs",
  "capacity_evaluation",
  "safe_boundary_proof",
  "worker_acknowledgement",
  "activated_at",
  "activation_scope",
  "open_position_policy_preservation",
  "historical_evidence_mutation",
  "order_authority",
].join(",");

function missingRosterBundleReceiptRelation(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  return error.code === "42P01"
    || /channel_roster_bundle_activation_receipts.*(?:does not exist|schema cache)/i
      .test(error.message ?? "");
}

/**
 * Resolves the active generic runtime only when one immutable single-channel
 * or atomic-roster receipt binds the exact reconstructed manifest. A
 * baseline-adopted RC5.4 manifest is reported separately so the worker can
 * continue using its sealed temporary adapter without pretending the baseline
 * receipt is a normal proposal activation.
 */
export async function loadStoredReceiptBoundControlPlane(
  client: SupabaseClient,
): Promise<StoredReceiptBoundControlPlaneRead> {
  const active = await loadActiveCompiledControlPlane(client);
  if (active.state === "failed") {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: active.error,
    };
  }
  if (!active.compiled) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "not-adopted",
      error: null,
    };
  }

  const manifestRead = await client.from("release_manifests")
    .select("id")
    .eq("manifest_key", active.compiled.manifest.id)
    .eq("status", "active")
    .maybeSingle();
  if (manifestRead.error || !manifestRead.data) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: `release_manifests:active_identity:${manifestRead.error?.message ?? "missing"}`,
    };
  }
  const releaseManifestDatabaseId = String(
    (manifestRead.data as Record<string, unknown>).id ?? "",
  );
  const specRead = await client.from("channel_spec_versions")
    .select("id,version_key")
    .in("version_key", active.compiled.manifest.channelSpecVersionIds);
  if (specRead.error) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: `channel_spec_versions:database_identity:${specRead.error.message}`,
    };
  }
  const specRows = (specRead.data ?? []) as unknown as Array<Record<string, unknown>>;
  const channelSpecDatabaseIdsByVersionKey = Object.fromEntries(
    specRows.map((row) => [text(row, "version_key"), text(row, "id")]),
  );
  if (Object.keys(channelSpecDatabaseIdsByVersionKey).length
        !== active.compiled.channelSpecs.length
      || Object.values(channelSpecDatabaseIdsByVersionKey).some((id) => !id)) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: "channel_spec_versions:database_identity:incomplete",
    };
  }
  const databaseIdentity: StoredControlPlaneDatabaseIdentity = {
    releaseManifestDatabaseId,
    channelSpecDatabaseIdsByVersionKey,
  };

  const receiptRead = await client.from("activation_receipts")
    .select(ACTIVATION_RECEIPT_SELECT)
    .eq("release_manifest_id", releaseManifestDatabaseId)
    .order("activated_at", { ascending: false })
    .limit(2);
  if (receiptRead.error) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: `activation_receipts:${receiptRead.error.message}`,
    };
  }
  const receipts = (receiptRead.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (receipts.length > 1) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: "activation_receipts:multiple_for_active_manifest",
    };
  }
  const rosterReceiptRead = await client
    .from("channel_roster_bundle_activation_receipts")
    .select(ROSTER_BUNDLE_ACTIVATION_RECEIPT_SELECT)
    .eq("release_manifest_id", releaseManifestDatabaseId)
    .order("activated_at", { ascending: false })
    .limit(2);
  if (rosterReceiptRead.error
      && !missingRosterBundleReceiptRelation(rosterReceiptRead.error)) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error:
        `channel_roster_bundle_activation_receipts:${rosterReceiptRead.error.message}`,
    };
  }
  const rosterReceipts = rosterReceiptRead.error
    ? []
    : (rosterReceiptRead.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (rosterReceipts.length > 1) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: "channel_roster_bundle_activation_receipts:multiple_for_active_manifest",
    };
  }
  if (receipts.length + rosterReceipts.length > 1) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: "active_control_plane:multiple_authority_receipt_families",
    };
  }
  if (receipts.length === 1) {
    try {
      return {
        compiled: active.compiled,
        activationReceipt: reconstructStoredActivationReceipt(
          receipts[0],
          active.compiled,
        ),
        databaseIdentity,
        state: "receipt-bound",
        error: null,
      };
    } catch (error) {
      return {
        compiled: null,
        activationReceipt: null,
        databaseIdentity: null,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (rosterReceipts.length === 1) {
    try {
      return {
        compiled: active.compiled,
        activationReceipt: reconstructStoredRosterBundleActivationAuthority(
          rosterReceipts[0],
          active.compiled,
        ),
        databaseIdentity,
        state: "receipt-bound",
        error: null,
      };
    } catch (error) {
      return {
        compiled: null,
        activationReceipt: null,
        databaseIdentity: null,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const adoptionRead = await client.from("control_plane_adoption_receipts")
    .select("id")
    .eq("release_manifest_id", releaseManifestDatabaseId)
    .limit(2);
  if (adoptionRead.error) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: `control_plane_adoption_receipts:${adoptionRead.error.message}`,
    };
  }
  const adoptions = adoptionRead.data ?? [];
  if (adoptions.length !== 1) {
    return {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: adoptions.length
        ? "control_plane_adoption_receipts:multiple_for_active_manifest"
        : "active_control_plane:authority_receipt_missing",
    };
  }
  return {
    compiled: active.compiled,
    activationReceipt: null,
    databaseIdentity,
    state: "baseline-active",
    error: null,
  };
}
