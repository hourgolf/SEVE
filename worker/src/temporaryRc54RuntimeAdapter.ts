import { MANAGER_SHADOW_BOOK_VERSION } from "./managerShadowBookModel.js";
import {
  rc54ManagerProfileFromRow,
  rc54ManagerStampPresent,
} from "./rc54ManagerPolicy.js";
import {
  RC54_CONTROL_ADMISSION_POLICY,
  RC54_LAB_ADMISSION_POLICY,
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
  "temporary-rc54-runtime-adapter-v2" as const;

const SHA256 = /^sha256:([0-9a-f]{64})$/i;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * RC5.4 remains the temporary topology and admission adapter. Only the bounded
 * economics and bounded sequential re-entry represented by a receipt-bound
 * root may vary. A topology, route, scaling, or concurrency change requires a
 * different reviewed adapter.
 */
export function validateReceiptBoundRc54Topology(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): string[] {
  const errors: string[] = [];
  const expectedBySlug = new Map<string, (typeof RC54_ROOTS)[number]>(
    RC54_ROOTS.map((root) => [root.slug, root] as const),
  );
  const observedBySlug = new Map<string, Readonly<ReceiptBoundRuntimeRoot>>();
  for (const root of runtime.roots) {
    if (observedBySlug.has(root.slug)) {
      errors.push(`temporary_rc54_adapter:duplicate_root:${root.slug}`);
    }
    observedBySlug.set(root.slug, root);
  }
  if (runtime.roots.length !== RC54_ROOTS.length) {
    errors.push(
      `temporary_rc54_adapter:root_count:${runtime.roots.length}:${RC54_ROOTS.length}`,
    );
  }
  for (const expected of RC54_ROOTS) {
    const root = observedBySlug.get(expected.slug);
    if (!root) {
      errors.push(`temporary_rc54_adapter:root_missing:${expected.slug}`);
      continue;
    }
    const topology: Array<[string, unknown, unknown]> = [
      ["cohort", root.cohort, expected.cohort],
      ["domain", root.domainId, expected.domainId],
      ["family", root.familyId, expected.familyId],
      ["underlying", root.underlying, expected.underlying],
      ["priority", root.priority, expected.priority],
      ["entry_dte", root.entryDte, expected.entryDte],
      ["strike_offset", root.strikeOffset, expected.strikeOffset],
      ["strategist", root.strategistId, expected.strategistId],
      ["account", root.accountId, expected.accountId],
    ];
    for (const [field, actual, sealed] of topology) {
      if (actual !== sealed) {
        errors.push(`temporary_rc54_adapter:${expected.slug}:${field}`);
      }
    }
    if (root.reentryPolicy === "disabled" && root.maxEntriesPerSession !== 1) {
      errors.push(`temporary_rc54_adapter:${expected.slug}:reentry`);
    } else if (root.reentryPolicy === "bounded"
        && (!Number.isInteger(root.maxEntriesPerSession)
          || root.maxEntriesPerSession < 2
          || root.maxEntriesPerSession > 3)) {
      errors.push(`temporary_rc54_adapter:${expected.slug}:reentry`);
    }
    if (root.scalePolicy.adds !== 0
        || root.scalePolicy.pyramiding !== "disabled") {
      errors.push(`temporary_rc54_adapter:${expected.slug}:scaling`);
    }
  }
  for (const slug of observedBySlug.keys()) {
    if (!expectedBySlug.has(slug)) {
      errors.push(`temporary_rc54_adapter:unexpected_root:${slug}`);
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
    paperOnly: true,
    roots: input.runtime.roots.map((root) => ({
      slug: root.slug,
      accountId: root.accountId,
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
  });
}

export function buildReceiptBoundRc54AdmissionPolicies(
  runtime: Readonly<ReceiptBoundRuntimeConfiguration>,
): readonly Readonly<AdmissionDomainPolicy>[] {
  const topologyErrors = validateReceiptBoundRc54Topology(runtime);
  if (topologyErrors.length) throw new Error(topologyErrors.join(";"));
  const sealedById = new Map([
    [RC54_CONTROL_ADMISSION_POLICY.id, RC54_CONTROL_ADMISSION_POLICY],
    [RC54_LAB_ADMISSION_POLICY.id, RC54_LAB_ADMISSION_POLICY],
  ]);
  const errors: string[] = [];
  const policies = runtime.admissionPolicies.map((observed) => {
    const sealed = sealedById.get(observed.id);
    if (!sealed) {
      errors.push(`temporary_rc54_adapter:admission_policy_unexpected:${observed.id}`);
      return null;
    }
    for (const [field, actual, expected] of [
      ["enabled", observed.enabledForNewEntries, sealed.enabledForNewEntries],
      ["family", observed.maxOpenPerFamily, sealed.maxOpenPerFamily],
      ["global", observed.maxOpenGlobal, sealed.maxOpenGlobal],
      ["same_occ", observed.sameOccOpenMax, sealed.sameOccOpenMax],
      ["cross_domain_occ", observed.crossDomainSameOcc, sealed.crossDomainSameOcc],
    ] as const) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(`temporary_rc54_adapter:${observed.id}:admission_${field}`);
      }
    }
    for (const [field, actual, expected] of [
      ["underlying", observed.maxOpenByUnderlying, sealed.maxOpenByUnderlying],
      ["clock", observed.sameClockMaxByUnderlying, sealed.sameClockMaxByUnderlying],
      ["priority", observed.priorityBySlug, sealed.priorityBySlug],
    ] as const) {
      if (JSON.stringify(
        Object.fromEntries(Object.entries(actual).sort()),
      ) !== JSON.stringify(
        Object.fromEntries(Object.entries(expected).sort()),
      )) {
        errors.push(`temporary_rc54_adapter:${observed.id}:admission_${field}`);
      }
    }
    return Object.freeze({
      ...observed,
      reentry: observed.reentry === "bounded" ? "allowed" : "disabled",
    }) as Readonly<AdmissionDomainPolicy>;
  }).filter((policy): policy is Readonly<AdmissionDomainPolicy> => policy !== null);
  if (policies.length !== sealedById.size) {
    errors.push(`temporary_rc54_adapter:admission_policy_count:${policies.length}:${sealedById.size}`);
  }
  for (const id of sealedById.keys()) {
    if (!policies.some((policy) => policy.id === id)) {
      errors.push(`temporary_rc54_adapter:admission_policy_missing:${id}`);
    }
  }
  for (const policy of policies) {
    const boundedRootPresent = runtime.roots.some((root) =>
      root.domainId === policy.id && root.reentryPolicy === "bounded");
    if ((policy.reentry === "allowed") !== boundedRootPresent) {
      errors.push(`temporary_rc54_adapter:${policy.id}:admission_reentry`);
    }
  }
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
