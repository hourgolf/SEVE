import {
  compileReleaseManifest,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type JsonObject,
  type ReleaseManifestDraft,
} from "./channelControlPlane";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

export interface Rc54BootstrapSpecRow {
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
  takeProfit: JsonObject;
  stopLoss: JsonObject;
  ratchetParameters: JsonObject;
  reentryPolicy: "disabled" | "bounded";
  scalePolicy: JsonObject;
  collisionDomain: string;
  riskLimits: JsonObject;
  validFrom: string;
  createdBy: string;
  createdAt: string;
  parentVersionKey: string | null;
  contentHash: string;
  status: "draft";
}

export interface Rc54BootstrapManifestRow {
  manifestKey: string;
  releaseId: string;
  cohortId: string;
  workerCompatibilityVersion: string;
  legacyConfigurationHash: string;
  paperLiveAuthority: "paper-only";
  admissionPolicyVersion: string;
  collisionPolicyVersion: string;
  activationBoundary: "next-safe-entry";
  admissionPolicies: JsonObject[];
  rollbackTargetManifestId: string;
  parentManifestKey: string | null;
  manifestJson: JsonObject;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  status: "draft";
}

export interface Rc54ControlPlaneBootstrap {
  compilerVersion: string;
  manifestContentHash: string;
  activationAuthorized: false;
  specs: Rc54BootstrapSpecRow[];
  manifest: Rc54BootstrapManifestRow;
  memberships: Array<{ versionKey: string; ordinal: number }>;
}

function asJsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}

export function buildRc54ControlPlaneBootstrap(): Rc54ControlPlaneBootstrap {
  const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
  const specs: Rc54BootstrapSpecRow[] = compiled.channelSpecs.map((spec) => ({
    versionKey: spec.id,
    channelId: spec.channelId,
    channelSlug: spec.slug,
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
    takeProfit: asJsonObject(spec.takeProfit),
    stopLoss: asJsonObject(spec.stopLoss),
    ratchetParameters: asJsonObject(spec.ratchetParameters),
    reentryPolicy: spec.reentryPolicy,
    scalePolicy: asJsonObject(spec.scalePolicy),
    collisionDomain: spec.collisionDomain,
    riskLimits: asJsonObject(spec.riskLimits),
    validFrom: spec.validFrom,
    createdBy: spec.createdBy,
    createdAt: spec.createdAt,
    parentVersionKey: spec.parentVersionId,
    contentHash: spec.contentHash,
    status: "draft",
  }));
  const manifestJson = {
    ...compiled.manifest,
    status: "draft",
  } as unknown as JsonObject;
  const manifest: Rc54BootstrapManifestRow = {
    manifestKey: compiled.manifest.id,
    releaseId: compiled.manifest.releaseId,
    cohortId: compiled.manifest.cohortId,
    workerCompatibilityVersion: compiled.manifest.workerCompatibilityVersion,
    legacyConfigurationHash: compiled.manifest.legacyConfigurationHash,
    paperLiveAuthority: compiled.manifest.paperLiveAuthority,
    admissionPolicyVersion: compiled.manifest.admissionPolicyVersion,
    collisionPolicyVersion: compiled.manifest.collisionPolicyVersion,
    activationBoundary: compiled.manifest.activationBoundary,
    admissionPolicies: compiled.manifest.admissionPolicies as unknown as JsonObject[],
    rollbackTargetManifestId: compiled.manifest.rollbackTargetManifestId,
    parentManifestKey: compiled.manifest.parentManifestId,
    manifestJson,
    contentHash: compiled.manifest.contentHash,
    createdBy: compiled.manifest.createdBy,
    createdAt: compiled.manifest.createdAt,
    status: "draft",
  };
  return {
    compilerVersion: compiled.compilerVersion,
    manifestContentHash: compiled.manifest.contentHash,
    activationAuthorized: false,
    specs,
    manifest,
    memberships: specs.map((spec, ordinal) => ({ versionKey: spec.versionKey, ordinal })),
  };
}

export function reconstructRc54Bootstrap(
  bootstrap: Rc54ControlPlaneBootstrap,
): CompiledReleaseManifest {
  const specs: ChannelSpecVersionDraft[] = bootstrap.specs.map((spec) => ({
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
    takeProfit: spec.takeProfit as unknown as ChannelSpecVersionDraft["takeProfit"],
    stopLoss: spec.stopLoss as unknown as ChannelSpecVersionDraft["stopLoss"],
    ratchetParameters: spec.ratchetParameters as unknown as ChannelSpecVersionDraft["ratchetParameters"],
    reentryPolicy: spec.reentryPolicy,
    scalePolicy: spec.scalePolicy as unknown as ChannelSpecVersionDraft["scalePolicy"],
    collisionDomain: spec.collisionDomain,
    riskLimits: spec.riskLimits as unknown as ChannelSpecVersionDraft["riskLimits"],
    validFrom: spec.validFrom,
    validUntil: null,
    createdBy: spec.createdBy,
    createdAt: spec.createdAt,
    parentVersionId: spec.parentVersionKey,
    status: "draft",
  }));
  const manifestDraft: ReleaseManifestDraft = {
    schemaVersion: 1,
    id: bootstrap.manifest.manifestKey,
    releaseId: bootstrap.manifest.releaseId,
    cohortId: bootstrap.manifest.cohortId,
    workerCompatibilityVersion: bootstrap.manifest.workerCompatibilityVersion,
    legacyConfigurationHash: bootstrap.manifest.legacyConfigurationHash,
    paperLiveAuthority: bootstrap.manifest.paperLiveAuthority,
    admissionPolicyVersion: bootstrap.manifest.admissionPolicyVersion,
    collisionPolicyVersion: bootstrap.manifest.collisionPolicyVersion,
    activationBoundary: bootstrap.manifest.activationBoundary,
    rollbackTargetManifestId: bootstrap.manifest.rollbackTargetManifestId,
    channelSpecs: specs,
    admissionPolicies: bootstrap.manifest.admissionPolicies as unknown as ReleaseManifestDraft["admissionPolicies"],
    createdBy: bootstrap.manifest.createdBy,
    createdAt: bootstrap.manifest.createdAt,
    parentManifestId: bootstrap.manifest.parentManifestKey,
    status: "draft",
  };
  return compileReleaseManifest(manifestDraft);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: unknown): string {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function sqlNullable(value: string | null): string {
  return value === null ? "null" : sqlString(value);
}

export function renderRc54BootstrapSql(
  bootstrap = buildRc54ControlPlaneBootstrap(),
): string {
  const specValues = bootstrap.specs.map((spec) => `(
    ${sqlString(spec.versionKey)}, ${sqlString(spec.channelId)},
    ${sqlString(spec.channelSlug)}, ${sqlString(spec.strategyIdentity)},
    ${sqlString(spec.strategyVersion)}, ${sqlString(spec.signalVersion)},
    ${sqlString(spec.managerProfileId)}, ${sqlString(spec.managerVersion)},
    ${sqlString(spec.accountId)}, ${sqlString(spec.accountRole)},
    ${sqlString(spec.accountMode)}, ${sqlJson(spec.symbolScope)},
    ${sqlString(spec.familyId)}, ${sqlString(spec.cohort)}, ${spec.priority},
    ${spec.quantity}, ${spec.maxDebitUsd}, ${sqlJson(spec.entryParameters)},
    ${sqlJson(spec.exitParameters)}, ${sqlJson(spec.takeProfit)},
    ${sqlJson(spec.stopLoss)}, ${sqlJson(spec.ratchetParameters)},
    ${sqlString(spec.reentryPolicy)}, ${sqlJson(spec.scalePolicy)},
    ${sqlString(spec.collisionDomain)}, ${sqlJson(spec.riskLimits)},
    ${sqlString(spec.validFrom)}::timestamptz, ${sqlString(spec.createdBy)},
    ${sqlString(spec.createdAt)}::timestamptz, ${sqlNullable(spec.parentVersionKey)},
    ${sqlString(spec.contentHash)}, 'draft'
  )`).join(",\n");
  const membershipValues = bootstrap.memberships
    .map((membership) => `(${sqlString(membership.versionKey)}, ${membership.ordinal})`)
    .join(", ");
  const manifest = bootstrap.manifest;
  const expectedSpecPairs = bootstrap.specs
    .map((spec) => `(${sqlString(spec.versionKey)}, ${sqlString(spec.contentHash)})`)
    .join(", ");
  return `-- GENERATED NO-CHANGE RC5.4 BOOTSTRAP — REVIEW ONLY / UNAPPLIED
-- Persists draft read-only parity. Creates no proposal or activation receipt.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.channel_spec_versions (
  version_key, channel_id, channel_slug, strategy_identity, strategy_version,
  signal_version, manager_profile_id, manager_version, account_id, account_role,
  account_mode, symbol_scope, family_id, cohort, priority, quantity,
  max_debit_usd, entry_parameters, exit_parameters, take_profit, stop_loss,
  ratchet_parameters, reentry_policy, scale_policy, collision_domain,
  risk_limits, valid_from, created_by, created_at, parent_version_id,
  content_hash, status
) values
${specValues}
on conflict do nothing;

insert into public.release_manifests (
  manifest_key, release_id, cohort_id, worker_compatibility_version,
  legacy_configuration_hash, paper_live_authority, admission_policy_version,
  collision_policy_version, activation_boundary, admission_policies,
  rollback_target_manifest_id, parent_manifest_id, manifest_json, content_hash,
  created_by, created_at, status
) values (
  ${sqlString(manifest.manifestKey)}, ${sqlString(manifest.releaseId)},
  ${sqlString(manifest.cohortId)}, ${sqlString(manifest.workerCompatibilityVersion)},
  ${sqlString(manifest.legacyConfigurationHash)}, ${sqlString(manifest.paperLiveAuthority)},
  ${sqlString(manifest.admissionPolicyVersion)}, ${sqlString(manifest.collisionPolicyVersion)},
  ${sqlString(manifest.activationBoundary)}, ${sqlJson(manifest.admissionPolicies)},
  ${sqlString(manifest.rollbackTargetManifestId)}, ${sqlNullable(manifest.parentManifestKey)},
  ${sqlJson(manifest.manifestJson)}, ${sqlString(manifest.contentHash)},
  ${sqlString(manifest.createdBy)}, ${sqlString(manifest.createdAt)}::timestamptz,
  'draft'
)
on conflict do nothing;

insert into public.release_manifest_channels (
  release_manifest_id, channel_spec_version_id, ordinal
)
select manifest.id, spec.id, expected.ordinal
from (values ${membershipValues}) as expected(version_key, ordinal)
join public.channel_spec_versions spec
  on spec.version_key = expected.version_key
join public.release_manifests manifest
  on manifest.manifest_key = ${sqlString(manifest.manifestKey)}
on conflict do nothing;

do $bootstrap$
begin
  if (
    select count(*)
    from (values ${expectedSpecPairs}) as expected(version_key, content_hash)
    join public.channel_spec_versions spec
      on spec.version_key = expected.version_key
     and spec.content_hash = expected.content_hash
     and spec.status = 'draft'
  ) <> ${bootstrap.specs.length} then
    raise exception 'RC5.4 bootstrap spec parity failed';
  end if;
  if not exists (
    select 1 from public.release_manifests
    where manifest_key = ${sqlString(manifest.manifestKey)}
      and content_hash = ${sqlString(manifest.contentHash)}
      and manifest_json = ${sqlJson(manifest.manifestJson)}
      and admission_policies = ${sqlJson(manifest.admissionPolicies)}
      and status = 'draft'
  ) then
    raise exception 'RC5.4 bootstrap manifest parity failed';
  end if;
  if (
    select count(*)
    from (values ${membershipValues}) as expected(version_key, ordinal)
    join public.channel_spec_versions spec
      on spec.version_key = expected.version_key
    join public.release_manifest_channels membership
      on membership.channel_spec_version_id = spec.id
     and membership.ordinal = expected.ordinal
    join public.release_manifests manifest
      on manifest.id = membership.release_manifest_id
    where manifest.manifest_key = ${sqlString(manifest.manifestKey)}
  ) <> ${bootstrap.memberships.length} then
    raise exception 'RC5.4 bootstrap membership parity failed';
  end if;
  if exists (
    select 1 from public.activation_receipts receipt
    join public.release_manifests manifest
      on manifest.id = receipt.release_manifest_id
    where manifest.manifest_key = ${sqlString(manifest.manifestKey)}
  ) then
    raise exception 'RC5.4 bootstrap must not create activation authority';
  end if;
end
$bootstrap$;

commit;
`;
}
