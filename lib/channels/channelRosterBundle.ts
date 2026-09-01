import {
  canonicalJson,
  compileReleaseManifest,
  contentHash,
  projectAdmissionPolicyReentry,
  type AdmissionPolicySpec,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
} from "./channelControlPlane";
import {
  evaluatePortfolioCapacity,
  type LivePortfolioTruth,
  type PortfolioCapacityEnvelope,
  type PortfolioCapacityEvaluation,
} from "./channelPortfolioCapacity";
import { buildShadowRuntimeProjection } from "./channelActivation";
import type { ResearchChannelRegistry } from "./researchChannelRegistry";

export const CHANNEL_ROSTER_BUNDLE_VERSION =
  "channel-roster-bundle-v1" as const;

export interface ChannelRosterTarget {
  slug: string;
  membership?: "include" | "exclude";
  executionPosture?: "paper" | "observe-only";
  priority?: number;
  quantity?: number;
  maxEntriesPerSession?: number;
  maxRiskUsd?: number;
  collisionDomain?: string;
}

export interface ChannelRosterBundleDraft {
  id: string;
  baseManifestId: string;
  baseManifestContentHash: string;
  changes: ChannelRosterTarget[];
  admissionPolicyUpserts?: AdmissionPolicySpec[];
  reason: string;
  evidenceRefs: string[];
  operatorId: string;
  createdAt: string;
}

export interface ChannelRosterBundleDiff {
  slug: string;
  source: "active-manifest" | "research-registry" | "admission-policy";
  fields: Array<{ field: string; before: string; after: string }>;
}

export interface ChannelRosterBundlePreview {
  version: typeof CHANNEL_ROSTER_BUNDLE_VERSION;
  id: string;
  state: "ready-for-worker-ack" | "blocked";
  activeManifestId: string;
  activeManifestContentHash: string;
  candidate: CompiledReleaseManifest | null;
  configurationEpochId: string | null;
  diffs: ChannelRosterBundleDiff[];
  capacity: PortfolioCapacityEvaluation | null;
  blockers: string[];
  evidenceRefs: string[];
  rollbackTargetManifestId: string;
  historicalEvidenceMutation: false;
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUANTITY = 12;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort();
}

function withoutHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}

function fieldsChanged(
  before: ChannelSpecVersionDraft,
  after: ChannelSpecVersionDraft,
): ChannelRosterBundleDiff["fields"] {
  return ["executionPosture", "priority", "quantity", "entryParameters", "reentryPolicy", "maxDebitUsd", "riskLimits", "collisionDomain"]
    .map((field) => ({
      field,
      before: canonicalJson(
        before[field as keyof ChannelSpecVersionDraft] ?? null,
      ),
      after: canonicalJson(
        after[field as keyof ChannelSpecVersionDraft] ?? null,
      ),
    }))
    .filter((diff) => diff.before !== diff.after);
}

function applyTarget(input: {
  source: ChannelSpecVersionDraft;
  target: ChannelRosterTarget;
  bundle: ChannelRosterBundleDraft;
}): ChannelSpecVersionDraft {
  const quantity = input.target.quantity ?? input.source.quantity;
  const premiumCap = Number(input.source.entryParameters.premiumCap);
  const maxDebitUsd = Math.round(premiumCap * quantity * 10_000) / 100;
  const priorRatio = input.source.maxDebitUsd > 0
    ? input.source.riskLimits.maxRiskUsd / input.source.maxDebitUsd
    : 0;
  const maxRiskUsd = input.target.maxRiskUsd
    ?? Math.round(maxDebitUsd * priorRatio * 100) / 100;
  const candidate: ChannelSpecVersionDraft = {
    ...structuredClone(input.source),
    id: `spec:bundle:${input.bundle.id}:${input.source.slug}`,
    parentVersionId: input.source.id,
    priority: input.target.priority ?? input.source.priority,
    quantity,
    entryParameters: input.target.maxEntriesPerSession == null
      ? structuredClone(input.source.entryParameters)
      : {
          ...structuredClone(input.source.entryParameters),
          maxEntriesPerSession: input.target.maxEntriesPerSession,
        },
    reentryPolicy: input.target.maxEntriesPerSession == null
      ? input.source.reentryPolicy
      : input.target.maxEntriesPerSession === 1 ? "disabled" : "bounded",
    maxDebitUsd,
    riskLimits: {
      maxContracts: quantity,
      maxDebitUsd,
      maxRiskUsd,
    },
    collisionDomain: input.target.collisionDomain
      ?? input.source.collisionDomain,
    validFrom: input.bundle.createdAt,
    validUntil: null,
    createdAt: input.bundle.createdAt,
    createdBy: `operator:${input.bundle.operatorId}`,
    status: "draft",
  };
  const posture = input.target.executionPosture ?? input.source.executionPosture;
  if (posture != null) candidate.executionPosture = posture;
  else delete candidate.executionPosture;
  return candidate;
}

export function buildChannelRosterBundlePreview(input: {
  active: CompiledReleaseManifest;
  registry: ResearchChannelRegistry;
  draft: ChannelRosterBundleDraft;
  envelope: PortfolioCapacityEnvelope;
  live: LivePortfolioTruth;
  collectionStates: ReadonlyMap<string, "active" | "paused" | "archived">;
}): ChannelRosterBundlePreview {
  const blockers: string[] = [];
  const evidenceRefs = unique(input.draft.evidenceRefs);
  if (!UUID.test(input.draft.id)) blockers.push("bundle:id_invalid");
  if (!UUID.test(input.draft.operatorId)) blockers.push("bundle:operator_invalid");
  if (!Number.isFinite(Date.parse(input.draft.createdAt))) {
    blockers.push("bundle:created_at_invalid");
  }
  if (input.draft.baseManifestId !== input.active.manifest.id
      || input.draft.baseManifestContentHash
        !== input.active.manifest.contentHash) {
    blockers.push("bundle:base_manifest_drift");
  }
  if (input.draft.reason.trim().length < 8
      || input.draft.reason.trim().length > 2_000) {
    blockers.push("bundle:reason_invalid");
  }
  if (!evidenceRefs.length || evidenceRefs.length > 64) {
    blockers.push("bundle:evidence_invalid");
  }
  if (!input.draft.changes.length || input.draft.changes.length > 68) {
    blockers.push("bundle:change_count_invalid");
  }

  const activeBySlug = new Map(input.active.channelSpecs.map((spec) =>
    [spec.slug, spec]));
  const seen = new Set<string>();
  const replacements = new Map<string, ChannelSpecVersionDraft>();
  const removals = new Set<string>();
  const additions: ChannelSpecVersionDraft[] = [];
  const diffs: ChannelRosterBundleDiff[] = [];

  for (const target of input.draft.changes) {
    if (seen.has(target.slug)) {
      blockers.push(`bundle:duplicate_change:${target.slug}`);
      continue;
    }
    seen.add(target.slug);
    const active = activeBySlug.get(target.slug);
    const registration = input.registry.bySlug[target.slug];
    const source = active
      ? withoutHash(active)
      : registration?.candidateSpec ?? null;
    const sourceKind = active ? "active-manifest" as const
      : "research-registry" as const;
    if (!source) {
      blockers.push(`bundle:channel_unregistered:${target.slug}`);
      continue;
    }
    if (!active && registration?.state !== "paper-eligible") {
      blockers.push(`bundle:registration_blocked:${target.slug}`);
      for (const blocker of registration?.blockers ?? []) {
        blockers.push(`bundle:registration:${target.slug}:${blocker}`);
      }
      continue;
    }
    if (target.membership === "exclude") {
      if (!active) blockers.push(`bundle:exclude_not_active:${target.slug}`);
      else if (target.executionPosture != null || target.priority != null
          || target.quantity != null || target.maxEntriesPerSession != null
          || target.maxRiskUsd != null || target.collisionDomain != null) {
        blockers.push(`bundle:exclude_must_be_standalone:${target.slug}`);
      } else {
        removals.add(active.id);
        diffs.push({
          slug: target.slug,
          source: "active-manifest",
          fields: [{ field: "membership", before: "included", after: "excluded" }],
        });
      }
      continue;
    }
    if (target.membership != null && target.membership !== "include") {
      blockers.push(`bundle:membership_invalid:${target.slug}`);
      continue;
    }
    if (target.executionPosture == null && target.priority == null
        && target.quantity == null && target.maxEntriesPerSession == null
        && target.maxRiskUsd == null && target.collisionDomain == null) {
      blockers.push(`bundle:empty_change:${target.slug}`);
      continue;
    }
    const quantity = target.quantity ?? source.quantity;
    const priority = target.priority ?? source.priority;
    if (!Number.isInteger(priority) || priority < 1) {
      blockers.push(`bundle:priority_invalid:${target.slug}`);
      continue;
    }
    if (!Number.isInteger(quantity) || quantity < 1
        || quantity > MAX_QUANTITY) {
      blockers.push(`bundle:quantity_invalid:${target.slug}`);
      continue;
    }
    if (target.maxEntriesPerSession != null
        && (!Number.isInteger(target.maxEntriesPerSession)
          || target.maxEntriesPerSession < 1
          || target.maxEntriesPerSession > 3)) {
      blockers.push(`bundle:entry_limit_invalid:${target.slug}`);
      continue;
    }
    if (source.takeProfit.kind === "bank"
        && source.takeProfit.fraction === 0.5
        && quantity % 2 !== 0) {
      blockers.push(`bundle:whole_lot_manager_incompatible:${target.slug}`);
      continue;
    }
    if (target.maxRiskUsd != null
        && (!Number.isFinite(target.maxRiskUsd)
          || target.maxRiskUsd <= 0)) {
      blockers.push(`bundle:risk_invalid:${target.slug}`);
      continue;
    }
    const candidate = applyTarget({
      source,
      target,
      bundle: input.draft,
    });
    if (candidate.riskLimits.maxRiskUsd > candidate.maxDebitUsd) {
      blockers.push(`bundle:risk_exceeds_debit:${target.slug}`);
      continue;
    }
    const changed = fieldsChanged(source, candidate);
    if (!changed.length) {
      blockers.push(`bundle:no_semantic_change:${target.slug}`);
      continue;
    }
    diffs.push({ slug: target.slug, source: sourceKind, fields: changed });
    if (active) replacements.set(active.id, candidate);
    else additions.push(candidate);
  }

  if (blockers.length) {
    return blockedPreview(input, diffs, blockers, evidenceRefs, null, null);
  }

  const specs: ChannelSpecVersionDraft[] = [
    ...input.active.channelSpecs.map((spec) =>
      replacements.get(spec.id) ?? withoutHash(spec))
      .filter((spec) => !removals.has(spec.id)),
    ...additions,
  ];
  for (const spec of specs) {
    if ((spec.executionPosture ?? "paper") === "paper"
        && input.collectionStates.get(spec.channelId) !== "active") {
      blockers.push(`bundle:paper_collection_not_active:${spec.slug}`);
    }
  }
  const policyById = new Map(input.active.manifest.admissionPolicies.map((policy) =>
    [policy.id, structuredClone(policy)]));
  const seenPolicyUpserts = new Set<string>();
  for (const policy of input.draft.admissionPolicyUpserts ?? []) {
    if (!policy.id || seenPolicyUpserts.has(policy.id)) {
      blockers.push(`bundle:admission_policy_duplicate:${policy.id || "missing"}`);
      continue;
    }
    seenPolicyUpserts.add(policy.id);
    const prior = policyById.get(policy.id) ?? null;
    policyById.set(policy.id, structuredClone(policy));
    diffs.push({
      slug: `admission:${policy.id}`,
      source: "admission-policy",
      fields: [{
        field: "policy",
        before: canonicalJson(prior),
        after: canonicalJson(policy),
      }],
    });
  }
  const domains = new Set(specs.map((spec) => spec.collisionDomain));
  const admissionPolicies = projectAdmissionPolicyReentry(
    [...policyById.values()].map((policy) => ({
      ...policy,
      priorityBySlug: Object.fromEntries(specs
        .filter((spec) => spec.collisionDomain === policy.id)
        .map((spec) => [spec.slug, spec.priority])),
    })),
    specs,
  );
  for (const domain of domains) {
    if (!admissionPolicies.some((policy) => policy.id === domain)) {
      blockers.push(`bundle:collision_domain_unregistered:${domain}`);
    }
  }
  if (blockers.length) {
    return blockedPreview(input, diffs, blockers, evidenceRefs, null, null);
  }

  const protocolRef = contentHash({
    version: CHANNEL_ROSTER_BUNDLE_VERSION,
    id: input.draft.id,
    baseManifestContentHash: input.draft.baseManifestContentHash,
    changes: input.draft.changes,
    admissionPolicyUpserts: input.draft.admissionPolicyUpserts ?? [],
  });
  const flat = input.live.complete
    && input.live.openOrders === 0
    && input.live.positions.length === 0;
  const candidate = compileReleaseManifest({
    ...input.active.manifest,
    id: `manifest:bundle:${input.draft.id}`,
    releaseId: `release:bundle:${input.draft.id}`,
    cohortId: `operator-bundle:${input.draft.id}`,
    rollbackTargetManifestId: input.active.manifest.id,
    parentManifestId: input.active.manifest.id,
    createdBy: `operator:${input.draft.operatorId}`,
    createdAt: input.draft.createdAt,
    status: "draft",
    channelSpecs: specs,
    admissionPolicies,
  }, {
    replaySufficiency: {
      ok: true,
      fact: "Operator-directed roster simulation is exact; it makes no efficacy claim.",
      evidenceRefs: [protocolRef],
    },
    evidenceReadiness: {
      ok: evidenceRefs.length > 0,
      fact: "The operator supplied a reason and review evidence for the bounded paper experiment.",
      evidenceRefs,
    },
    safeBoundary: {
      ok: flat,
      fact: flat
        ? "The supplied broker, order, and desk inventory is complete and flat."
        : "A complete flat paper boundary is required before worker acknowledgement.",
      evidenceRefs: flat
        ? [`portfolio-flat:${input.live.observedAt}`]
        : [],
    },
  });
  const capacity = evaluatePortfolioCapacity({
    specs: candidate.channelSpecs,
    admissionPolicies: candidate.manifest.admissionPolicies,
    envelope: input.envelope,
    live: input.live,
  });
  const validationBlockers = candidate.validationResults
    .filter((result) => result.state !== "pass")
    .map((result) => `bundle:validation:${result.code}`);
  blockers.push(...validationBlockers, ...capacity.blockers);
  // Runtime identity is canonical for the compiled manifest. Bundle identity
  // remains separately immutable in the draft and activation receipts and
  // must not fork the epoch reconstructed by a restarted worker.
  const configurationEpochId = buildShadowRuntimeProjection(
    candidate,
  ).configurationEpochId;
  return blockedPreview(
    input,
    diffs,
    blockers,
    unique([...evidenceRefs, protocolRef]),
    candidate,
    capacity,
    configurationEpochId,
  );
}

function blockedPreview(
  input: {
    active: CompiledReleaseManifest;
    draft: ChannelRosterBundleDraft;
  },
  diffs: ChannelRosterBundleDiff[],
  blockers: string[],
  evidenceRefs: string[],
  candidate: CompiledReleaseManifest | null,
  capacity: PortfolioCapacityEvaluation | null,
  configurationEpochId: string | null = null,
): ChannelRosterBundlePreview {
  const exactBlockers = unique(blockers);
  return Object.freeze({
    version: CHANNEL_ROSTER_BUNDLE_VERSION,
    id: input.draft.id,
    state: exactBlockers.length ? "blocked" : "ready-for-worker-ack",
    activeManifestId: input.active.manifest.id,
    activeManifestContentHash: input.active.manifest.contentHash,
    candidate,
    configurationEpochId,
    diffs: diffs.sort((left, right) => left.slug.localeCompare(right.slug)),
    capacity,
    blockers: exactBlockers,
    evidenceRefs,
    rollbackTargetManifestId: input.active.manifest.id,
    historicalEvidenceMutation: false,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
