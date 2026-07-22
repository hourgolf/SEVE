// Pure bridge from durable family-observer opportunity ids to exact, manager-
// normalized dark-candidate outcomes. It owns no client, filesystem, provider,
// persistence, policy, order, or production dependency.

import {
  BASE_MANAGER_IDS,
  MANAGER_POLICY_VERSION,
  managerIdsForChannel,
  type ManagerId,
} from "../../engine/managerPolicy.js";
import type { FrozenDarkCandidateDecision } from "./darkCandidateFreeze.js";
import type { FamilyAdmissionReceipt } from "./observerScorecard.js";
import type { VbCandidateScorecard, VbManagerArmResult } from "./vbCandidateEvidence.js";

export const FAMILY_EXACT_REPLAY_BRIDGE_VERSION = "family-exact-replay-bridge-v1" as const;

export type FamilyExactReplayCensorCode =
  | "invalid_observation_clock"
  | "candidate_set_incomplete"
  | "duplicate_frozen_opportunity"
  | "paper_root_provenance_missing"
  | "candidate_identity_mismatch"
  | "invalid_requested_quantity"
  | "duplicate_exact_scorecard"
  | "missing_exact_scorecard"
  | "exact_scorecard_ineligible"
  | "manager_not_common_to_family"
  | "missing_manager_arm"
  | "manager_policy_mismatch"
  | "invalid_manager_exit"
  | "admission_arm_mismatch"
  | "sequential_reentry_active";

export interface FamilyExactReplayCensor {
  observationId: string;
  managerId: ManagerId | null;
  opportunityId: string | null;
  code: FamilyExactReplayCensorCode;
  fact: string;
}

export interface FamilyManagerCandidateOutcome {
  opportunityId: string;
  channelSlug: string;
  requestedQty: number;
  exactEntryAsk: number;
  exitAtMs: number;
  exitBid: number;
  exitReason: string;
  returnPct: number;
  pnlPerContract: number;
  modeledPnl: number;
  candidateManagerVersion: string | null;
  candidateConfigurationIdentity: string;
  managerPolicyVersion: typeof MANAGER_POLICY_VERSION;
  basis: "databento_entry_ask_to_executable_bid";
}

export interface FamilyManagerReplayGroup {
  observationId: string;
  familyId: string;
  sourceBarAt: string;
  sessionDateEt: string;
  managerId: ManagerId;
  managerPolicyVersion: typeof MANAGER_POLICY_VERSION;
  candidateOutcomes: FamilyManagerCandidateOutcome[];
  nativeClusterPnl: number;
  arms: Array<{
    keepOpportunityId: string;
    keepChannelSlug: string;
    rejectOpportunityIds: string[];
    survivorPnl: number;
  }>;
  eligible: boolean;
  censorCodes: FamilyExactReplayCensorCode[];
  interpretation: "all_siblings_counterfactual_cluster_vs_one_survivor";
}

export interface FamilyManagerReplayStratum {
  managerId: ManagerId;
  managerPolicyVersion: typeof MANAGER_POLICY_VERSION;
  groups: FamilyManagerReplayGroup[];
}

export interface FamilyExactReplayBridgeResult {
  version: typeof FAMILY_EXACT_REPLAY_BRIDGE_VERSION;
  strata: FamilyManagerReplayStratum[];
  censors: FamilyExactReplayCensor[];
  source: {
    familyObservations: number;
    frozenCandidates: number;
    exactScorecards: number;
    eligibleManagerGroups: number;
  };
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
  orderPathAuthorized: false;
}

interface CandidateBinding {
  opportunityId: string;
  channelSlug: string;
  requestedQty: number;
  candidate: FrozenDarkCandidateDecision | null;
  candidateConfigurationIdentity: string;
  scorecard: VbCandidateScorecard;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number): number => Math.round(value * 100) / 100;
const managerOrder = new Map<ManagerId, number>(BASE_MANAGER_IDS.map((id, index) => [id, index]));

function addCensor(
  rows: FamilyExactReplayCensor[],
  observationId: string,
  code: FamilyExactReplayCensorCode,
  fact: string,
  managerId: ManagerId | null = null,
  opportunityId: string | null = null,
): void {
  rows.push({ observationId, managerId, opportunityId, code, fact });
}

function uniqueMap<T>(rows: readonly T[], key: (row: T) => string): {
  values: Map<string, T>;
  duplicates: Set<string>;
} {
  const values = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const id = key(row);
    if (values.has(id)) duplicates.add(id);
    else values.set(id, row);
  }
  return { values, duplicates };
}

function sameAdmissionArm(
  opportunityIds: readonly string[],
  keepOpportunityId: string,
  rejectOpportunityIds: readonly string[],
): boolean {
  const expected = opportunityIds.filter((id) => id !== keepOpportunityId).sort();
  const actual = [...new Set(rejectOpportunityIds)].sort();
  return opportunityIds.includes(keepOpportunityId)
    && expected.length === actual.length
    && expected.every((id, index) => id === actual[index]);
}

function commonManagers(bindings: readonly CandidateBinding[]): ManagerId[] {
  if (!bindings.length) return [];
  const sets = bindings.map((binding) => new Set(managerIdsForChannel(binding.channelSlug)));
  return [...sets[0]].filter((managerId) => sets.every((set) => set.has(managerId)))
    .sort((a, b) => (managerOrder.get(a) ?? 999) - (managerOrder.get(b) ?? 999) || a.localeCompare(b));
}

function armFor(scorecard: VbCandidateScorecard, managerId: ManagerId): VbManagerArmResult | null {
  const rows = scorecard.exactArms.filter((arm) => arm.managerId === managerId);
  return rows.length === 1 ? rows[0] : null;
}

export function bridgeFamilyExactReplays(input: {
  familyObservations: readonly FamilyAdmissionReceipt[];
  frozenCandidates: readonly FrozenDarkCandidateDecision[];
  exactScorecards: readonly VbCandidateScorecard[];
}): FamilyExactReplayBridgeResult {
  const censors: FamilyExactReplayCensor[] = [];
  const candidates = uniqueMap(input.frozenCandidates, (row) => row.executionOpportunityId);
  const scorecards = uniqueMap(input.exactScorecards, (row) => row.opportunityId);
  const groupsByManager = new Map<ManagerId, FamilyManagerReplayGroup[]>();
  const activeUntil = new Map<string, number>();
  const observations = [...input.familyObservations].sort((a, b) => {
    const clock = Date.parse(a.sourceBarAt) - Date.parse(b.sourceBarAt);
    return Number.isFinite(clock) && clock !== 0 ? clock : a.id.localeCompare(b.id);
  });

  for (const observation of observations) {
    const sourceAtMs = Date.parse(observation.sourceBarAt);
    const sessionDateEt = finite(sourceAtMs) ? ET_DATE.format(new Date(sourceAtMs)) : "invalid-date";
    if (!finite(sourceAtMs)) {
      addCensor(censors, observation.id, "invalid_observation_clock", observation.sourceBarAt);
      continue;
    }
    const bindings: CandidateBinding[] = [];
    let baseInvalid = false;
    for (const receipt of observation.candidates) {
      if (!Number.isInteger(receipt.requestedQty) || receipt.requestedQty < 1) {
        addCensor(censors, observation.id, "invalid_requested_quantity", String(receipt.requestedQty), null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      if (candidates.duplicates.has(receipt.opportunityId)) {
        addCensor(censors, observation.id, "duplicate_frozen_opportunity", receipt.opportunityId, null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      const candidate = candidates.values.get(receipt.opportunityId) ?? null;
      const paperRoot = receipt.posture === "day1-paper-root"
        && typeof receipt.releaseId === "string" && receipt.releaseId.length > 0
        && typeof receipt.configurationSha256 === "string" && /^[0-9a-f]{64}$/i.test(receipt.configurationSha256)
        && typeof receipt.occSymbol === "string" && receipt.occSymbol.length > 0;
      if (!candidate && !paperRoot) {
        addCensor(censors, observation.id,
          receipt.posture === "day1-paper-root" ? "paper_root_provenance_missing" : "candidate_set_incomplete",
          receipt.posture === "day1-paper-root" ? "release/configuration/OCC identity incomplete" : "frozen dark candidate missing",
          null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      if (candidate && (receipt.posture === "day1-paper-root"
          || candidate.channelSlug !== receipt.channelSlug
          || Date.parse(candidate.sourceBarAt) !== sourceAtMs
          || candidate.sessionDateEt !== sessionDateEt
          || candidate.independentOpportunityClaimed
          || !candidate.managerSpecificReplayRequired
          || (receipt.occSymbol != null && receipt.occSymbol !== candidate.occSymbol))) {
        addCensor(censors, observation.id, "candidate_identity_mismatch", `${candidate.channelSlug}@${candidate.sourceBarAt}`, null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      if (scorecards.duplicates.has(receipt.opportunityId)) {
        addCensor(censors, observation.id, "duplicate_exact_scorecard", receipt.opportunityId, null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      const scorecard = scorecards.values.get(receipt.opportunityId);
      if (!scorecard) {
        addCensor(censors, observation.id, "missing_exact_scorecard", receipt.opportunityId, null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      if ((candidate && scorecard.candidateId !== candidate.candidateId)
          || !scorecard.candidateId
          || scorecard.opportunityId !== receipt.opportunityId
          || scorecard.channelSlug !== receipt.channelSlug
          || !scorecard.eligible
          || scorecard.censors.length > 0
          || !finite(scorecard.exactEntryAsk)
          || (scorecard.exactEntryAsk ?? 0) <= 0) {
        addCensor(censors, observation.id, "exact_scorecard_ineligible", scorecard.censors.join(",") || "identity or exact-entry failure", null, receipt.opportunityId);
        baseInvalid = true;
        continue;
      }
      bindings.push({
        ...receipt,
        candidate,
        candidateConfigurationIdentity: candidate?.configurationEpochId ?? receipt.configurationSha256 as string,
        scorecard,
      });
    }
    if (baseInvalid || bindings.length !== observation.candidates.length || bindings.length < 2) continue;

    const common = commonManagers(bindings);
    const union = new Set(bindings.flatMap((binding) => managerIdsForChannel(binding.channelSlug)));
    for (const managerId of union) if (!common.includes(managerId)) {
      addCensor(censors, observation.id, "manager_not_common_to_family", "manager is not configured for every candidate", managerId);
    }

    for (const managerId of common) {
      const codes = new Set<FamilyExactReplayCensorCode>();
      const outcomes: FamilyManagerCandidateOutcome[] = [];
      for (const binding of bindings) {
        const arm = armFor(binding.scorecard, managerId);
        if (!arm) {
          codes.add("missing_manager_arm");
          addCensor(censors, observation.id, "missing_manager_arm", binding.channelSlug, managerId, binding.opportunityId);
          continue;
        }
        if (arm.managerVersion !== MANAGER_POLICY_VERSION) {
          codes.add("manager_policy_mismatch");
          addCensor(censors, observation.id, "manager_policy_mismatch", arm.managerVersion, managerId, binding.opportunityId);
          continue;
        }
        if (!finite(arm.exitAtMs) || arm.exitAtMs < sourceAtMs || !finite(arm.exitBid)
            || arm.exitBid <= 0 || !finite(arm.pnlPerContract)) {
          codes.add("invalid_manager_exit");
          addCensor(censors, observation.id, "invalid_manager_exit", `${arm.exitAtMs}/${arm.exitBid}`, managerId, binding.opportunityId);
          continue;
        }
        const lane = `${observation.familyId}|${managerId}|${binding.channelSlug}`;
        const priorExit = activeUntil.get(lane);
        if (priorExit != null && sourceAtMs < priorExit) {
          codes.add("sequential_reentry_active");
          addCensor(censors, observation.id, "sequential_reentry_active", `prior exit ${new Date(priorExit).toISOString()}`, managerId, binding.opportunityId);
        }
        outcomes.push({
          opportunityId: binding.opportunityId,
          channelSlug: binding.channelSlug,
          requestedQty: binding.requestedQty,
          exactEntryAsk: binding.scorecard.exactEntryAsk as number,
          exitAtMs: arm.exitAtMs,
          exitBid: arm.exitBid,
          exitReason: arm.exitReason,
          returnPct: arm.returnPct,
          pnlPerContract: arm.pnlPerContract,
          modeledPnl: money(arm.pnlPerContract * binding.requestedQty),
          candidateManagerVersion: binding.candidate?.managerVersion ?? null,
          candidateConfigurationIdentity: binding.candidateConfigurationIdentity,
          managerPolicyVersion: MANAGER_POLICY_VERSION,
          basis: arm.basis,
        });
      }
      const opportunityIds = bindings.map((binding) => binding.opportunityId);
      const outcomeByOpportunity = new Map(outcomes.map((outcome) => [outcome.opportunityId, outcome]));
      const arms = observation.admissionArms.flatMap((arm) => {
        if (!sameAdmissionArm(opportunityIds, arm.keepOpportunityId, arm.rejectOpportunityIds)) {
          codes.add("admission_arm_mismatch");
          addCensor(censors, observation.id, "admission_arm_mismatch", arm.keepOpportunityId, managerId, arm.keepOpportunityId);
          return [];
        }
        const kept = outcomeByOpportunity.get(arm.keepOpportunityId);
        return kept ? [{
          keepOpportunityId: arm.keepOpportunityId,
          keepChannelSlug: kept.channelSlug,
          rejectOpportunityIds: [...arm.rejectOpportunityIds].sort(),
          survivorPnl: kept.modeledPnl,
        }] : [];
      });
      if (arms.length !== bindings.length) codes.add("admission_arm_mismatch");
      const eligible = codes.size === 0 && outcomes.length === bindings.length;
      if (eligible) for (const outcome of outcomes) {
        activeUntil.set(`${observation.familyId}|${managerId}|${outcome.channelSlug}`, outcome.exitAtMs);
      }
      const group: FamilyManagerReplayGroup = {
        observationId: observation.id,
        familyId: observation.familyId,
        sourceBarAt: observation.sourceBarAt,
        sessionDateEt,
        managerId,
        managerPolicyVersion: MANAGER_POLICY_VERSION,
        candidateOutcomes: outcomes,
        nativeClusterPnl: money(outcomes.reduce((sum, outcome) => sum + outcome.modeledPnl, 0)),
        arms,
        eligible,
        censorCodes: [...codes].sort(),
        interpretation: "all_siblings_counterfactual_cluster_vs_one_survivor",
      };
      groupsByManager.set(managerId, [...(groupsByManager.get(managerId) ?? []), group]);
    }
  }

  const strata: FamilyManagerReplayStratum[] = [...groupsByManager.entries()]
    .sort(([a], [b]) => (managerOrder.get(a) ?? 999) - (managerOrder.get(b) ?? 999) || a.localeCompare(b))
    .map(([managerId, groups]) => ({ managerId, managerPolicyVersion: MANAGER_POLICY_VERSION, groups }));
  return {
    version: FAMILY_EXACT_REPLAY_BRIDGE_VERSION,
    strata,
    censors: censors.sort((a, b) => a.observationId.localeCompare(b.observationId)
      || String(a.managerId).localeCompare(String(b.managerId))
      || String(a.opportunityId).localeCompare(String(b.opportunityId))
      || a.code.localeCompare(b.code)),
    source: {
      familyObservations: input.familyObservations.length,
      frozenCandidates: input.frozenCandidates.length,
      exactScorecards: input.exactScorecards.length,
      eligibleManagerGroups: strata.reduce((sum, stratum) => sum + stratum.groups.filter((group) => group.eligible).length, 0),
    },
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
    orderPathAuthorized: false,
  };
}
