// Roster-neutral LAB canary foundation. This file intentionally contains no
// selected channel slugs and no executable manager settings. Tomorrow's T+1
// replay and operator review must seal both before new entries can be enabled.

import { createHash } from "node:crypto";
import type { AdmissionDomainPolicy } from "./admissionDomainModel.js";
import {
  RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
  type ReleaseEvidenceContext,
} from "./releaseEvidenceContext.js";
import { MANAGER_SHADOW_BOOK_VERSION } from "./managerShadowBookModel.js";

export const LAB_CANARY_FOUNDATION_SCHEMA_VERSION = 1 as const;
export const LAB_CANARY_FOUNDATION_ID = "week2-lab-canary-foundation-2026-07-26-v1" as const;
export const LAB_CANARY_ADMISSION_DOMAIN = "lab-canary" as const;
export const RC5_CONTROL_ADMISSION_DOMAIN = "rc5-control" as const;
export const LAB_ACCOUNT_ID = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1" as const;

export const LAB_CANARY_ADMISSION_POLICY: AdmissionDomainPolicy = {
  id: LAB_CANARY_ADMISSION_DOMAIN,
  enabledForNewEntries: false,
  maxOpenPerFamily: 1,
  maxOpenByUnderlying: { SPY: 1, QQQ: 1, IWM: 1 },
  maxOpenGlobal: 3,
  sameOccOpenMax: 1,
  reentry: "disabled",
  sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 1 },
  priorityBySlug: {},
  crossDomainSameOcc: "allow-with-receipt",
};

export const LAB_CANARY_FOUNDATION = {
  schemaVersion: LAB_CANARY_FOUNDATION_SCHEMA_VERSION,
  foundationId: LAB_CANARY_FOUNDATION_ID,
  mode: "paper-only",
  lifecycle: {
    state: "prepared-unsealed",
    activeRoster: [] as readonly string[],
    candidateCount: { min: 2, max: 3 },
    rosterSealed: false,
    configurationSealed: false,
    operatorActivationAuthorized: false,
    automaticPromotionAuthorized: false,
  },
  account: {
    id: LAB_ACCOUNT_ID,
    mode: "paper",
    isolatedFromRc5ControlAccounts: true,
  },
  sizing: {
    sourceQuantity: 2,
    integerManagerAllocationRequired: true,
    sourceQuantityChangesRequireNewCohort: true,
  },
  evidence: {
    contextSchemaVersion: RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    evidenceEra: "lab-executable",
    cohortId: null as string | null,
    cohortFrom: null as string | null,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
    heldCaptureRequired: true,
    managerShadowRequired: true,
    crossDomainCovarianceReceiptRequired: true,
  },
  management: {
    executableProfileSealed: false,
    supportedPrimitives: [
      "premium-catastrophe-stop",
      "fixed-take-profit",
      "giveback-ratchet",
      "bank-runner",
      "timed-flatten",
      "reentry",
      "scaled-entry",
      "scaled-exit",
    ],
    selectedProfile: null as Record<string, unknown> | null,
  },
  admission: LAB_CANARY_ADMISSION_POLICY,
  authority: {
    liveMoneyAuthorized: false,
    migrationAuthorized: false,
    databaseMutationAuthorized: false,
    deploymentAuthorized: false,
  },
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => `${JSON.stringify(name)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const LAB_CANARY_FOUNDATION_JSON = canonical(LAB_CANARY_FOUNDATION);
export const LAB_CANARY_FOUNDATION_SHA256 = createHash("sha256")
  .update(LAB_CANARY_FOUNDATION_JSON).digest("hex");

export interface LabCanaryCandidateBinding {
  slug: string;
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  priority: number;
  strategistId: string;
  accountId: typeof LAB_ACCOUNT_ID;
  accountMode: "paper";
  quantity: 2;
  premiumCap: number;
  aggregateDebitCap: number;
  channelVersion: string;
  managerVersion: string;
  configurationEpoch: string;
  policyEpoch: string;
  managementProfile: Readonly<Record<string, unknown>>;
}

export interface LabCanaryReleaseDraft {
  releaseId: string;
  configurationSha256: string;
  cohortId: string;
  cohortFrom: string;
  roster: readonly LabCanaryCandidateBinding[];
  admissionPolicy: AdmissionDomainPolicy;
  rosterSealed: boolean;
  configurationSealed: boolean;
  operatorActivationAuthorized: boolean;
}

const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function labCanaryReleaseConfigurationSha256(
  release: Omit<LabCanaryReleaseDraft, "configurationSha256" | "operatorActivationAuthorized">,
): string {
  return createHash("sha256").update(canonical({
    schemaVersion: LAB_CANARY_FOUNDATION_SCHEMA_VERSION,
    foundationId: LAB_CANARY_FOUNDATION_ID,
    releaseId: release.releaseId,
    cohortId: release.cohortId,
    cohortFrom: release.cohortFrom,
    account: LAB_CANARY_FOUNDATION.account,
    sizing: LAB_CANARY_FOUNDATION.sizing,
    evidence: {
      contextSchemaVersion: LAB_CANARY_FOUNDATION.evidence.contextSchemaVersion,
      evidenceEra: LAB_CANARY_FOUNDATION.evidence.evidenceEra,
      shadowBookVersion: LAB_CANARY_FOUNDATION.evidence.shadowBookVersion,
      heldCaptureRequired: LAB_CANARY_FOUNDATION.evidence.heldCaptureRequired,
      managerShadowRequired: LAB_CANARY_FOUNDATION.evidence.managerShadowRequired,
      crossDomainCovarianceReceiptRequired:
        LAB_CANARY_FOUNDATION.evidence.crossDomainCovarianceReceiptRequired,
    },
    roster: release.roster,
    admissionPolicy: release.admissionPolicy,
    rosterSealed: release.rosterSealed,
    configurationSealed: release.configurationSealed,
  })).digest("hex");
}

export function sealLabCanaryReleaseDraft(
  release: Omit<LabCanaryReleaseDraft, "configurationSha256">,
): LabCanaryReleaseDraft {
  const configurationSha256 = labCanaryReleaseConfigurationSha256(release);
  return { ...release, configurationSha256 };
}

export function validateLabCanaryReleaseDraft(input: {
  enabledForNewEntries: boolean;
  expectedConfigurationSha256: string;
  release: LabCanaryReleaseDraft | null;
}): string[] {
  const errors: string[] = [];
  if (!input.enabledForNewEntries) errors.push("lab_new_entries_disabled");
  if (!input.release) return [...errors, "lab_release_missing"];
  const release = input.release;
  if (!release.rosterSealed) errors.push("lab_roster_unsealed");
  if (!release.configurationSealed) errors.push("lab_configuration_unsealed");
  if (!release.operatorActivationAuthorized) errors.push("lab_operator_activation_missing");
  if (!SHA256.test(release.configurationSha256)) errors.push("lab_configuration_hash");
  const computedConfigurationSha256 = labCanaryReleaseConfigurationSha256(release);
  if (release.configurationSha256 !== computedConfigurationSha256) {
    errors.push("lab_configuration_hash_mismatch");
  }
  if (input.expectedConfigurationSha256 !== release.configurationSha256) {
    errors.push("lab_expected_configuration_hash");
  }
  if (!release.releaseId.trim()) errors.push("lab_release_id");
  if (!release.cohortId.trim()) errors.push("lab_cohort_id");
  if (!DATE.test(release.cohortFrom)) errors.push("lab_cohort_from");
  const { min, max } = LAB_CANARY_FOUNDATION.lifecycle.candidateCount;
  if (release.roster.length < min || release.roster.length > max) errors.push("lab_roster_count");
  const slugs = new Set<string>();
  const families = new Set<string>();
  const prioritiesByUnderlying = new Map<string, Set<number>>();
  for (const row of release.roster) {
    if (!row.slug.trim() || slugs.has(row.slug)) errors.push(`${row.slug || "<missing>"}:slug`);
    slugs.add(row.slug);
    if (!row.familyId.trim() || families.has(row.familyId)) errors.push(`${row.slug}:family`);
    families.add(row.familyId);
    if (!Number.isInteger(row.priority) || row.priority < 1) errors.push(`${row.slug}:priority`);
    const priorities = prioritiesByUnderlying.get(row.underlying) ?? new Set<number>();
    if (priorities.has(row.priority)) errors.push(`${row.slug}:priority_collision`);
    priorities.add(row.priority);
    prioritiesByUnderlying.set(row.underlying, priorities);
    if (row.accountId !== LAB_ACCOUNT_ID || row.accountMode !== "paper") errors.push(`${row.slug}:account`);
    if (row.quantity !== 2) errors.push(`${row.slug}:quantity`);
    if (!(row.premiumCap > 0) || !(row.aggregateDebitCap > 0)
      || row.aggregateDebitCap + 1e-9 < row.quantity * row.premiumCap * 100) {
      errors.push(`${row.slug}:debit_cap`);
    }
    if (!UUID.test(row.strategistId)) errors.push(`${row.slug}:strategist_id`);
    if (![row.channelVersion, row.managerVersion, row.configurationEpoch].every((value) => SHA256.test(value))) {
      errors.push(`${row.slug}:identity_hash`);
    }
    if (!UUID.test(row.policyEpoch)) errors.push(`${row.slug}:policy_epoch`);
    if (!Object.keys(row.managementProfile).length) errors.push(`${row.slug}:management_profile`);
    if (release.admissionPolicy.priorityBySlug[row.slug] !== row.priority) {
      errors.push(`${row.slug}:admission_priority`);
    }
  }
  if (release.admissionPolicy.id !== LAB_CANARY_ADMISSION_DOMAIN) {
    errors.push("lab_admission_domain");
  }
  if (!release.admissionPolicy.enabledForNewEntries) errors.push("lab_admission_disabled");
  if (release.admissionPolicy.maxOpenPerFamily !== 1) errors.push("lab_family_concurrency");
  if (release.admissionPolicy.sameOccOpenMax !== 1) errors.push("lab_same_occ_concurrency");
  if (release.admissionPolicy.crossDomainSameOcc !== "allow-with-receipt") {
    errors.push("lab_cross_domain_receipt");
  }
  if (!Number.isInteger(release.admissionPolicy.maxOpenGlobal)
    || release.admissionPolicy.maxOpenGlobal < 1
    || release.admissionPolicy.maxOpenGlobal > release.roster.length) {
    errors.push("lab_global_concurrency");
  }
  for (const underlying of new Set(release.roster.map((row) => row.underlying))) {
    const cap = release.admissionPolicy.maxOpenByUnderlying[underlying];
    const clockCap = release.admissionPolicy.sameClockMaxByUnderlying[underlying];
    if (!Number.isInteger(cap) || cap < 1) errors.push(`${underlying}:underlying_concurrency`);
    if (!Number.isInteger(clockCap) || clockCap < 1) errors.push(`${underlying}:same_clock_concurrency`);
  }
  return [...new Set(errors)].sort();
}

export function labCanaryEvidenceContext(
  release: LabCanaryReleaseDraft,
): ReleaseEvidenceContext | null {
  if (validateLabCanaryReleaseDraft({
    enabledForNewEntries: true,
    expectedConfigurationSha256: release.configurationSha256,
    release,
  }).length) return null;
  return {
    schemaVersion: RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    releaseId: release.releaseId,
    configurationSha256: release.configurationSha256.replace(/^sha256:/, ""),
    admissionDomain: LAB_CANARY_ADMISSION_DOMAIN,
    cohortId: release.cohortId,
    cohortFrom: release.cohortFrom,
    evidenceEra: "lab-executable",
    sourceQuantity: 2,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
  };
}

export function labCanaryFoundationReceipt(): Record<string, unknown> {
  return {
    foundationId: LAB_CANARY_FOUNDATION_ID,
    foundationSha256: LAB_CANARY_FOUNDATION_SHA256,
    state: LAB_CANARY_FOUNDATION.lifecycle.state,
    newEntriesEnabled: false,
    rosterSealed: false,
    configurationSealed: false,
    operatorActivationAuthorized: false,
    activeRosterCount: 0,
    sourceQuantity: LAB_CANARY_FOUNDATION.sizing.sourceQuantity,
    admissionDomain: LAB_CANARY_ADMISSION_DOMAIN,
    controlDomain: RC5_CONTROL_ADMISSION_DOMAIN,
    pending: [
      "tomorrow_t1_exact_replay",
      "operator_roster_selection",
      "executable_management_profile",
      "candidate_identity_seal",
      "cohort_start",
      "deployment_authorization",
    ],
  };
}
