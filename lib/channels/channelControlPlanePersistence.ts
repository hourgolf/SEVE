import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalJson,
  compileReleaseManifest,
  type ChannelSpecStatus,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type JsonObject,
  type ReleaseManifestDraft,
} from "./channelControlPlane";

export interface StoredControlPlaneRead {
  compiled: CompiledReleaseManifest | null;
  state: "active" | "not-adopted" | "failed";
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
  "valid_from",
  "valid_until",
  "created_by",
  "created_at",
  "content_hash",
  "status",
  "parent:parent_version_id(version_key)",
].join(",");

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
  const specsRead = await client.from("channel_spec_versions")
    .select(SPEC_SELECT)
    .in("id", specIds);
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
