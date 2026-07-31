import { createHash } from "node:crypto";

export const CHANNEL_CONTROL_PLANE_SCHEMA_VERSION = 1 as const;
export const CHANNEL_CONTROL_PLANE_COMPILER_VERSION = "channel-control-plane-compiler-v1" as const;

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ChannelSpecStatus =
  | "draft"
  | "validated"
  | "scheduled"
  | "active"
  | "superseded"
  | "rejected"
  | "rolled_back";

export type ChangeClass =
  | "presentation-only"
  | "bounded-parameter"
  | "governed-operational-policy"
  | "code-strategy-logic";

export type ValidationGate =
  | "schema"
  | "risk"
  | "capacity"
  | "account-authority"
  | "collision"
  | "reentry-scaling"
  | "replay-sufficiency"
  | "evidence-readiness"
  | "safe-boundary"
  | "rollback";

export type ValidationGateState = "pass" | "block" | "not-run";

export interface ValidationGateResult {
  gate: ValidationGate;
  state: ValidationGateState;
  code: string;
  fact: string;
  evidenceRefs: string[];
}

export interface ChannelTakeProfitPolicy {
  kind: "ride" | "bank";
  targetPct: number | null;
  fraction: 0 | 0.5;
}

export interface ChannelStopLossPolicy {
  catastrophePct: number;
  priceBasis: "executable-option-bid";
}

export interface ChannelRatchetPolicy {
  kind: "none" | "a13" | "fixed-target" | "native-atr";
  engageReturnPct: number | null;
  givebackPct: number | null;
  retainGainPct: number | null;
  fixedTargetPct: number | null;
}

export function managerPolicyContentHash(input: {
  managerProfileId: string;
  takeProfit: ChannelTakeProfitPolicy;
  stopLoss: ChannelStopLossPolicy;
  ratchetParameters: ChannelRatchetPolicy;
  liquidationEt: unknown;
}): string {
  return contentHash({
    profileId: input.managerProfileId,
    takeProfit: input.takeProfit,
    stopLoss: input.stopLoss,
    ratchetParameters: input.ratchetParameters,
    liquidationEt: input.liquidationEt ?? null,
    priceBasis: "executable-option-bid",
  });
}

export interface ChannelScalePolicy {
  adds: number;
  pyramiding: "disabled" | "bounded";
}

export interface ChannelRiskLimits {
  maxContracts: number;
  maxDebitUsd: number;
  maxRiskUsd: number;
}

export interface ChannelSpecVersion {
  schemaVersion: typeof CHANNEL_CONTROL_PLANE_SCHEMA_VERSION;
  id: string;
  channelId: string;
  slug: string;
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
  takeProfit: ChannelTakeProfitPolicy;
  stopLoss: ChannelStopLossPolicy;
  ratchetParameters: ChannelRatchetPolicy;
  reentryPolicy: "disabled" | "bounded";
  scalePolicy: ChannelScalePolicy;
  collisionDomain: string;
  riskLimits: ChannelRiskLimits;
  /**
   * Omitted on the sealed RC5.4 baseline so its historic semantic hashes stay
   * byte-stable. A proposal may explicitly pause or resume new paper entries;
   * this never controls research collection.
   */
  executionPosture?: "paper" | "observe-only";
  validFrom: string;
  validUntil: string | null;
  createdBy: string;
  createdAt: string;
  parentVersionId: string | null;
  contentHash: string;
  status: ChannelSpecStatus;
}

export type ChannelSpecVersionDraft = Omit<ChannelSpecVersion, "contentHash">;

export interface AdmissionPolicySpec {
  id: string;
  enabledForNewEntries: boolean;
  maxOpenPerFamily: number;
  maxOpenByUnderlying: Record<string, number>;
  maxOpenGlobal: number;
  sameOccOpenMax: number;
  reentry: "disabled" | "bounded";
  sameClockMaxByUnderlying: Record<string, number>;
  priorityBySlug: Record<string, number>;
  crossDomainSameOcc: "block" | "allow-with-receipt";
}

export interface ReleaseManifest {
  schemaVersion: typeof CHANNEL_CONTROL_PLANE_SCHEMA_VERSION;
  id: string;
  releaseId: string;
  cohortId: string;
  workerCompatibilityVersion: string;
  legacyConfigurationHash: string;
  paperLiveAuthority: "paper-only";
  admissionPolicyVersion: string;
  collisionPolicyVersion: string;
  activationBoundary: "next-safe-entry";
  rollbackTargetManifestId: string;
  channelSpecVersionIds: string[];
  channelSpecContentHashes: string[];
  admissionPolicies: AdmissionPolicySpec[];
  createdBy: string;
  createdAt: string;
  parentManifestId: string | null;
  contentHash: string;
  status: ChannelSpecStatus;
}

export interface ReleaseManifestDraft extends Omit<
  ReleaseManifest,
  "channelSpecVersionIds" | "channelSpecContentHashes" | "contentHash"
> {
  channelSpecs: ChannelSpecVersionDraft[];
}

export interface ProposalReplaySummary {
  state: "not-run" | "sufficient" | "insufficient" | "censored";
  exactSamples: number;
  censoredSamples: number;
  limitations: string[];
  evidenceRefs: string[];
}

export interface ChannelChangeProposal {
  schemaVersion: typeof CHANNEL_CONTROL_PLANE_SCHEMA_VERSION;
  id: string;
  baseSpecVersionId: string;
  baseSpecContentHash: string;
  proposedSpecVersionId: string;
  proposedPatch: Partial<Omit<
    ChannelSpecVersionDraft,
    "schemaVersion" | "id" | "channelId" | "slug" | "createdAt" | "createdBy"
    | "parentVersionId" | "status" | "validFrom" | "validUntil"
  >>;
  reason: string;
  evidenceRefs: string[];
  authorKind: "operator" | "sentinel" | "system";
  authorId: string;
  changeClass: ChangeClass;
  validationResults: ValidationGateResult[];
  replaySummary: ProposalReplaySummary;
  approvalState: "draft" | "validated" | "approved" | "rejected" | "canceled";
  requestedActivationBoundary: "next-safe-entry";
  createdAt: string;
  activationAuthorized: false;
}

export interface ActivationReceipt {
  schemaVersion: typeof CHANNEL_CONTROL_PLANE_SCHEMA_VERSION;
  id: string;
  configurationEpochId: string;
  proposalId: string;
  oldSpecVersionId: string;
  newSpecVersionId: string;
  releaseManifestId: string;
  exactDiff: JsonObject;
  validationResults: ValidationGateResult[];
  validatorVersions: string[];
  approvedBy: string;
  scheduledFor: string;
  activatedAt: string;
  safeBoundaryProof: JsonObject;
  workerAcknowledgement: JsonObject;
  rollbackTargetManifestId: string;
  oldContentHash: string;
  newContentHash: string;
  manifestContentHash: string;
}

/** JSON-schema-shaped contracts are checked in beside the TypeScript types so
 * a future API/database adapter can validate untrusted payloads without
 * inventing a second field list. The disabled slice does not expose an API. */
export const CHANNEL_SPEC_VERSION_SCHEMA = {
  $id: "seve/channel-spec-version/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "id", "channelId", "slug", "strategyIdentity",
    "strategyVersion", "signalVersion", "managerProfileId", "managerVersion",
    "accountId", "accountRole", "accountMode", "symbolScope", "familyId",
    "cohort", "priority", "quantity", "maxDebitUsd", "entryParameters",
    "exitParameters", "takeProfit", "stopLoss", "ratchetParameters",
    "reentryPolicy", "scalePolicy", "collisionDomain", "riskLimits",
    "validFrom", "validUntil", "createdBy", "createdAt", "parentVersionId",
    "contentHash", "status",
  ],
  properties: {
    schemaVersion: { const: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION },
    contentHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    accountMode: { const: "paper" },
    executionPosture: { enum: ["paper", "observe-only"] },
    quantity: { type: "integer", minimum: 1 },
    maxDebitUsd: { type: "number", exclusiveMinimum: 0 },
  },
} as const;

export const RELEASE_MANIFEST_SCHEMA = {
  $id: "seve/release-manifest/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "id", "releaseId", "cohortId",
    "workerCompatibilityVersion", "legacyConfigurationHash",
    "paperLiveAuthority", "admissionPolicyVersion", "collisionPolicyVersion",
    "activationBoundary", "rollbackTargetManifestId", "channelSpecVersionIds",
    "channelSpecContentHashes", "admissionPolicies", "createdBy", "createdAt",
    "parentManifestId", "contentHash", "status",
  ],
  properties: {
    schemaVersion: { const: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION },
    paperLiveAuthority: { const: "paper-only" },
    activationBoundary: { const: "next-safe-entry" },
    contentHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  },
} as const;

export const CHANNEL_CHANGE_PROPOSAL_SCHEMA = {
  $id: "seve/channel-change-proposal/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "id", "baseSpecVersionId", "baseSpecContentHash",
    "proposedSpecVersionId", "proposedPatch", "reason", "evidenceRefs",
    "authorKind", "authorId", "changeClass", "validationResults",
    "replaySummary", "approvalState", "requestedActivationBoundary",
    "createdAt", "activationAuthorized",
  ],
  properties: {
    schemaVersion: { const: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION },
    activationAuthorized: { const: false },
    requestedActivationBoundary: { const: "next-safe-entry" },
  },
} as const;

export const ACTIVATION_RECEIPT_SCHEMA = {
  $id: "seve/activation-receipt/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "id", "configurationEpochId", "proposalId",
    "oldSpecVersionId", "newSpecVersionId", "releaseManifestId", "exactDiff",
    "validationResults", "validatorVersions", "approvedBy", "scheduledFor",
    "activatedAt", "safeBoundaryProof", "workerAcknowledgement",
    "rollbackTargetManifestId", "oldContentHash", "newContentHash",
    "manifestContentHash",
  ],
  properties: {
    schemaVersion: { const: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION },
    configurationEpochId: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  },
} as const;

function canonical(value: unknown): string {
  if (value === undefined) throw new Error("undefined is not canonical JSON");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("non-JSON value in canonical payload");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonical(value);
}

export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const LEGACY_SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPEC_STATUSES = new Set<ChannelSpecStatus>([
  "draft", "validated", "scheduled", "active", "superseded", "rejected", "rolled_back",
]);

function semanticChannelSpec(spec: ChannelSpecVersionDraft | ChannelSpecVersion): JsonObject {
  return {
    schemaVersion: spec.schemaVersion,
    channelId: spec.channelId,
    slug: spec.slug,
    strategyIdentity: spec.strategyIdentity,
    strategyVersion: spec.strategyVersion,
    signalVersion: spec.signalVersion,
    managerProfileId: spec.managerProfileId,
    managerVersion: spec.managerVersion,
    accountId: spec.accountId,
    accountRole: spec.accountRole,
    accountMode: spec.accountMode,
    symbolScope: [...spec.symbolScope].sort(),
    familyId: spec.familyId,
    cohort: spec.cohort,
    priority: spec.priority,
    quantity: spec.quantity,
    maxDebitUsd: spec.maxDebitUsd,
    entryParameters: spec.entryParameters,
    exitParameters: spec.exitParameters,
    takeProfit: spec.takeProfit as unknown as JsonObject,
    stopLoss: spec.stopLoss as unknown as JsonObject,
    ratchetParameters: spec.ratchetParameters as unknown as JsonObject,
    reentryPolicy: spec.reentryPolicy,
    scalePolicy: spec.scalePolicy as unknown as JsonObject,
    collisionDomain: spec.collisionDomain,
    riskLimits: spec.riskLimits as unknown as JsonObject,
    ...(spec.executionPosture && spec.executionPosture !== "paper"
      ? { executionPosture: spec.executionPosture }
      : {}),
  };
}

function validateSpecShape(spec: ChannelSpecVersion): string[] {
  const errors: string[] = [];
  if (spec.schemaVersion !== CHANNEL_CONTROL_PLANE_SCHEMA_VERSION) errors.push(`${spec.slug}:schema_version`);
  if (spec.executionPosture != null
      && spec.executionPosture !== "paper"
      && spec.executionPosture !== "observe-only") {
    errors.push(`${spec.slug}:execution_posture`);
  }
  for (const [name, value] of [
    ["id", spec.id], ["channel_id", spec.channelId], ["slug", spec.slug],
    ["strategy_identity", spec.strategyIdentity], ["strategy_version", spec.strategyVersion],
    ["signal_version", spec.signalVersion], ["manager_profile", spec.managerProfileId],
    ["manager_version", spec.managerVersion], ["account_role", spec.accountRole],
    ["family", spec.familyId], ["collision_domain", spec.collisionDomain],
    ["created_by", spec.createdBy],
  ] as const) if (!IDENTIFIER.test(value)) errors.push(`${spec.slug}:${name}`);
  if (!UUID.test(spec.accountId)) errors.push(`${spec.slug}:account_id`);
  if (!Number.isInteger(spec.priority) || spec.priority < 1) errors.push(`${spec.slug}:priority`);
  if (!Number.isInteger(spec.quantity) || spec.quantity < 1) errors.push(`${spec.slug}:quantity`);
  if (!Number.isFinite(spec.maxDebitUsd) || spec.maxDebitUsd <= 0) errors.push(`${spec.slug}:max_debit`);
  if (!SPEC_STATUSES.has(spec.status)) errors.push(`${spec.slug}:status`);
  if (!spec.symbolScope.length || spec.symbolScope.some((symbol) => !/^[A-Z]{1,8}$/.test(symbol))) {
    errors.push(`${spec.slug}:symbol_scope`);
  }
  const entryDte = Number(spec.entryParameters.entryDte);
  const strikeOffset = Number(spec.entryParameters.strikeOffset);
  const premiumCap = Number(spec.entryParameters.premiumCap);
  if ((entryDte !== 0 && entryDte !== 1) || !Number.isInteger(strikeOffset)
      || !Number.isFinite(premiumCap) || premiumCap <= 0) errors.push(`${spec.slug}:entry_parameters`);
  if (typeof spec.exitParameters.accountName !== "string"
      || typeof spec.exitParameters.managerLabel !== "string"
      || !/^\d{2}:\d{2}$/.test(String(spec.exitParameters.eodEt ?? ""))) {
    errors.push(`${spec.slug}:exit_parameters`);
  }
  if (!Number.isFinite(Date.parse(spec.validFrom)) || !Number.isFinite(Date.parse(spec.createdAt))) {
    errors.push(`${spec.slug}:timestamp`);
  }
  if (spec.validUntil != null && (!Number.isFinite(Date.parse(spec.validUntil))
      || Date.parse(spec.validUntil) <= Date.parse(spec.validFrom))) errors.push(`${spec.slug}:valid_until`);
  if (!SHA256.test(spec.contentHash)) errors.push(`${spec.slug}:content_hash_format`);
  if (contentHash(semanticChannelSpec(spec)) !== spec.contentHash) errors.push(`${spec.slug}:content_hash_mismatch`);
  return errors;
}

function gate(
  gateName: ValidationGate,
  state: ValidationGateState,
  code: string,
  fact: string,
  evidenceRefs: string[] = [],
): ValidationGateResult {
  return { gate: gateName, state, code, fact, evidenceRefs: [...evidenceRefs].sort() };
}

export interface DynamicReadinessEvidence {
  replaySufficiency?: { ok: boolean; fact: string; evidenceRefs: string[] };
  evidenceReadiness?: { ok: boolean; fact: string; evidenceRefs: string[] };
  safeBoundary?: { ok: boolean; fact: string; evidenceRefs: string[] };
}

export interface WorkerChannelProjection {
  slug: string;
  cohort: "control" | "lab";
  domainId: string;
  familyId: string;
  underlying: string;
  priority: number;
  entryDte: number;
  strikeOffset: number;
  maxEntriesPerSession: number;
  quantity: number;
  premiumCap: number;
  aggregateDebitCap: number;
  takeProfit: ChannelTakeProfitPolicy;
  stopLoss: ChannelStopLossPolicy;
  ratchetParameters: ChannelRatchetPolicy;
  riskLimits: ChannelRiskLimits;
  managerProfileId: string;
  strategistId: string;
  accountId: string;
  executionPosture: "paper" | "observe-only";
  channelSpecVersionId: string;
  channelSpecContentHash: string;
}

/**
 * RC5.4 specifications predate the numeric re-entry cap. Missing values retain
 * the sealed one-entry behavior without changing their semantic content hash.
 * Bounded re-entry must be explicit and is capped at three entries per session.
 */
export function maxEntriesPerSessionForSpec(
  spec: Pick<ChannelSpecVersion, "entryParameters" | "reentryPolicy">,
): number | null {
  const raw = spec.entryParameters.maxEntriesPerSession;
  if (raw == null) return spec.reentryPolicy === "disabled" ? 1 : null;
  if (!Number.isInteger(raw)) return null;
  const value = Number(raw);
  if (spec.reentryPolicy === "disabled") return value === 1 ? 1 : null;
  return value >= 2 && value <= 3 ? value : null;
}

export function projectAdmissionPolicyReentry(
  policies: readonly AdmissionPolicySpec[],
  specs: readonly Pick<ChannelSpecVersionDraft, "collisionDomain" | "reentryPolicy">[],
): AdmissionPolicySpec[] {
  return policies.map((policy) => ({
    ...policy,
    reentry: specs.some((spec) =>
      spec.collisionDomain === policy.id && spec.reentryPolicy === "bounded")
      ? "bounded"
      : "disabled",
  }));
}

export interface DashboardChannelProjection extends WorkerChannelProjection {
  accountName: string;
  riskBudgetUsd: number;
  premiumStopPct: number;
  bankTargetPct: number | null;
  runner: "none" | "a13" | "fixed-50" | "native-atr";
  runnerFraction: 0 | 0.5;
  managerLabel: string;
  eodEt: string;
}

export interface CompiledReleaseManifest {
  compilerVersion: typeof CHANNEL_CONTROL_PLANE_COMPILER_VERSION;
  manifest: ReleaseManifest;
  channelSpecs: ChannelSpecVersion[];
  validationResults: ValidationGateResult[];
  validationReady: boolean;
  activationAuthorized: false;
  workerProjection: {
    releaseId: string;
    cohortId: string;
    workerCompatibilityVersion: string;
    legacyConfigurationHash: string;
    manifestContentHash: string;
    roots: WorkerChannelProjection[];
    admissionPolicies: AdmissionPolicySpec[];
    activationAuthorized: false;
  };
  dashboardProjection: {
    releaseId: string;
    workerCompatibilityVersion: string;
    legacyConfigurationHash: string;
    manifestContentHash: string;
    roots: DashboardChannelProjection[];
    activationAuthorized: false;
  };
}

function runtimeRunner(spec: ChannelSpecVersion): DashboardChannelProjection["runner"] {
  if (spec.ratchetParameters.kind === "a13") return "a13";
  if (spec.ratchetParameters.kind === "fixed-target") return "fixed-50";
  if (spec.ratchetParameters.kind === "native-atr") return "native-atr";
  return "none";
}

function compileValidation(
  manifest: ReleaseManifest,
  specs: ChannelSpecVersion[],
  readiness?: DynamicReadinessEvidence,
): ValidationGateResult[] {
  const schemaErrors = specs.flatMap(validateSpecShape);
  if (manifest.schemaVersion !== CHANNEL_CONTROL_PLANE_SCHEMA_VERSION) schemaErrors.push("manifest:schema_version");
  if (!IDENTIFIER.test(manifest.id) || !IDENTIFIER.test(manifest.releaseId)
      || !IDENTIFIER.test(manifest.cohortId) || !IDENTIFIER.test(manifest.workerCompatibilityVersion)) {
    schemaErrors.push("manifest:identity");
  }
  if (!LEGACY_SHA256.test(manifest.legacyConfigurationHash)) schemaErrors.push("manifest:legacy_hash");
  if (!SHA256.test(manifest.contentHash)) schemaErrors.push("manifest:content_hash");
  if (new Set(specs.map((spec) => spec.id)).size !== specs.length) schemaErrors.push("spec:duplicate_id");
  if (new Set(specs.map((spec) => spec.slug)).size !== specs.length) schemaErrors.push("spec:duplicate_slug");

  const riskErrors = specs.flatMap((spec) => {
    const errors: string[] = [];
    if (!Number.isInteger(spec.riskLimits.maxContracts) || spec.riskLimits.maxContracts < spec.quantity) {
      errors.push(`${spec.slug}:contract_envelope`);
    }
    if (!(spec.riskLimits.maxDebitUsd >= spec.maxDebitUsd) || !(spec.riskLimits.maxRiskUsd > 0)
        || spec.riskLimits.maxRiskUsd > spec.riskLimits.maxDebitUsd) errors.push(`${spec.slug}:risk_envelope`);
    const projectedDebitUsd = Number(spec.entryParameters.premiumCap) * spec.quantity * 100;
    if (!Number.isFinite(projectedDebitUsd) || Math.abs(projectedDebitUsd - spec.maxDebitUsd) > 0.01) {
      errors.push(`${spec.slug}:premium_debit_projection`);
    }
    if (spec.takeProfit.kind === "ride" && (spec.takeProfit.targetPct !== null || spec.takeProfit.fraction !== 0)) {
      errors.push(`${spec.slug}:ride_target`);
    }
    if (spec.takeProfit.kind === "bank" && (!(Number(spec.takeProfit.targetPct) >= 5)
        || !(Number(spec.takeProfit.targetPct) <= 300) || spec.takeProfit.fraction !== 0.5)) {
      errors.push(`${spec.slug}:bank_target`);
    }
    if (!(spec.stopLoss.catastrophePct >= 10 && spec.stopLoss.catastrophePct <= 90)) {
      errors.push(`${spec.slug}:catastrophe_stop`);
    }
    return errors;
  });

  const policies = new Map(manifest.admissionPolicies.map((policy) => [policy.id, policy]));
  const capacityErrors = specs.flatMap((spec) => {
    const policy = policies.get(spec.collisionDomain);
    if (!policy) return [`${spec.slug}:domain_missing`];
    const underlying = spec.symbolScope[0] ?? "";
    return (policy.maxOpenByUnderlying[underlying] ?? 0) < 1
      || (policy.sameClockMaxByUnderlying[underlying] ?? 0) < 1
      ? [`${spec.slug}:underlying_capacity`] : [];
  });

  const accountErrors = manifest.paperLiveAuthority !== "paper-only"
    ? ["manifest:not_paper_only"]
    : specs.filter((spec) => spec.accountMode !== "paper").map((spec) => `${spec.slug}:not_paper`);

  const collisionErrors: string[] = [];
  if (policies.size !== manifest.admissionPolicies.length) collisionErrors.push("manifest:duplicate_domain_policy");
  for (const policy of manifest.admissionPolicies) {
    if (!policy.enabledForNewEntries || policy.maxOpenPerFamily < 1 || policy.maxOpenGlobal < 1
        || policy.sameOccOpenMax < 1) collisionErrors.push(`${policy.id}:limits`);
    const roots = specs.filter((spec) => spec.collisionDomain === policy.id);
    for (const spec of roots) {
      if (policy.priorityBySlug[spec.slug] !== spec.priority) collisionErrors.push(`${spec.slug}:priority_projection`);
    }
    const expectedPrioritySlugs = roots.map((spec) => spec.slug).sort();
    const actualPrioritySlugs = Object.keys(policy.priorityBySlug).sort();
    if (canonicalJson(expectedPrioritySlugs) !== canonicalJson(actualPrioritySlugs)) {
      collisionErrors.push(`${policy.id}:priority_roster`);
    }
    const priorityKeys = new Set<string>();
    for (const spec of roots) {
      const key = `${spec.symbolScope[0] ?? ""}:${spec.priority}`;
      if (priorityKeys.has(key)) collisionErrors.push(`${policy.id}:duplicate_underlying_priority:${key}`);
      priorityKeys.add(key);
    }
  }

  const compatibilityErrors = specs.filter((spec) => {
    const policy = policies.get(spec.collisionDomain);
    const maxEntries = maxEntriesPerSessionForSpec(spec);
    return maxEntries == null
      || (spec.reentryPolicy === "disabled" && spec.scalePolicy.adds !== 0)
      || (spec.scalePolicy.pyramiding === "disabled" && spec.scalePolicy.adds !== 0)
      || (policy?.reentry === "disabled" && spec.reentryPolicy !== "disabled");
  }).map((spec) => `${spec.slug}:reentry_scale_conflict`);

  for (const spec of specs) {
    const ratchet = spec.ratchetParameters;
    if (ratchet.kind === "none" && [ratchet.engageReturnPct, ratchet.givebackPct,
      ratchet.retainGainPct, ratchet.fixedTargetPct].some((value) => value !== null)) {
      compatibilityErrors.push(`${spec.slug}:ratchet_none_payload`);
    }
    if (ratchet.kind === "a13" && (ratchet.engageReturnPct !== 50
        || ratchet.givebackPct !== 33 || ratchet.retainGainPct !== 67
        || ratchet.fixedTargetPct !== null)) compatibilityErrors.push(`${spec.slug}:ratchet_a13_payload`);
    if (ratchet.kind === "fixed-target" && (!(Number(ratchet.fixedTargetPct) > 0)
        || ratchet.engageReturnPct !== null || ratchet.givebackPct !== null
        || ratchet.retainGainPct !== null)) compatibilityErrors.push(`${spec.slug}:ratchet_fixed_payload`);
    if (ratchet.kind === "native-atr" && [ratchet.engageReturnPct, ratchet.givebackPct,
      ratchet.retainGainPct, ratchet.fixedTargetPct].some((value) => value !== null)) {
      compatibilityErrors.push(`${spec.slug}:ratchet_native_payload`);
    }
  }

  const dynamic = (
    name: ValidationGate,
    value: DynamicReadinessEvidence[keyof DynamicReadinessEvidence] | undefined,
  ): ValidationGateResult => value
    ? value.ok && value.fact.trim() && value.evidenceRefs.length > 0
      ? gate(name, "pass", `${name}:verified`, value.fact, value.evidenceRefs)
      : gate(name, "block", value.ok ? `${name}:evidence_missing` : `${name}:failed`,
        value.fact.trim() || "Evidence fact is missing.", value.evidenceRefs)
    : gate(name, "not-run", `${name}:missing`, "No current evidence was supplied; activation must fail closed.");

  return [
    gate("schema", schemaErrors.length ? "block" : "pass", schemaErrors.length ? "schema:invalid" : "schema:valid", schemaErrors.join(",") || "All manifest/spec identities, shapes, and content hashes are valid."),
    gate("risk", riskErrors.length ? "block" : "pass", riskErrors.length ? "risk:invalid" : "risk:static-envelope-valid", riskErrors.join(",") || "All quantities, debit limits, stops, and targets fit the declared static envelopes."),
    gate("capacity", capacityErrors.length ? "block" : "pass", capacityErrors.length ? "capacity:invalid" : "capacity:static-limits-valid", capacityErrors.join(",") || "Every root maps to a domain with non-zero declared underlying and same-clock capacity."),
    gate("account-authority", accountErrors.length ? "block" : "pass", accountErrors.length ? "account:invalid" : "account:paper-only", accountErrors.join(",") || "The manifest and every channel specification are paper-only."),
    gate("collision", collisionErrors.length ? "block" : "pass", collisionErrors.length ? "collision:invalid" : "collision:static-policy-valid", collisionErrors.join(",") || "Collision domains, limits, and deterministic priorities are complete."),
    gate("reentry-scaling", compatibilityErrors.length ? "block" : "pass", compatibilityErrors.length ? "reentry-scaling:invalid" : "reentry-scaling:compatible", compatibilityErrors.join(",") || "Re-entry and scale policies are mutually compatible."),
    dynamic("replay-sufficiency", readiness?.replaySufficiency),
    dynamic("evidence-readiness", readiness?.evidenceReadiness),
    dynamic("safe-boundary", readiness?.safeBoundary),
    gate("rollback", manifest.rollbackTargetManifestId.trim() ? "pass" : "block", manifest.rollbackTargetManifestId.trim() ? "rollback:declared" : "rollback:missing", manifest.rollbackTargetManifestId.trim() ? `Rollback target ${manifest.rollbackTargetManifestId} is pinned.` : "No exact rollback target is pinned."),
  ];
}

export function compileReleaseManifest(
  draft: ReleaseManifestDraft,
  readiness?: DynamicReadinessEvidence,
): CompiledReleaseManifest {
  const channelSpecs = [...draft.channelSpecs]
    .map((spec): ChannelSpecVersion => ({ ...spec, contentHash: contentHash(semanticChannelSpec(spec)) }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const admissionPolicies = [...draft.admissionPolicies]
    .map((policy) => ({
      ...policy,
      maxOpenByUnderlying: Object.fromEntries(Object.entries(policy.maxOpenByUnderlying).sort()),
      sameClockMaxByUnderlying: Object.fromEntries(Object.entries(policy.sameClockMaxByUnderlying).sort()),
      priorityBySlug: Object.fromEntries(Object.entries(policy.priorityBySlug).sort()),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const manifestSemantic = {
    schemaVersion: draft.schemaVersion,
    id: draft.id,
    releaseId: draft.releaseId,
    cohortId: draft.cohortId,
    workerCompatibilityVersion: draft.workerCompatibilityVersion,
    legacyConfigurationHash: draft.legacyConfigurationHash,
    paperLiveAuthority: draft.paperLiveAuthority,
    admissionPolicyVersion: draft.admissionPolicyVersion,
    collisionPolicyVersion: draft.collisionPolicyVersion,
    activationBoundary: draft.activationBoundary,
    rollbackTargetManifestId: draft.rollbackTargetManifestId,
    channelSpecVersionIds: channelSpecs.map((spec) => spec.id),
    channelSpecContentHashes: channelSpecs.map((spec) => spec.contentHash),
    admissionPolicies,
  };
  const manifest: ReleaseManifest = {
    schemaVersion: draft.schemaVersion,
    id: draft.id,
    releaseId: draft.releaseId,
    cohortId: draft.cohortId,
    workerCompatibilityVersion: draft.workerCompatibilityVersion,
    legacyConfigurationHash: draft.legacyConfigurationHash,
    paperLiveAuthority: draft.paperLiveAuthority,
    admissionPolicyVersion: draft.admissionPolicyVersion,
    collisionPolicyVersion: draft.collisionPolicyVersion,
    activationBoundary: draft.activationBoundary,
    rollbackTargetManifestId: draft.rollbackTargetManifestId,
    channelSpecVersionIds: channelSpecs.map((spec) => spec.id),
    channelSpecContentHashes: channelSpecs.map((spec) => spec.contentHash),
    admissionPolicies,
    createdBy: draft.createdBy,
    createdAt: draft.createdAt,
    parentManifestId: draft.parentManifestId,
    contentHash: contentHash(manifestSemantic),
    status: draft.status,
  };
  const validationResults = compileValidation(manifest, channelSpecs, readiness);
  const validationReady = validationResults.every((result) => result.state === "pass");
  const workerRoots: WorkerChannelProjection[] = channelSpecs.map((spec) => ({
    slug: spec.slug,
    cohort: spec.cohort,
    domainId: spec.collisionDomain,
    familyId: spec.familyId,
    underlying: spec.symbolScope[0] ?? "",
    priority: spec.priority,
    entryDte: Number(spec.entryParameters.entryDte),
    strikeOffset: Number(spec.entryParameters.strikeOffset),
    maxEntriesPerSession: maxEntriesPerSessionForSpec(spec) ?? 0,
    quantity: spec.quantity,
    premiumCap: Number(spec.entryParameters.premiumCap),
    aggregateDebitCap: spec.maxDebitUsd,
    takeProfit: spec.takeProfit,
    stopLoss: spec.stopLoss,
    ratchetParameters: spec.ratchetParameters,
    riskLimits: spec.riskLimits,
    managerProfileId: spec.managerProfileId,
    strategistId: spec.channelId,
    accountId: spec.accountId,
    executionPosture: spec.executionPosture ?? "paper",
    channelSpecVersionId: spec.id,
    channelSpecContentHash: spec.contentHash,
  }));
  const dashboardRoots: DashboardChannelProjection[] = channelSpecs.map((spec, index) => ({
    ...workerRoots[index],
    accountName: String(spec.exitParameters.accountName),
    riskBudgetUsd: spec.riskLimits.maxRiskUsd,
    premiumStopPct: spec.stopLoss.catastrophePct,
    bankTargetPct: spec.takeProfit.targetPct,
    runner: runtimeRunner(spec),
    runnerFraction: spec.takeProfit.fraction,
    managerLabel: String(spec.exitParameters.managerLabel),
    eodEt: String(spec.exitParameters.eodEt),
  }));
  return {
    compilerVersion: CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
    manifest,
    channelSpecs,
    validationResults,
    validationReady,
    activationAuthorized: false,
    workerProjection: {
      releaseId: manifest.releaseId,
      cohortId: manifest.cohortId,
      workerCompatibilityVersion: manifest.workerCompatibilityVersion,
      legacyConfigurationHash: manifest.legacyConfigurationHash,
      manifestContentHash: manifest.contentHash,
      roots: workerRoots,
      admissionPolicies,
      activationAuthorized: false,
    },
    dashboardProjection: {
      releaseId: manifest.releaseId,
      workerCompatibilityVersion: manifest.workerCompatibilityVersion,
      legacyConfigurationHash: manifest.legacyConfigurationHash,
      manifestContentHash: manifest.contentHash,
      roots: dashboardRoots,
      activationAuthorized: false,
    },
  };
}

const CHANGE_CLASS_RANK: Record<ChangeClass, number> = {
  "presentation-only": 0,
  "bounded-parameter": 1,
  "governed-operational-policy": 2,
  "code-strategy-logic": 3,
};

const FIELD_CLASS: Partial<Record<keyof ChannelSpecVersionDraft, ChangeClass>> = {
  quantity: "bounded-parameter",
  maxDebitUsd: "bounded-parameter",
  takeProfit: "bounded-parameter",
  stopLoss: "bounded-parameter",
  riskLimits: "bounded-parameter",
  accountId: "governed-operational-policy",
  accountRole: "governed-operational-policy",
  accountMode: "governed-operational-policy",
  symbolScope: "governed-operational-policy",
  familyId: "governed-operational-policy",
  cohort: "governed-operational-policy",
  priority: "governed-operational-policy",
  reentryPolicy: "governed-operational-policy",
  scalePolicy: "governed-operational-policy",
  collisionDomain: "governed-operational-policy",
  executionPosture: "governed-operational-policy",
  strategyIdentity: "code-strategy-logic",
  strategyVersion: "code-strategy-logic",
  signalVersion: "code-strategy-logic",
  managerProfileId: "code-strategy-logic",
  managerVersion: "code-strategy-logic",
  entryParameters: "code-strategy-logic",
  exitParameters: "code-strategy-logic",
  ratchetParameters: "code-strategy-logic",
};

const FORBIDDEN_PATCH_FIELDS = new Set([
  "schemaVersion", "id", "channelId", "slug", "createdAt", "createdBy",
  "parentVersionId", "status", "validFrom", "validUntil", "contentHash",
]);

const MANAGER_POLICY_PATCH_FIELDS = [
  "exitParameters",
  "managerProfileId",
  "managerVersion",
  "ratchetParameters",
  "stopLoss",
  "takeProfit",
] as const;

function isAtomicManagerPolicyPatch(
  active: ChannelSpecVersion,
  patch: ChannelChangeProposal["proposedPatch"],
): boolean {
  const fields = Object.keys(patch).sort();
  if (canonicalJson(fields) !== canonicalJson([...MANAGER_POLICY_PATCH_FIELDS].sort())) {
    return false;
  }
  const proposedExit = patch.exitParameters;
  if (!proposedExit || typeof proposedExit !== "object" || Array.isArray(proposedExit)) {
    return false;
  }
  const { managerLabel: _activeLabel, ...activeExitRest } = active.exitParameters;
  const { managerLabel: proposedLabel, ...proposedExitRest } = proposedExit;
  if (typeof proposedLabel !== "string"
      || canonicalJson(activeExitRest) !== canonicalJson(proposedExitRest)
      || typeof patch.managerProfileId !== "string"
      || typeof patch.managerVersion !== "string"
      || !patch.takeProfit
      || !patch.stopLoss
      || !patch.ratchetParameters) {
    return false;
  }
  return patch.managerVersion === managerPolicyContentHash({
    managerProfileId: patch.managerProfileId,
    takeProfit: patch.takeProfit,
    stopLoss: patch.stopLoss,
    ratchetParameters: patch.ratchetParameters,
    liquidationEt: proposedExit.eodEt,
  });
}

export interface ActiveVersusDraftProjection {
  proposalId: string;
  activeSpec: ChannelSpecVersion | null;
  draftSpec: ChannelSpecVersion | null;
  diffs: Array<{ field: string; before: string; after: string }>;
  validationResults: ValidationGateResult[];
  state: "blocked" | "reviewable";
  activationAuthorized: false;
}

export function projectActiveVersusDraft(
  compiled: CompiledReleaseManifest,
  proposal: ChannelChangeProposal,
  readiness?: DynamicReadinessEvidence,
): ActiveVersusDraftProjection {
  const active = compiled.channelSpecs.find((spec) => spec.id === proposal.baseSpecVersionId) ?? null;
  if (!active) return {
    proposalId: proposal.id,
    activeSpec: null,
    draftSpec: null,
    diffs: [],
    validationResults: [gate("schema", "block", "proposal:base_missing", "The proposal base specification is not in the active manifest.")],
    state: "blocked",
    activationAuthorized: false,
  };
  const issues: ValidationGateResult[] = [];
  if (proposal.baseSpecContentHash !== active.contentHash) issues.push(
    gate("schema", "block", "proposal:base_hash_mismatch", "The proposal base hash does not match the active specification."),
  );
  const fields = Object.keys(proposal.proposedPatch) as Array<keyof ChannelSpecVersionDraft>;
  if (!fields.length) issues.push(gate("schema", "block", "proposal:empty_patch", "The proposal contains no semantic change."));
  if (!Object.prototype.hasOwnProperty.call(CHANGE_CLASS_RANK, proposal.changeClass)) {
    issues.push(gate("schema", "block", "proposal:change_class_invalid", "The proposal change class is not recognized."));
  }
  const atomicManagerPolicy = isAtomicManagerPolicyPatch(active, proposal.proposedPatch);
  for (const field of fields) {
    if (FORBIDDEN_PATCH_FIELDS.has(String(field))) {
      issues.push(gate("schema", "block", `proposal:forbidden_field:${String(field)}`, `${String(field)} cannot be changed by proposal.`));
      continue;
    }
    let required = FIELD_CLASS[field] ?? "code-strategy-logic";
    if (atomicManagerPolicy
        && MANAGER_POLICY_PATCH_FIELDS.includes(
          field as typeof MANAGER_POLICY_PATCH_FIELDS[number],
        )) {
      required = "bounded-parameter";
    }
    if (field === "entryParameters") {
      const proposed = proposal.proposedPatch.entryParameters;
      if (proposed && typeof proposed === "object" && !Array.isArray(proposed)) {
        const { maxEntriesPerSession: _activeLimit, ...activeRest } = active.entryParameters;
        const { maxEntriesPerSession: _proposedLimit, ...proposedRest } = proposed;
        if (canonicalJson(activeRest) === canonicalJson(proposedRest)) {
          required = "governed-operational-policy";
        }
      }
    }
    if (CHANGE_CLASS_RANK[proposal.changeClass] < CHANGE_CLASS_RANK[required]) {
      issues.push(gate("schema", "block", `proposal:change_class:${String(field)}`, `${String(field)} requires ${required}; ${proposal.changeClass} is insufficient.`));
    }
  }
  const draftInput: ChannelSpecVersionDraft = {
    ...active,
    ...proposal.proposedPatch,
    id: proposal.proposedSpecVersionId,
    parentVersionId: active.id,
    createdAt: proposal.createdAt,
    createdBy: `${proposal.authorKind}:${proposal.authorId}`,
    validFrom: proposal.createdAt,
    validUntil: null,
    status: "draft",
  };
  delete (draftInput as Partial<ChannelSpecVersion>).contentHash;
  const previewSpecs = compiled.channelSpecs.map((spec): ChannelSpecVersionDraft => {
    const { contentHash: _contentHash, ...withoutHash } = spec;
    return spec.id === active.id ? draftInput : withoutHash;
  });
  const previewManifest = compileReleaseManifest({
    ...compiled.manifest,
    id: `${compiled.manifest.id}:preview:${proposal.id}`,
    releaseId: `${compiled.manifest.releaseId}:preview`,
    createdAt: proposal.createdAt,
    createdBy: `${proposal.authorKind}:${proposal.authorId}`,
    parentManifestId: compiled.manifest.id,
    status: "draft",
    channelSpecs: previewSpecs,
    admissionPolicies: projectAdmissionPolicyReentry(
      compiled.manifest.admissionPolicies,
      previewSpecs,
    ),
  }, readiness);
  const draftSpec = previewManifest.channelSpecs.find((spec) => spec.id === proposal.proposedSpecVersionId) ?? null;
  const diffs = fields.map((field) => ({
    field: String(field),
    before: canonicalJson(active[field] === undefined ? null : active[field]),
    after: canonicalJson(draftSpec?.[field] === undefined
      ? null
      : draftSpec?.[field]),
  }));
  const validationResults = [...issues, ...previewManifest.validationResults];
  const state = validationResults.some((result) => result.state !== "pass") ? "blocked" : "reviewable";
  return {
    proposalId: proposal.id,
    activeSpec: active,
    draftSpec,
    diffs,
    validationResults,
    state,
    activationAuthorized: false,
  };
}
