import {
  canonicalJson,
  type ActivationReceipt,
  type CompiledReleaseManifest,
} from "./channelControlPlane";
import type {
  EntryPolicyStamp,
  ShadowRuntimeProjection,
} from "./channelActivation";

const SHA256 = /^sha256:[0-9a-f]{64}$/;

export type ConfigurationEvidenceKind =
  | "candidate"
  | "order"
  | "fill"
  | "position"
  | "close"
  | "held-path"
  | "manager-observation";

export interface ConfigurationEpochIdentity {
  identityVersion: 1;
  releaseManifestId: string;
  releaseManifestContentHash: string;
  channelSpecVersionId: string;
  channelSpecContentHash: string;
  configurationEpochId: string;
  channelSlug: string;
  accountId: string;
  managerProfileId: string;
  managerVersion: string;
}

export interface ConfigurationEvidenceStamp {
  stampVersion: 1;
  evidenceKind: ConfigurationEvidenceKind;
  evidenceId: string;
  traceId: string;
  positionId: string | null;
  observedAt: string;
  configuration: Readonly<ConfigurationEpochIdentity>;
}

export interface ConfigurationEvidenceChainValidation {
  state: "pass" | "block";
  blockers: string[];
  configuration: Readonly<ConfigurationEpochIdentity> | null;
  evidenceKinds: ConfigurationEvidenceKind[];
}

function immutableCopy<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function validateIdentity(identity: ConfigurationEpochIdentity): string[] {
  const blockers: string[] = [];
  if (identity.identityVersion !== 1) blockers.push("configuration_identity:schema");
  if (!identity.releaseManifestId.trim()) blockers.push("configuration_identity:manifest_id");
  if (!SHA256.test(identity.releaseManifestContentHash)) blockers.push("configuration_identity:manifest_hash");
  if (!identity.channelSpecVersionId.trim()) blockers.push("configuration_identity:spec_id");
  if (!SHA256.test(identity.channelSpecContentHash)) blockers.push("configuration_identity:spec_hash");
  if (!SHA256.test(identity.configurationEpochId)) blockers.push("configuration_identity:epoch");
  if (!identity.channelSlug.trim()) blockers.push("configuration_identity:channel");
  if (!identity.accountId.trim()) blockers.push("configuration_identity:account");
  if (!identity.managerProfileId.trim()) blockers.push("configuration_identity:manager_profile");
  if (!SHA256.test(identity.managerVersion)) blockers.push("configuration_identity:manager_version");
  return blockers;
}

/**
 * Resolves one exact configuration identity from one compiled manifest. There
 * is no mutable strategist/account fallback.
 */
export function buildConfigurationEpochIdentity(input: {
  compiled: CompiledReleaseManifest;
  projection: Readonly<ShadowRuntimeProjection>;
  channelSlug: string;
  activationReceipt: Readonly<ActivationReceipt> | null;
}): Readonly<ConfigurationEpochIdentity> {
  const receipt = input.activationReceipt;
  if (!receipt) throw new Error("configuration identity requires an immutable activation receipt");
  if (input.compiled.manifest.id !== input.projection.manifestId
      || input.compiled.manifest.contentHash !== input.projection.manifestContentHash) {
    throw new Error("configuration identity requires an exact manifest projection");
  }
  if (receipt.releaseManifestId !== input.compiled.manifest.id
      || receipt.manifestContentHash !== input.compiled.manifest.contentHash
      || receipt.configurationEpochId !== input.projection.configurationEpochId) {
    throw new Error("configuration identity activation receipt disagrees with projection");
  }
  if (!input.compiled.channelSpecs.some((spec) => spec.id === receipt.newSpecVersionId
      && spec.contentHash === receipt.newContentHash)) {
    throw new Error("configuration identity activation receipt lacks the activated specification");
  }
  if (!Number.isFinite(Date.parse(receipt.activatedAt))) {
    throw new Error("configuration identity activation receipt has an invalid timestamp");
  }
  const spec = input.compiled.channelSpecs.find((candidate) => candidate.slug === input.channelSlug);
  if (!spec) throw new Error(`configuration identity missing channel ${input.channelSlug}`);
  const identity: ConfigurationEpochIdentity = {
    identityVersion: 1,
    releaseManifestId: input.compiled.manifest.id,
    releaseManifestContentHash: input.compiled.manifest.contentHash,
    channelSpecVersionId: spec.id,
    channelSpecContentHash: spec.contentHash,
    configurationEpochId: input.projection.configurationEpochId,
    channelSlug: spec.slug,
    accountId: spec.accountId,
    managerProfileId: spec.managerProfileId,
    managerVersion: spec.managerVersion,
  };
  const blockers = validateIdentity(identity);
  if (blockers.length) throw new Error(`invalid configuration identity: ${blockers.join(",")}`);
  return immutableCopy(identity);
}

export function configurationIdentityFromEntryStamp(
  entry: Readonly<EntryPolicyStamp>,
): Readonly<ConfigurationEpochIdentity> {
  const identity: ConfigurationEpochIdentity = {
    identityVersion: 1,
    releaseManifestId: entry.releaseManifestId,
    releaseManifestContentHash: entry.releaseManifestContentHash,
    channelSpecVersionId: entry.channelSpecVersionId,
    channelSpecContentHash: entry.channelSpecContentHash,
    configurationEpochId: entry.configurationEpochId,
    channelSlug: entry.channelSlug,
    accountId: entry.accountId,
    managerProfileId: entry.managerProfileId,
    managerVersion: entry.managerVersion,
  };
  const blockers = validateIdentity(identity);
  if (blockers.length) throw new Error(`entry stamp lacks configuration identity: ${blockers.join(",")}`);
  return immutableCopy(identity);
}

/**
 * Pure append-only stamp used by candidate, order, fill, position, close, held
 * path, and manager-observation adapters. Persistence remains the adapter's
 * responsibility.
 */
export function stampConfigurationEvidence(input: {
  evidenceKind: ConfigurationEvidenceKind;
  evidenceId: string;
  traceId: string;
  positionId?: string | null;
  observedAt: string;
  configuration: Readonly<ConfigurationEpochIdentity>;
}): Readonly<ConfigurationEvidenceStamp> {
  const blockers = validateIdentity(input.configuration as ConfigurationEpochIdentity);
  if (blockers.length) throw new Error(`cannot stamp invalid configuration identity: ${blockers.join(",")}`);
  if (!input.evidenceId.trim()) throw new Error("configuration evidence requires an evidence id");
  if (!input.traceId.trim()) throw new Error("configuration evidence requires a trace id");
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new Error("configuration evidence requires a valid timestamp");
  }
  if (["position", "close", "held-path", "manager-observation"].includes(input.evidenceKind)
      && !input.positionId?.trim()) {
    throw new Error(`${input.evidenceKind} evidence requires an immutable position id`);
  }
  return immutableCopy({
    stampVersion: 1,
    evidenceKind: input.evidenceKind,
    evidenceId: input.evidenceId,
    traceId: input.traceId,
    positionId: input.positionId ?? null,
    observedAt: input.observedAt,
    configuration: input.configuration,
  });
}

/**
 * Fails closed if a lifecycle mixes configuration epochs or position routes.
 * Missing evidence is also blocking when callers provide requiredKinds.
 */
export function validateConfigurationEvidenceChain(input: {
  stamps: Array<Readonly<ConfigurationEvidenceStamp>>;
  requiredKinds?: ConfigurationEvidenceKind[];
}): Readonly<ConfigurationEvidenceChainValidation> {
  const blockers: string[] = [];
  if (!input.stamps.length) blockers.push("configuration_evidence:missing");
  const first = input.stamps[0] ?? null;
  const firstIdentity = first?.configuration ?? null;
  const seenIds = new Set<string>();
  const routedPositions = new Set<string>();
  for (const stamp of input.stamps) {
    if (stamp.stampVersion !== 1) blockers.push(`configuration_evidence:schema:${stamp.evidenceId}`);
    if (seenIds.has(stamp.evidenceId)) blockers.push(`configuration_evidence:duplicate:${stamp.evidenceId}`);
    seenIds.add(stamp.evidenceId);
    if (firstIdentity && canonicalJson(stamp.configuration) !== canonicalJson(firstIdentity)) {
      blockers.push(`configuration_evidence:epoch_disagreement:${stamp.evidenceId}`);
    }
    if (stamp.positionId) routedPositions.add(stamp.positionId);
  }
  if (routedPositions.size > 1) blockers.push("configuration_evidence:position_disagreement");
  const evidenceKinds = [...new Set(input.stamps.map((stamp) => stamp.evidenceKind))].sort() as ConfigurationEvidenceKind[];
  for (const kind of input.requiredKinds ?? []) {
    if (!evidenceKinds.includes(kind)) blockers.push(`configuration_evidence:missing_kind:${kind}`);
  }
  return immutableCopy({
    state: blockers.length ? "block" : "pass",
    blockers,
    configuration: blockers.length ? null : firstIdentity,
    evidenceKinds,
  });
}
