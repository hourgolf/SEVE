import { strict as assert } from "node:assert";
import { BASE_MANAGER_IDS, MANAGER_POLICY_VERSION, managerIdsForChannel, type ManagerId } from "../../engine/managerPolicy.js";
import type { FrozenDarkCandidateDecision } from "./darkCandidateFreeze.js";
import { bridgeFamilyExactReplays } from "./familyExactReplayBridge.js";
import type { FamilyAdmissionReceipt } from "./observerScorecard.js";
import type { VbCandidateScorecard, VbManagerArmResult } from "./vbCandidateEvidence.js";

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  assert.deepEqual(actual, expected, label);
}

const sha = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;
const source0 = "2026-07-21T14:30:00.000Z";
const source1 = "2026-07-21T14:30:30.000Z";

function candidate(opportunityId: string, channelSlug: string, sourceBarAt = source0): FrozenDarkCandidateDecision {
  return {
    schemaVersion: 1,
    candidateId: `vbcan:${opportunityId}`,
    signalId: `${opportunityId}-signal`,
    executionObservationId: `${opportunityId}-execution`,
    executionOpportunityId: opportunityId,
    sessionDateEt: "2026-07-21",
    strategistId: `${opportunityId}-strategist`,
    accountId: `${opportunityId}-account`,
    channelSlug,
    channelVersion: sha("a"),
    configurationEpochId: sha("b"),
    managerVersion: sha("c"),
    sourceVersion: "stream-test",
    sourceBarAt,
    decisionObservedAt: new Date(Date.parse(sourceBarAt) + 700).toISOString(),
    executionObservedAt: new Date(Date.parse(sourceBarAt) + 800).toISOString(),
    underlying: "SPY",
    optionSide: "call",
    occSymbol: "SPY260721C00750000",
    blockedReason: "day1_dark_lifecycle",
    liveObservedAsk: 1,
    liveAskFeed: "alpaca_snapshot",
    liveAskFreshnessMs: 100,
    liveAskExact: false,
    independentOpportunityClaimed: false,
    managerSpecificReplayRequired: true,
    orderPathAuthorized: false,
  };
}

function managerArm(managerId: ManagerId, exitAtMs: number, pnlPerContract: number): VbManagerArmResult {
  return {
    managerId,
    managerVersion: MANAGER_POLICY_VERSION,
    exitAtMs,
    exitBid: 1 + pnlPerContract / 100,
    exitReason: "test",
    returnPct: pnlPerContract,
    pnlPerContract,
    basis: "databento_entry_ask_to_executable_bid",
  };
}

function scorecard(row: FrozenDarkCandidateDecision, exitDelayMs = 60_000): VbCandidateScorecard {
  return {
    candidateId: row.candidateId,
    opportunityId: row.executionOpportunityId,
    channelSlug: row.channelSlug,
    exactEntryAsk: 1,
    exactEntryQuoteAtMs: Date.parse(row.decisionObservedAt),
    liveObservedAsk: null,
    exactBasis: "databento_cbbo_1s",
    exactArms: managerIdsForChannel(row.channelSlug).map((managerId, index) => managerArm(
      managerId,
      Date.parse(row.sourceBarAt) + exitDelayMs + index,
      row.channelSlug === "pb-ride" ? 10 : row.channelSlug === "pb-ride-2" ? 20 : -5,
    )),
    nativeSynthetic: null,
    censors: [],
    eligible: true,
    policyChangeAuthorized: false,
    orderPathAuthorized: false,
  };
}

function observation(id: string, rows: FrozenDarkCandidateDecision[], sourceBarAt = source0): FamilyAdmissionReceipt {
  const candidates = rows.map((row, index) => ({
    opportunityId: row.executionOpportunityId,
    channelSlug: row.channelSlug,
    requestedQty: 2,
    posture: index === 0 ? "day1-paper-root" as const : "day1-dark-candidate" as const,
    releaseId: "weekend-day1-test",
    configurationSha256: "d".repeat(64),
    occSymbol: row.occSymbol,
  }));
  return {
    id,
    familyId: "PB",
    sourceBarAt,
    candidates,
    admissionArms: candidates.map((row) => ({
      keepOpportunityId: row.opportunityId,
      rejectOpportunityIds: candidates.filter((other) => other.opportunityId !== row.opportunityId).map((other) => other.opportunityId),
    })),
  };
}

const rows0 = [candidate("opp-1", "pb-ride"), candidate("opp-2", "pb-ride-2"), candidate("opp-3", "pb-ride-itm")];
const happy = bridgeFamilyExactReplays({
  familyObservations: [observation("obs-1", rows0)],
  frozenCandidates: rows0.slice(1),
  exactScorecards: rows0.map((row) => scorecard(row)),
});
check("only manager arms common to every family candidate become strata", happy.strata.map((row) => row.managerId), [...BASE_MANAGER_IDS]);
check("PB2-only manager stays visible as a non-common censor", happy.censors.some((row) => row.code === "manager_not_common_to_family" && row.managerId === "PB2-BANK15/HALF-GIVEBACK"), true);
check("all eight common manager groups are eligible", happy.source.eligibleManagerGroups, 8);
check("observer opportunity ids survive the bridge", happy.strata[0].groups[0].candidateOutcomes.map((row) => row.opportunityId), ["opp-1", "opp-2", "opp-3"]);
check("manager pnl is multiplied by observed requested quantity", happy.strata[0].groups[0].candidateOutcomes.map((row) => row.modeledPnl), [20, 40, -10]);
check("cluster and survivor arms remain separately labeled", [
  happy.strata[0].groups[0].nativeClusterPnl,
  happy.strata[0].groups[0].arms.map((row) => [row.keepChannelSlug, row.survivorPnl]),
], [50, [["pb-ride", 20], ["pb-ride-2", 40], ["pb-ride-itm", -10]]]);
check("manager policy and sealed candidate manager identities remain distinct", [
  happy.strata[0].groups[0].candidateOutcomes[0].managerPolicyVersion,
  happy.strata[0].groups[0].candidateOutcomes[0].candidateManagerVersion,
  happy.strata[0].groups[0].candidateOutcomes[0].candidateConfigurationIdentity,
], [MANAGER_POLICY_VERSION, null, "d".repeat(64)]);

const missing = bridgeFamilyExactReplays({
  familyObservations: [observation("obs-missing", rows0)],
  frozenCandidates: [rows0[2]],
  exactScorecards: [scorecard(rows0[0]), scorecard(rows0[2])],
});
check("a missing exact candidate fails the complete family closed", missing.strata.length, 0);
check("missing dark candidate reason is explicit", missing.censors.some((row) => row.code === "candidate_set_incomplete" && row.opportunityId === "opp-2"), true);

const rows1 = [candidate("opp-4", "pb-ride", source1), candidate("opp-5", "pb-ride-2", source1), candidate("opp-6", "pb-ride-itm", source1)];
const overlap = bridgeFamilyExactReplays({
  familyObservations: [observation("obs-1", rows0), observation("obs-2", rows1, source1)],
  frozenCandidates: [...rows0.slice(1), ...rows1.slice(1)],
  exactScorecards: [...rows0, ...rows1].map((row) => scorecard(row, 60_000)),
});
check("later raw clock is censored while prior manager-specific path is active", overlap.strata.every((row) => row.groups[1].eligible === false), true);
check("sequential censor is explicit", overlap.censors.some((row) => row.observationId === "obs-2" && row.code === "sequential_reentry_active"), true);

const duplicate = bridgeFamilyExactReplays({
  familyObservations: [observation("obs-duplicate", rows0)],
  frozenCandidates: [rows0[1], { ...rows0[1] }, rows0[2]],
  exactScorecards: rows0.map((row) => scorecard(row)),
});
check("duplicate opportunity evidence never first-wins", duplicate.strata.length, 0);
check("duplicate evidence is censored", duplicate.censors.some((row) => row.code === "duplicate_frozen_opportunity"), true);

const missingRootIdentity = observation("obs-root-identity", rows0);
missingRootIdentity.candidates[0] = { ...missingRootIdentity.candidates[0], configurationSha256: null };
const rootIdentity = bridgeFamilyExactReplays({
  familyObservations: [missingRootIdentity],
  frozenCandidates: rows0.slice(1),
  exactScorecards: rows0.map((row) => scorecard(row)),
});
check("paper root cannot bypass signed family provenance", rootIdentity.strata.length, 0);
check("paper root provenance failure is explicit", rootIdentity.censors.some((row) => row.code === "paper_root_provenance_missing"), true);
check("bridge cannot authorize policy production or orders", [happy.policyChangeAuthorized, happy.productionChangeAuthorized, happy.orderPathAuthorized], [false, false, false]);

console.log(`family-exact-replay-bridge-selftest: ${checks}/${checks} PASS`);
