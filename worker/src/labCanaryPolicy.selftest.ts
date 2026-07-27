import assert from "node:assert/strict";
import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig } from "./store.js";
import {
  buildAdmissionDomainsState,
  finalizeAdmissionDomains,
  type AdmissionDomainPolicy,
  type DomainAdmissionCandidate,
} from "./admissionDomainModel.js";
import {
  LAB_ACCOUNT_ID,
  LAB_CANARY_ADMISSION_DOMAIN,
  LAB_CANARY_ADMISSION_POLICY,
  LAB_CANARY_FOUNDATION,
  LAB_CANARY_FOUNDATION_SHA256,
  labCanaryEvidenceContext,
  labCanaryFoundationReceipt,
  sealLabCanaryReleaseDraft,
  type LabCanaryCandidateBinding,
  type LabCanaryReleaseDraft,
  validateLabCanaryReleaseDraft,
} from "./labCanaryPolicy.js";
import { observedPolicyIdentity } from "./planShadowModel.js";
import {
  releaseEvidenceStamp,
  validateReleaseEvidenceContext,
} from "./releaseEvidenceContext.js";

let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, label);
  checks++;
};

check("foundation is roster neutral and fail closed", [
  LAB_CANARY_FOUNDATION.lifecycle.state,
  LAB_CANARY_FOUNDATION.lifecycle.activeRoster,
  LAB_CANARY_FOUNDATION.lifecycle.rosterSealed,
  LAB_CANARY_FOUNDATION.lifecycle.configurationSealed,
  LAB_CANARY_ADMISSION_POLICY.enabledForNewEntries,
], ["prepared-unsealed", [], false, false, false]);
check("two contracts are fixed while executable management remains unsealed", [
  LAB_CANARY_FOUNDATION.sizing.sourceQuantity,
  LAB_CANARY_FOUNDATION.sizing.integerManagerAllocationRequired,
  LAB_CANARY_FOUNDATION.management.executableProfileSealed,
  LAB_CANARY_FOUNDATION.management.selectedProfile,
], [2, true, false, null]);
check("foundation hash is deterministic SHA-256",
  /^[a-f0-9]{64}$/.test(LAB_CANARY_FOUNDATION_SHA256), true);
check("foundation receipt cannot imply activation", labCanaryFoundationReceipt(), {
  foundationId: "week2-lab-canary-foundation-2026-07-26-v1",
  foundationSha256: LAB_CANARY_FOUNDATION_SHA256,
  state: "prepared-unsealed",
  newEntriesEnabled: false,
  rosterSealed: false,
  configurationSealed: false,
  operatorActivationAuthorized: false,
  activeRosterCount: 0,
  sourceQuantity: 2,
  admissionDomain: "lab-canary",
  controlDomain: "rc5-control",
  pending: [
    "tomorrow_t1_exact_replay",
    "operator_roster_selection",
    "executable_management_profile",
    "candidate_identity_seal",
    "cohort_start",
    "deployment_authorization",
  ],
});

const sha = (letter: string): string => letter.repeat(64);
const candidate = (
  slug: string,
  familyId: string,
  underlying: "SPY" | "QQQ" | "IWM",
  strategistId: string,
): LabCanaryCandidateBinding => ({
  slug,
  familyId,
  underlying,
  priority: 1,
  strategistId,
  accountId: LAB_ACCOUNT_ID,
  accountMode: "paper",
  quantity: 2,
  premiumCap: 2,
  aggregateDebitCap: 400,
  channelVersion: `sha256:${sha("a")}`,
  managerVersion: `sha256:${sha("b")}`,
  configurationEpoch: `sha256:${sha("c")}`,
  policyEpoch: "11111111-1111-5111-8111-111111111111",
  managementProfile: { kind: "fixture-only-sealed-manager" },
});
const sealedRelease: LabCanaryReleaseDraft = sealLabCanaryReleaseDraft({
  releaseId: "week2-lab-canary-fixture-rc1",
  cohortId: "lab-fixture-2026-07-27",
  cohortFrom: "2026-07-27",
  roster: [
    candidate("candidate-spy", "SPY-FIXTURE", "SPY", "22222222-2222-5222-8222-222222222222"),
    candidate("candidate-qqq", "QQQ-FIXTURE", "QQQ", "33333333-3333-5333-8333-333333333333"),
  ],
  admissionPolicy: {
    ...LAB_CANARY_ADMISSION_POLICY,
    enabledForNewEntries: true,
    maxOpenGlobal: 2,
    priorityBySlug: { "candidate-spy": 1, "candidate-qqq": 1 },
  },
  rosterSealed: true,
  configurationSealed: true,
  operatorActivationAuthorized: true,
});
check("missing release stays fail closed", validateLabCanaryReleaseDraft({
  enabledForNewEntries: true,
  expectedConfigurationSha256: "",
  release: null,
}), ["lab_release_missing"]);
check("a complete fixture can be sealed without hard-coding tonight's roster",
  validateLabCanaryReleaseDraft({
    enabledForNewEntries: true,
    expectedConfigurationSha256: sealedRelease.configurationSha256,
    release: sealedRelease,
  }), []);
const { configurationSha256: _sealedHash, ...sealedReleaseInput } = sealedRelease;
const oneContractRelease = sealLabCanaryReleaseDraft({
  ...sealedReleaseInput,
  roster: [{ ...sealedRelease.roster[0], quantity: 1 as 2 }, sealedRelease.roster[1]],
});
check("one-contract candidates cannot activate the manager cohort",
  validateLabCanaryReleaseDraft({
    enabledForNewEntries: true,
    expectedConfigurationSha256: oneContractRelease.configurationSha256,
    release: oneContractRelease,
  }), ["candidate-spy:quantity"]);
const missingManagementRelease = sealLabCanaryReleaseDraft({
  ...sealedReleaseInput,
  roster: [{ ...sealedRelease.roster[0], managementProfile: {} }, sealedRelease.roster[1]],
});
check("an unsealed management profile blocks activation",
  validateLabCanaryReleaseDraft({
    enabledForNewEntries: true,
    expectedConfigurationSha256: missingManagementRelease.configurationSha256,
    release: missingManagementRelease,
  }), ["candidate-spy:management_profile"]);
check("a hand-edited release hash is rejected", validateLabCanaryReleaseDraft({
  enabledForNewEntries: true,
  expectedConfigurationSha256: sha("e"),
  release: { ...sealedRelease, configurationSha256: sha("e") },
}), ["lab_configuration_hash_mismatch"]);

const context = labCanaryEvidenceContext(sealedRelease);
check("sealed release produces complete executable-era attribution",
  context && validateReleaseEvidenceContext(context), []);
check("unknown evidence eras fail closed",
  validateReleaseEvidenceContext({
    ...context!,
    evidenceEra: "unregistered-era",
  } as unknown as Parameters<typeof validateReleaseEvidenceContext>[0]), ["evidence_era"]);
check("evidence stamp carries domain, cohort, quantity, and manager book", releaseEvidenceStamp(context), {
  schemaVersion: 1,
  releaseId: "week2-lab-canary-fixture-rc1",
  configurationSha256: sealedRelease.configurationSha256,
  admissionDomain: LAB_CANARY_ADMISSION_DOMAIN,
  cohortId: "lab-fixture-2026-07-27",
  cohortFrom: "2026-07-27",
  evidenceEra: "lab-executable",
  sourceQuantity: 2,
  shadowBookVersion: LAB_CANARY_FOUNDATION.evidence.shadowBookVersion,
});

const decision = (slug: string, occ: string): ShadowDecision => ({
  slug,
  status: "armed",
  action: "enter",
  reason: "fixture",
  direction: "call",
  occ,
  qty: 2,
  blocked: null,
  detail: { ask: 1 },
});
const policy = (
  id: string,
  priorityBySlug: Readonly<Record<string, number>> = {},
): AdmissionDomainPolicy => ({
  ...LAB_CANARY_ADMISSION_POLICY,
  id,
  enabledForNewEntries: true,
  priorityBySlug,
});
const domainCandidate = (
  domainId: string,
  slug: string,
  familyId: string,
  underlying: string,
  occ: string,
  sourceBarAtMs = 1,
): DomainAdmissionCandidate => ({
  domainId,
  accountId: domainId === "lab-canary" ? LAB_ACCOUNT_ID : "control-account",
  familyId,
  underlying,
  sourceBarAtMs,
  decision: decision(slug, occ),
});

const sharedOcc = "SPY260727C00700000";
const crossState = buildAdmissionDomainsState({
  open: [{
    domainId: "rc5-control",
    accountId: "control-account",
    familyId: "SPY-CONTROL",
    underlying: "SPY",
    occSymbol: sharedOcc,
  }],
  sessionEntries: [],
});
const [crossDomain] = finalizeAdmissionDomains({
  candidates: [domainCandidate("lab-canary", "lab-spy", "SPY-LAB", "SPY", sharedOcc)],
  policies: new Map([
    ["rc5-control", policy("rc5-control")],
    ["lab-canary", policy("lab-canary", { "lab-spy": 1 })],
  ]),
  state: crossState,
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("same OCC across isolated paper domains is admitted with a covariance receipt",
  [crossDomain.decision.blocked, crossDomain.covarianceReceipts], [null, [{
    kind: "cross-domain-same-occ",
    occSymbol: sharedOcc,
    candidateDomain: "lab-canary",
    observedOpenDomains: ["rc5-control"],
  }]]);

const withinState = buildAdmissionDomainsState({
  open: [{
    domainId: "lab-canary",
    accountId: LAB_ACCOUNT_ID,
    familyId: "SPY-OTHER",
    underlying: "SPY",
    occSymbol: sharedOcc,
  }],
  sessionEntries: [],
});
const [withinDomain] = finalizeAdmissionDomains({
  candidates: [domainCandidate("lab-canary", "lab-spy", "SPY-LAB", "SPY", sharedOcc)],
  policies: new Map([["lab-canary", policy("lab-canary")]]),
  state: withinState,
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("same OCC inside LAB remains blocked", withinDomain.decision.blocked,
  "admission_domain_same_occ_open");

const disabledState = buildAdmissionDomainsState({ open: [], sessionEntries: [] });
const [disabled] = finalizeAdmissionDomains({
  candidates: [domainCandidate("lab-canary", "lab-spy", "SPY-LAB", "SPY", sharedOcc)],
  policies: new Map([["lab-canary", LAB_CANARY_ADMISSION_POLICY]]),
  state: disabledState,
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("foundation policy itself can never open a position", disabled.decision.blocked,
  "admission_domain_new_entries_disabled");

const sameClockState = buildAdmissionDomainsState({ open: [], sessionEntries: [] });
const sameClock = finalizeAdmissionDomains({
  candidates: [
    domainCandidate("lab-canary", "lab-spy-secondary", "SPY-SECONDARY", "SPY", "SPY260727C00701000", 2),
    domainCandidate("lab-canary", "lab-spy-primary", "SPY-PRIMARY", "SPY", "SPY260727C00702000", 2),
  ],
  policies: new Map([["lab-canary", policy("lab-canary", {
    "lab-spy-primary": 1,
    "lab-spy-secondary": 2,
  })]]),
  state: sameClockState,
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("LAB same-clock arbitration is deterministic within its own domain",
  sameClock.map((row) => [row.decision.slug, row.decision.blocked]), [
    ["lab-spy-secondary", "admission_domain_same_clock_collision"],
    ["lab-spy-primary", null],
  ]);

const reentryState = buildAdmissionDomainsState({
  open: [],
  sessionEntries: [{ domainId: "lab-canary", familyId: "SPY-LAB" }],
});
const [reentry] = finalizeAdmissionDomains({
  candidates: [domainCandidate("lab-canary", "lab-spy", "SPY-LAB", "SPY", sharedOcc)],
  policies: new Map([["lab-canary", policy("lab-canary")]]),
  state: reentryState,
  globalPositionTruthComplete: true,
  globalOrderTruthComplete: true,
});
check("re-entry remains a versioned policy decision and defaults closed",
  reentry.decision.blocked, "admission_domain_reentry_disabled");

const incompleteTruthState = buildAdmissionDomainsState({ open: [], sessionEntries: [] });
const [incompleteTruth] = finalizeAdmissionDomains({
  candidates: [domainCandidate("lab-canary", "lab-spy", "SPY-LAB", "SPY", sharedOcc)],
  policies: new Map([["lab-canary", policy("lab-canary")]]),
  state: incompleteTruthState,
  globalPositionTruthComplete: false,
  globalOrderTruthComplete: true,
});
check("LAB entries fail closed when global broker position truth is incomplete",
  incompleteTruth.decision.blocked, "admission_global_snapshot_incomplete");

const channel: ChannelConfig = {
  id: "22222222-2222-5222-8222-222222222222",
  slug: "candidate-spy",
  name: "candidate-spy",
  status: "armed",
  spec_json: null,
  underlying: "SPY",
  executor: "stream",
  account_id: LAB_ACCOUNT_ID,
  is_active: true,
  capital_pct: 120,
  aggression: 0,
  max_contracts: 2,
  daily_stop_usd: 0,
  daily_target_usd: 0,
  underlying_stop_pct: 0,
  muted: false,
  soloed: false,
  boosted: false,
  event_policy: "standdown",
  entry_dte: 0,
  strike_offset: 0,
  premium_stop_pct: 30,
  take_profit_pct: 0,
  pyramid_adds: 0,
  stall_minutes: 0,
  stall_max_favor_pct: 0,
  gap_min: 0,
  runner_frac: 0,
  runner_giveback_pct: 0,
};
const identityWithEra = observedPolicyIdentity({
  channel,
  accountId: LAB_ACCOUNT_ID,
  workerVersion: "fixture",
  releaseEvidenceContext: context,
});
const identityWithoutEra = observedPolicyIdentity({
  channel,
  accountId: LAB_ACCOUNT_ID,
  workerVersion: "fixture",
});
check("release attribution is part of the successor policy epoch only", [
  identityWithEra?.policyJson.releaseEvidence,
  identityWithoutEra?.policyJson.releaseEvidence ?? null,
  identityWithEra?.policyEpochId === identityWithoutEra?.policyEpochId,
], [releaseEvidenceStamp(context), null, false]);

console.log(`lab canary policy selftest: ${checks} checks passed`);
