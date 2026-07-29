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
  "temporary-rc54-runtime-adapter-v1" as const;

const SHA256 = /^sha256:([0-9a-f]{64})$/i;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * RC5.4 remains the temporary topology and admission adapter. Only the bounded
 * economics represented by a receipt-bound root may vary. A topology, route,
 * re-entry, or scaling change requires a different reviewed adapter.
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
    if (root.reentryPolicy !== "disabled") {
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

function admissionRootFromReceipt(
  root: Readonly<ReceiptBoundRuntimeRoot>,
): Readonly<Rc54AdmissionRoot> {
  return Object.freeze({
    slug: root.slug,
    domainId: root.domainId,
    familyId: root.familyId,
    underlying: root.underlying,
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
