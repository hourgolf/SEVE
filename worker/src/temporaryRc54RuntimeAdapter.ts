import { MANAGER_SHADOW_BOOK_VERSION } from "./managerShadowBookModel.js";
import {
  rc54ManagerProfileFromRow,
  rc54ManagerStampPresent,
} from "./rc54ManagerPolicy.js";
import {
  RC54_ROOTS,
  type Rc54AdmissionCandidateIdentity,
  type Rc54AdmissionRoot,
  type Rc54AdmissionRootResolver,
} from "./rc54ReleasePolicy.js";
import type { AdmissionDomainPolicy } from "./admissionDomainModel.js";
import {
  RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
  type ReleaseEvidenceContext,
} from "./releaseEvidenceContext.js";
import {
  configurationWriteStampForChannel,
  type ReceiptBoundConfigurationWriteStamp,
  type ReceiptBoundRuntimeConfiguration,
  type ReceiptBoundRuntimeRoot,
} from "./channelConfigurationRuntimeAdapter.js";
import {
  receiptBoundEntryPolicyFromRow,
  receiptBoundEntryPolicyStampPresent,
} from "./receiptBoundEntryPolicy.js";
import type { ChannelConfig, PositionRow } from "./store.js";

export const TEMPORARY_RC54_RUNTIME_ADAPTER_VERSION =
  "temporary-rc54-runtime-adapter-v6" as const;

const SHA256 = /^sha256:([0-9a-f]{64})$/i;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * RC5.4 remains the temporary execution-mechanics and admission adapter. The
 * immutable manifest may change roster membership and bounded per-root
 * economics/posture. Strategy identity and supported instruments remain
 * sealed, while account routing, admission domains, family, priority, and
 * entry envelopes come from the immutable activation receipt. Scaling and
 * concurrency remain bounded by the validation below.
 */
export function validateReceiptBoundRc54Topology(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): string[] {
  const errors: string[] = [];
  const expectedBySlug = new Map<string, (typeof RC54_ROOTS)[number]>(
    RC54_ROOTS.map((root) => [root.slug, root] as const),
  );
  const configuredAccountIds = new Set<string>(RC54_ROOTS.map((root) => root.accountId));
  const policyById = new Map(runtime.admissionPolicies.map((policy) =>
    [policy.id, policy] as const));
  if (policyById.size !== runtime.admissionPolicies.length
      || runtime.admissionPolicies.some((policy) => !policy.id.trim())) {
    errors.push("temporary_rc54_adapter:admission_policy_duplicate");
  }
  const observedBySlug = new Map<string, Readonly<ReceiptBoundRuntimeRoot>>();
  for (const root of runtime.roots) {
    if (observedBySlug.has(root.slug)) {
      errors.push(`temporary_rc54_adapter:duplicate_root:${root.slug}`);
    }
    observedBySlug.set(root.slug, root);
  }
  if (!runtime.roots.length) {
    errors.push("temporary_rc54_adapter:root_count:0");
  }
  const strategistIds = new Set<string>();
  for (const root of runtime.roots) {
    const expected = expectedBySlug.get(root.slug);
    if (expected) {
      const topology: Array<[string, unknown, unknown]> = [
        ["underlying", root.underlying, expected.underlying],
        ["strategist", root.strategistId, expected.strategistId],
      ];
      for (const [field, actual, sealed] of topology) {
        if (actual !== sealed) {
          errors.push(`temporary_rc54_adapter:${expected.slug}:${field}`);
        }
      }
    }
    if (!policyById.has(root.domainId)) {
      errors.push(`temporary_rc54_adapter:${root.slug}:domain`);
    }
    if (!configuredAccountIds.has(root.accountId)) {
      errors.push(`temporary_rc54_adapter:${root.slug}:account`);
    }
    if (!root.familyId.trim()) {
      errors.push(`temporary_rc54_adapter:${root.slug}:family`);
    }
    if (!["SPY", "QQQ", "IWM"].includes(root.underlying)) {
      errors.push(`temporary_rc54_adapter:${root.slug}:underlying`);
    }
    if (!Number.isInteger(root.entryDte)
        || root.entryDte < 0 || root.entryDte > 1) {
      errors.push(`temporary_rc54_adapter:${root.slug}:entry_dte`);
    }
    if (!Number.isInteger(root.strikeOffset)
        || Math.abs(root.strikeOffset) > 20) {
      errors.push(`temporary_rc54_adapter:${root.slug}:strike_offset`);
    }
    if (!root.strategistId.trim()) {
      errors.push(`temporary_rc54_adapter:${root.slug}:strategist`);
    }
    if (!Number.isInteger(root.priority) || root.priority < 1) {
      errors.push(`temporary_rc54_adapter:${root.slug}:priority`);
    }
    if (strategistIds.has(root.strategistId)) {
      errors.push(`temporary_rc54_adapter:duplicate_strategist:${root.strategistId}`);
    }
    strategistIds.add(root.strategistId);
    if (root.executionPosture !== "paper"
        && root.executionPosture !== "observe-only") {
      errors.push(`temporary_rc54_adapter:${root.slug}:execution_posture`);
    }
    if (!Number.isInteger(root.quantity) || root.quantity < 1
        || root.quantity > 12
        || !Number.isFinite(root.premiumCap) || root.premiumCap <= 0
        || !Number.isFinite(root.aggregateDebitCap)
        || root.aggregateDebitCap <= 0) {
      errors.push(`temporary_rc54_adapter:${root.slug}:economic_envelope`);
    }
    if (!Number.isInteger(root.riskLimits.maxContracts)
        || root.riskLimits.maxContracts < root.quantity
        || root.riskLimits.maxDebitUsd < root.aggregateDebitCap
        || !(root.riskLimits.maxRiskUsd > 0)
        || root.riskLimits.maxRiskUsd > root.riskLimits.maxDebitUsd) {
      errors.push(`temporary_rc54_adapter:${root.slug}:risk_envelope`);
    }
    if (root.reentryPolicy === "disabled" && root.maxEntriesPerSession !== 1) {
      errors.push(`temporary_rc54_adapter:${root.slug}:reentry`);
    } else if (root.reentryPolicy === "bounded"
        && (!Number.isInteger(root.maxEntriesPerSession)
          || root.maxEntriesPerSession < 2
          || root.maxEntriesPerSession > 3)) {
      errors.push(`temporary_rc54_adapter:${root.slug}:reentry`);
    }
    if (root.scalePolicy.adds !== 0
        || root.scalePolicy.pyramiding !== "disabled") {
      errors.push(`temporary_rc54_adapter:${root.slug}:scaling`);
    }
  }
  const supportedUnderlying = new Set(["SPY", "QQQ", "IWM"]);
  const validCaps = (caps: Readonly<Record<string, number>>, ceiling: number): boolean =>
    Object.keys(caps).every((symbol) => supportedUnderlying.has(symbol))
      && Object.values(caps).every((cap) => Number.isInteger(cap)
        && cap >= 0 && cap <= ceiling);
  for (const policy of runtime.admissionPolicies) {
    const roots = runtime.roots.filter((root) => root.domainId === policy.id);
    if (!Number.isInteger(policy.maxOpenGlobal) || policy.maxOpenGlobal < 1
        || policy.maxOpenGlobal > 6 || policy.maxOpenPerFamily !== 1
        || policy.sameOccOpenMax !== 1
        || policy.crossDomainSameOcc !== "allow-with-receipt"
        || !validCaps(policy.maxOpenByUnderlying, policy.maxOpenGlobal)
        || !validCaps(policy.sameClockMaxByUnderlying, policy.maxOpenGlobal)
        || Object.entries(policy.sameClockMaxByUnderlying).some(([symbol, cap]) =>
          cap > (policy.maxOpenByUnderlying[symbol] ?? 0))) {
      errors.push(`temporary_rc54_adapter:${policy.id}:admission_envelope`);
    }
    if (roots.some((root) => root.executionPosture === "paper")
        && !policy.enabledForNewEntries) {
      errors.push(`temporary_rc54_adapter:${policy.id}:admission_disabled`);
    }
    const boundedRootPresent = roots.some((root) => root.reentryPolicy === "bounded");
    if ((policy.reentry === "bounded") !== boundedRootPresent) {
      errors.push(`temporary_rc54_adapter:${policy.id}:admission_reentry`);
    }
    const overflow = policy.overflowCapacity;
    if (overflow && (!Number.isInteger(overflow.maxOpenGlobal)
        || overflow.maxOpenGlobal < policy.maxOpenGlobal
        || overflow.maxOpenGlobal > 6 || !overflow.eligibleSlugs.length
        || new Set(overflow.eligibleSlugs).size !== overflow.eligibleSlugs.length
        || overflow.eligibleSlugs.some((slug) => !roots.some((root) => root.slug === slug))
        || !validCaps(overflow.maxOpenByUnderlying, overflow.maxOpenGlobal)
        || !validCaps(overflow.sameClockMaxByUnderlying, overflow.maxOpenGlobal)
        || Object.entries(overflow.sameClockMaxByUnderlying).some(([symbol, cap]) =>
          cap > (overflow.maxOpenByUnderlying[symbol] ?? 0)))) {
      errors.push(`temporary_rc54_adapter:${policy.id}:admission_overflow`);
    }
  }
  return uniqueSorted(errors);
}

/**
 * Carries the already-validated RC5.4 operational posture into the immutable
 * receipt-bound startup identity. The receipt-bound manifest replaces only
 * configuration identity; it must not lose paper/order/feed/capture evidence.
 */
export function buildReceiptBoundRc54StartupReceipt(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  operationalReceipt: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const topologyErrors = validateReceiptBoundRc54Topology(input.runtime);
  if (topologyErrors.length) throw new Error(topologyErrors.join(";"));
  for (const field of [
    "alpacaPaperOrigin",
    "stockFeed",
    "optionFeed",
    "dryRun",
    "liveTrading",
    "heldCapture",
    "managerShadow",
  ] as const) {
    if (input.operationalReceipt[field] == null) {
      throw new Error(`receipt-bound startup posture missing ${field}`);
    }
  }
  return Object.freeze({
    ...input.operationalReceipt,
    schemaVersion: 1,
    state: "receipt-bound",
    workerVersion: input.runtime.workerCompatibilityVersion,
    releaseId: input.runtime.releaseId,
    releaseManifestId: input.runtime.releaseManifestId,
    manifestContentHash: input.runtime.manifestContentHash,
    configurationEpochId: input.runtime.configurationEpochId,
    activationReceiptId: input.runtime.activationReceiptId,
    activatedAt: input.runtime.activatedAt,
    workerCompatibilityVersion: input.runtime.workerCompatibilityVersion,
    adapterVersion: input.runtime.adapterVersion,
    temporaryTopologyAdapter: "RC5.4",
    temporaryTopologyAdapterVersion: TEMPORARY_RC54_RUNTIME_ADAPTER_VERSION,
    paperOnly: true,
    roots: input.runtime.roots.map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
      executionPosture: root.executionPosture,
      channelSpecVersionId: root.channelSpecVersionId,
      channelSpecContentHash: root.channelSpecContentHash,
      managerProfileId: root.configuration.managerProfileId,
      managerVersion: root.configuration.managerVersion,
      configurationEpochId: root.configuration.configurationEpochId,
      quantity: root.quantity,
      maxEntriesPerSession: root.maxEntriesPerSession,
    })),
    rootCount: input.runtime.roots.length,
    entryLimits: Object.fromEntries(
      input.runtime.roots
        .map((root): [string, number] => [
          root.slug,
          root.maxEntriesPerSession,
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    configuredPaperAccountIds: [
      ...new Set(input.runtime.roots.map((root) => root.accountId)),
    ].sort(),
    historicalMutationAuthorized: false,
    runtimeMutationAuthorized: false,
    liveMoneyAuthorized: false,
  });
}

function admissionRootFromReceipt(
  root: Readonly<ReceiptBoundRuntimeRoot>,
): Readonly<Rc54AdmissionRoot> {
  return Object.freeze({
    slug: root.slug,
    domainId: root.domainId,
    familyId: root.familyId,
    underlying: root.underlying,
    maxEntriesPerSession: root.maxEntriesPerSession,
    quantity: root.quantity,
    premiumCap: root.premiumCap,
    aggregateDebitCap: root.aggregateDebitCap,
    managerProfileId: root.managerProfileId,
    accountId: root.accountId,
    bankTargetPct: root.takeProfit.kind === "bank"
      ? root.takeProfit.targetPct
      : null,
    runnerKind: root.ratchetParameters.kind,
    configurationEpochId: root.configuration.configurationEpochId,
    entryQualificationVersion: root.entryQualificationVersion,
    entryStartEtMinute: root.entryStartEtMinute,
    standDownDayTags: root.standDownDayTags,
  });
}

export function buildReceiptBoundRc54AdmissionPolicies(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): readonly Readonly<AdmissionDomainPolicy>[] {
  const topologyErrors = validateReceiptBoundRc54Topology(runtime);
  if (topologyErrors.length) throw new Error(topologyErrors.join(";"));
  const errors: string[] = [];
  const policies = runtime.admissionPolicies.map((observed) => {
    const expectedPriorities = Object.fromEntries(runtime.roots
      .filter((root) => root.domainId === observed.id)
      .map((root): [string, number] => [root.slug, root.priority])
      .sort(([left], [right]) => left.localeCompare(right)));
    if (JSON.stringify(
      Object.fromEntries(Object.entries(observed.priorityBySlug).sort()),
    ) !== JSON.stringify(expectedPriorities)) {
      errors.push(`temporary_rc54_adapter:${observed.id}:admission_priority`);
    }
    return Object.freeze({
      ...observed,
      reentry: observed.reentry === "bounded" ? "allowed" : "disabled",
    }) as Readonly<AdmissionDomainPolicy>;
  });
  if (errors.length) throw new Error(uniqueSorted(errors).join(";"));
  return Object.freeze(policies);
}

export function buildReceiptBoundRc54AdmissionRootResolver(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): Rc54AdmissionRootResolver {
  const errors = validateReceiptBoundRc54Topology(runtime);
  if (errors.length) {
    throw new Error(errors.join(";"));
  }
  const roots = new Map(
    runtime.roots.map((root) => [
      root.slug,
      admissionRootFromReceipt(root),
    ]),
  );
  return (slug: string) => roots.get(slug.toLowerCase()) ?? null;
}

export function receiptBoundRc54ConfigurationWriteStamp(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
  channelSlug: string,
): Readonly<ReceiptBoundConfigurationWriteStamp> {
  const errors = validateReceiptBoundRc54Topology(runtime);
  if (errors.length) throw new Error(errors.join(";"));
  return configurationWriteStampForChannel({ runtime, channelSlug });
}

export function receiptBoundRc54ReleaseEvidenceContext(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
  channelSlug: string,
): Readonly<ReleaseEvidenceContext> {
  const errors = validateReceiptBoundRc54Topology(runtime);
  if (errors.length) throw new Error(errors.join(";"));
  const root = runtime.roots.find((candidate) =>
    candidate.slug === channelSlug);
  if (!root) {
    throw new Error(`temporary_rc54_adapter:root_missing:${channelSlug}`);
  }
  const match = SHA256.exec(runtime.manifestContentHash);
  if (!match) {
    throw new Error("temporary_rc54_adapter:manifest_hash_invalid");
  }
  const cohortFrom = runtime.activatedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cohortFrom)) {
    throw new Error("temporary_rc54_adapter:activation_date_invalid");
  }
  return Object.freeze({
    schemaVersion: RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    releaseId: runtime.releaseId,
    configurationSha256: match[1].toLowerCase(),
    admissionDomain: root.domainId,
    cohortId: `epoch-${runtime.configurationEpochId.replace(/^sha256:/, "").slice(0, 16)}`,
    cohortFrom,
    evidenceEra: root.cohort === "lab"
      ? "lab-executable"
      : "rc54-control",
    sourceQuantity: root.quantity,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
  });
}

export function receiptBoundRc54CandidateIdentity(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): Readonly<Rc54AdmissionCandidateIdentity> {
  const errors = validateReceiptBoundRc54Topology(runtime);
  if (errors.length) throw new Error(errors.join(";"));
  const match = SHA256.exec(runtime.manifestContentHash);
  if (!match) {
    throw new Error("temporary_rc54_adapter:manifest_hash_invalid");
  }
  const cohortFrom = runtime.activatedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cohortFrom)) {
    throw new Error("temporary_rc54_adapter:activation_date_invalid");
  }
  return Object.freeze({
    releaseId: runtime.releaseId,
    configurationSha256: match[1].toLowerCase(),
    cohortId: `epoch-${runtime.configurationEpochId.replace(/^sha256:/, "").slice(0, 16)}`,
    cohortFrom,
  });
}

export interface ReceiptBoundRestartValidation {
  ok: boolean;
  errors: string[];
}

/**
 * A receipt-bound restart may coexist with positions opened under older
 * epochs, but every open row must already carry an immutable manager policy.
 * There is no current-channel fallback.
 */
export function validateReceiptBoundRc54RestartRows(input: {
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>;
  channels: readonly Pick<ChannelConfig, "id" | "slug">[];
  rows: readonly PositionRow[];
}): Readonly<ReceiptBoundRestartValidation> {
  const errors = validateReceiptBoundRc54Topology(input.runtime);
  const channelById = new Map(input.channels.map((channel) => [
    channel.id,
    channel,
  ]));
  const rootBySlug = new Map(input.runtime.roots.map((root) => [
    root.slug,
    root,
  ]));
  for (const row of input.rows) {
    const channel = channelById.get(row.strategist_id);
    const root = channel ? rootBySlug.get(channel.slug) : null;
    if (!channel || !root) {
      errors.push(`temporary_rc54_adapter:open_position_outside_runtime:${row.id}`);
      continue;
    }
    if (receiptBoundEntryPolicyStampPresent(row)) {
      const policy = receiptBoundEntryPolicyFromRow(row);
      if (!policy) {
        errors.push(`temporary_rc54_adapter:open_position_policy_invalid:${row.id}`);
        continue;
      }
      if (policy.configuration.channelSlug !== root.slug
          || policy.configuration.accountId !== root.accountId) {
        errors.push(`temporary_rc54_adapter:open_position_route_mismatch:${row.id}`);
      }
      continue;
    }
    if (rc54ManagerStampPresent(row)) {
      if (!rc54ManagerProfileFromRow(row)) {
        errors.push(`temporary_rc54_adapter:open_position_rc54_policy_invalid:${row.id}`);
      }
      continue;
    }
    errors.push(`temporary_rc54_adapter:open_position_policy_missing:${row.id}`);
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: uniqueSorted(errors),
  });
}
