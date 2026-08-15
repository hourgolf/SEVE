// Pure manager-specific replay for frozen dark/VB decision clocks. Exact
// candidate scorecards are evaluated independently first, then each manager's
// channel lane is sequenced against its own exact exit clock. This prevents
// raw per-minute decisions from masquerading as independent trades.

import { MANAGER_POLICY_VERSION, managerIdsForChannel, type ManagerId } from "../../engine/managerPolicy.js";
import type { DarkCandidateFreeze, FrozenDarkCandidateDecision } from "./darkCandidateFreeze.js";
import type { VbCandidateReceipt, VbCandidateScorecard, VbManagerArmResult } from "./vbCandidateEvidence.js";

export const DARK_EXACT_REPLAY_VERSION = "dark-exact-replay-v3" as const;

export type DarkExactReplayCensorCode =
  | "duplicate_candidate"
  | "unexpected_scorecard"
  | "duplicate_scorecard"
  | "missing_scorecard"
  | "candidate_identity_mismatch"
  | "scorecard_ineligible"
  | "manager_arm_incomplete"
  | "manager_arm_censored"
  | "manager_policy_mismatch"
  | "invalid_manager_exit"
  | "sequential_reentry_active";

export interface DarkExactReplayCensor {
  candidateId: string;
  channelSlug: string | null;
  managerId: ManagerId | null;
  code: DarkExactReplayCensorCode;
  fact: string;
}

export interface DarkManagerPath {
  candidateId: string;
  opportunityId: string;
  sessionDateEt: string;
  channelSlug: string;
  channelVersion: string;
  configurationEpochId: string;
  candidateManagerVersion: string;
  managerId: ManagerId;
  managerPolicyVersion: typeof MANAGER_POLICY_VERSION;
  sourceBarAt: string;
  decisionObservedAt: string;
  entryAsk: number;
  exitAt: string;
  exitBid: number;
  exitReason: string;
  returnPct: number;
  pnlPerContract: number;
  basis: "databento_entry_ask_to_executable_bid";
  independentOpportunity: true;
}

export interface DarkExactReplayResult {
  version: typeof DARK_EXACT_REPLAY_VERSION;
  sessionDateEt: string;
  source: {
    rawDecisionClocks: number;
    exactScorecards: number;
    exactEligibleCandidateClocks: number;
    exactCensoredCandidateClocks: number;
    managerArmsEvaluated: number;
    independentManagerPaths: number;
    overlappingManagerClocksCensored: number;
  };
  paths: DarkManagerPath[];
  censors: DarkExactReplayCensor[];
  interpretation: "raw_clocks_exactly_scored_then_sequenced_per_channel_manager";
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function addCensor(
  rows: DarkExactReplayCensor[],
  candidate: Pick<FrozenDarkCandidateDecision, "candidateId" | "channelSlug"> | null,
  code: DarkExactReplayCensorCode,
  fact: string,
  managerId: ManagerId | null = null,
  candidateId = candidate?.candidateId ?? "unknown",
): void {
  rows.push({ candidateId, channelSlug: candidate?.channelSlug ?? null, managerId, code, fact });
}

function armFor(scorecard: VbCandidateScorecard, managerId: ManagerId): VbManagerArmResult | null {
  const rows = scorecard.exactArms.filter((arm) => arm.managerId === managerId);
  return rows.length === 1 ? rows[0] : null;
}

function lane(candidate: FrozenDarkCandidateDecision, managerId: ManagerId): string {
  return [
    candidate.sessionDateEt,
    candidate.channelVersion,
    candidate.configurationEpochId,
    candidate.channelSlug,
    managerId,
  ].join("\u0000");
}

export function exactReceiptForFrozenCandidate(
  candidate: FrozenDarkCandidateDecision,
  virtualExitAtMs: number,
): VbCandidateReceipt {
  if (!finite(virtualExitAtMs) || virtualExitAtMs < Date.parse(candidate.decisionObservedAt)) {
    throw new Error(`invalid exact replay exit for ${candidate.candidateId}`);
  }
  return {
    signalId: candidate.signalId,
    strategistId: candidate.strategistId,
    accountId: candidate.accountId,
    channelSlug: candidate.channelSlug,
    channelVersion: candidate.channelVersion,
    configurationEpochId: candidate.configurationEpochId,
    sourceVersion: candidate.sourceVersion,
    sourceBarAtMs: Date.parse(candidate.sourceBarAt),
    decisionObservedAtMs: Date.parse(candidate.decisionObservedAt),
    underlying: candidate.underlying,
    side: candidate.optionSide,
    occSymbol: candidate.occSymbol,
    liveObservedAsk: {
      price: candidate.liveObservedAsk,
      feed: "alpaca_snapshot",
      providerAtMs: null,
      observedAtMs: Date.parse(candidate.executionObservedAt),
      freshnessMs: candidate.liveAskFreshnessMs,
      exactExecutable: false,
    },
    blockedReason: candidate.blockedReason,
    virtualExitAtMs,
    schemaVersion: 1,
    candidateId: candidate.candidateId,
    opportunityId: candidate.executionOpportunityId,
    reentryOrdinal: 1,
    sessionDateEt: candidate.sessionDateEt,
    exactPathRequired: true,
    orderPathAuthorized: false,
  };
}

export function deriveDarkExactReplay(input: {
  freeze: DarkCandidateFreeze;
  scorecards: readonly VbCandidateScorecard[];
}): DarkExactReplayResult {
  const censors: DarkExactReplayCensor[] = [];
  const candidateGroups = new Map<string, FrozenDarkCandidateDecision[]>();
  for (const candidate of input.freeze.candidates) {
    candidateGroups.set(candidate.candidateId, [...(candidateGroups.get(candidate.candidateId) ?? []), candidate]);
  }
  const scorecardGroups = new Map<string, VbCandidateScorecard[]>();
  for (const scorecard of input.scorecards) {
    scorecardGroups.set(scorecard.candidateId, [...(scorecardGroups.get(scorecard.candidateId) ?? []), scorecard]);
    if (!candidateGroups.has(scorecard.candidateId)) {
      addCensor(censors, null, "unexpected_scorecard", scorecard.opportunityId, null, scorecard.candidateId);
    }
  }

  const activeUntil = new Map<string, number>();
  const paths: DarkManagerPath[] = [];
  let exactEligibleCandidateClocks = 0;
  let exactCensoredCandidateClocks = 0;
  let managerArmsEvaluated = 0;
  let overlappingManagerClocksCensored = 0;
  const candidates = [...input.freeze.candidates].sort((a, b) => Date.parse(a.decisionObservedAt) - Date.parse(b.decisionObservedAt)
    || a.candidateId.localeCompare(b.candidateId));

  for (const candidate of candidates) {
    const duplicateCandidates = candidateGroups.get(candidate.candidateId) ?? [];
    if (duplicateCandidates.length !== 1) {
      exactCensoredCandidateClocks++;
      addCensor(censors, candidate, "duplicate_candidate", `${duplicateCandidates.length} frozen rows`);
      continue;
    }
    const rows = scorecardGroups.get(candidate.candidateId) ?? [];
    if (rows.length === 0) {
      exactCensoredCandidateClocks++;
      addCensor(censors, candidate, "missing_scorecard", candidate.executionOpportunityId);
      continue;
    }
    if (rows.length !== 1) {
      exactCensoredCandidateClocks++;
      addCensor(censors, candidate, "duplicate_scorecard", `${rows.length} scorecards`);
      continue;
    }
    const scorecard = rows[0];
    const expectedManagers = managerIdsForChannel(candidate.channelSlug);
    if (scorecard.opportunityId !== candidate.executionOpportunityId
        || scorecard.channelSlug !== candidate.channelSlug
        || scorecard.exactEntryAsk == null
        || !finite(scorecard.exactEntryAsk)
        || scorecard.exactEntryAsk <= 0) {
      exactCensoredCandidateClocks++;
      addCensor(censors, candidate, "candidate_identity_mismatch", `${scorecard.channelSlug}/${scorecard.opportunityId}`);
      continue;
    }
    if (scorecard.censors.length > 0) {
      exactCensoredCandidateClocks++;
      addCensor(censors, candidate, "scorecard_ineligible", scorecard.censors.join(",") || "ineligible");
      continue;
    }
    const arms = expectedManagers.map((managerId) => [managerId, armFor(scorecard, managerId)] as const);
    const missingArms = arms.filter(([, arm]) => arm == null);
    if (missingArms.length) {
      exactCensoredCandidateClocks++;
      for (const [managerId] of missingArms) {
        const armCensor = (scorecard.armCensors ?? []).find((row) => row.managerId === managerId);
        addCensor(
          censors,
          candidate,
          armCensor ? "manager_arm_censored" : "manager_arm_incomplete",
          armCensor ? `${armCensor.code}:${armCensor.fact}` : `${scorecard.exactArms.length}/${expectedManagers.length}`,
          managerId,
        );
      }
    } else {
      exactEligibleCandidateClocks++;
    }
    for (const [managerId, maybeArm] of arms) {
      if (!maybeArm) continue;
      const arm = maybeArm as VbManagerArmResult;
      managerArmsEvaluated++;
      if (arm.managerVersion !== MANAGER_POLICY_VERSION) {
        addCensor(censors, candidate, "manager_policy_mismatch", arm.managerVersion, managerId);
        continue;
      }
      const decisionAtMs = Date.parse(candidate.decisionObservedAt);
      if (!finite(arm.exitAtMs) || !finite(arm.exitBid) || arm.exitBid <= 0
          || !finite(arm.returnPct) || !finite(arm.pnlPerContract)) {
        addCensor(censors, candidate, "invalid_manager_exit", `${arm.exitAtMs}/${arm.exitBid}`, managerId);
        continue;
      }
      const key = lane(candidate, managerId);
      const priorExitAtMs = activeUntil.get(key);
      if (priorExitAtMs != null && decisionAtMs < priorExitAtMs) {
        overlappingManagerClocksCensored++;
        addCensor(censors, candidate, "sequential_reentry_active", new Date(priorExitAtMs).toISOString(), managerId);
        continue;
      }
      // CBBO-1s is event-sparse. The quote stamped immediately before a
      // sub-second decision remains the carried-forward executable state at
      // that decision boundary. Persist the decision clock as the earliest
      // possible exit while retaining the provider quote timestamp inside the
      // immutable exact-path object.
      const exitAtMs = Math.max(arm.exitAtMs, decisionAtMs);
      activeUntil.set(key, exitAtMs);
      paths.push({
        candidateId: candidate.candidateId,
        opportunityId: candidate.executionOpportunityId,
        sessionDateEt: candidate.sessionDateEt,
        channelSlug: candidate.channelSlug,
        channelVersion: candidate.channelVersion,
        configurationEpochId: candidate.configurationEpochId,
        candidateManagerVersion: candidate.managerVersion,
        managerId,
        managerPolicyVersion: MANAGER_POLICY_VERSION,
        sourceBarAt: candidate.sourceBarAt,
        decisionObservedAt: candidate.decisionObservedAt,
        entryAsk: scorecard.exactEntryAsk,
        exitAt: new Date(exitAtMs).toISOString(),
        exitBid: arm.exitBid,
        exitReason: arm.exitReason,
        returnPct: arm.returnPct,
        pnlPerContract: arm.pnlPerContract,
        basis: arm.basis,
        independentOpportunity: true,
      });
    }
  }

  return {
    version: DARK_EXACT_REPLAY_VERSION,
    sessionDateEt: input.freeze.sessionDateEt,
    source: {
      rawDecisionClocks: input.freeze.candidates.length,
      exactScorecards: input.scorecards.length,
      exactEligibleCandidateClocks,
      exactCensoredCandidateClocks,
      managerArmsEvaluated,
      independentManagerPaths: paths.length,
      overlappingManagerClocksCensored,
    },
    paths,
    censors: censors.sort((a, b) => a.candidateId.localeCompare(b.candidateId)
      || String(a.managerId).localeCompare(String(b.managerId)) || a.code.localeCompare(b.code)),
    interpretation: "raw_clocks_exactly_scored_then_sequenced_per_channel_manager",
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
}
