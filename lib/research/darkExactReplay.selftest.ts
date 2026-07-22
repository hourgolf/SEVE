import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { MANAGER_POLICY_VERSION, managerIdsForChannel, type ManagerId } from "../../engine/managerPolicy.js";
import type { DarkCandidateFreeze, FrozenDarkCandidateDecision } from "./darkCandidateFreeze.js";
import { deriveDarkExactReplay, exactReceiptForFrozenCandidate } from "./darkExactReplay.js";
import type { VbCandidateScorecard } from "./vbCandidateEvidence.js";

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  assert.deepEqual(actual, expected, label);
}
const stamp = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const baseAt = Date.parse("2026-07-22T14:30:00.000Z");

function candidate(index: number, atMs = baseAt + index * 60_000): FrozenDarkCandidateDecision {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    schemaVersion: 1,
    candidateId: `vbcan:${id}`,
    signalId: id,
    executionObservationId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    executionOpportunityId: `opp:${id}`,
    sessionDateEt: "2026-07-22",
    strategistId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    accountId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    channelSlug: "vb-ribbon-cross",
    channelVersion: stamp("channel"),
    configurationEpochId: stamp("configuration"),
    managerVersion: stamp("candidate-manager"),
    sourceVersion: "stream-test",
    sourceBarAt: new Date(atMs).toISOString(),
    decisionObservedAt: new Date(atMs + 1_000).toISOString(),
    executionObservedAt: new Date(atMs + 1_100).toISOString(),
    underlying: "SPY",
    optionSide: "call",
    occSymbol: "SPY260722C00750000",
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

function freeze(rows: FrozenDarkCandidateDecision[]): DarkCandidateFreeze {
  return {
    schemaVersion: 1,
    freezerVersion: "dark-candidate-freezer-v1",
    sessionDateEt: "2026-07-22",
    source: "supabase_select_only_signals_plus_execution_observations",
    sourceCounts: { signals: rows.length, executionObservations: rows.length },
    methodology: {
      independence: "raw_decisions_retained_no_independent_trade_claim",
      replay: "manager_specific_sequential_replay_after_exact_path",
      liveAskBasis: "alpaca_snapshot_non_exact_provenance_only",
      exactPathBasis: "databento_cbbo_1s_required",
      signalExecutionClockMaxSkewMs: 5_000,
      externalWrites: false,
      orderPathAuthorized: false,
    },
    candidates: rows,
    censors: [],
    contractRequests: [],
    summary: {
      validRawDecisions: rows.length, censoredSignals: 0, exactContracts: 1,
      estimatedMaximumOneSecondRows: 1, liveAskUnavailableDecisions: 0,
      byBlockedReason: { day1_dark_lifecycle: rows.length }, byChannel: { "vb-ribbon-cross": rows.length }, byCensor: {},
    },
    canonicalSha256: "f".repeat(64),
  };
}

function scorecard(row: FrozenDarkCandidateDecision, exitAtMs: number): VbCandidateScorecard {
  return {
    candidateId: row.candidateId,
    opportunityId: row.executionOpportunityId,
    channelSlug: row.channelSlug,
    exactEntryAsk: 1,
    exactEntryQuoteAtMs: Date.parse(row.decisionObservedAt),
    liveObservedAsk: null,
    exactBasis: "databento_cbbo_1s",
    exactArms: managerIdsForChannel(row.channelSlug).map((managerId: ManagerId) => ({
      managerId, managerVersion: MANAGER_POLICY_VERSION, exitAtMs, exitBid: 1.1,
      exitReason: "test", returnPct: 10, pnlPerContract: 10,
      basis: "databento_entry_ask_to_executable_bid",
    })),
    nativeSynthetic: null, censors: [], eligible: true,
    policyChangeAuthorized: false, orderPathAuthorized: false,
  };
}

const first = candidate(1);
const overlap = candidate(2);
const later = candidate(3, baseAt + 6 * 60_000);
const replay = deriveDarkExactReplay({
  freeze: freeze([first, overlap, later]),
  scorecards: [scorecard(first, baseAt + 5 * 60_000), scorecard(overlap, baseAt + 4 * 60_000), scorecard(later, baseAt + 8 * 60_000)],
});
const managers = managerIdsForChannel(first.channelSlug).length;
check("all raw clocks get exact scorecards", replay.source.exactEligibleCandidateClocks, 3);
check("overlap is censored separately for every manager lane", replay.source.overlappingManagerClocksCensored, managers);
check("first and post-exit clocks become independent per manager", replay.source.independentManagerPaths, managers * 2);
check("independent paths never include the overlapping candidate", replay.paths.some((row) => row.candidateId === overlap.candidateId), false);
check("overlap censor is explicit", replay.censors.filter((row) => row.code === "sequential_reentry_active").length, managers);
check("result cannot authorize writes orders or policy", [replay.externalWrites, replay.orderPathAuthorized, replay.policyChangeAuthorized], [false, false, false]);

const missing = deriveDarkExactReplay({ freeze: freeze([first]), scorecards: [] });
check("missing exact scorecard fails closed", [missing.source.exactCensoredCandidateClocks, missing.paths.length], [1, 0]);
check("missing scorecard reason is explicit", missing.censors.map((row) => row.code), ["missing_scorecard"]);

const duplicate = deriveDarkExactReplay({ freeze: freeze([first]), scorecards: [scorecard(first, baseAt + 60_000), scorecard(first, baseAt + 60_000)] });
check("duplicate scorecards fail closed", [duplicate.source.exactCensoredCandidateClocks, duplicate.paths.length], [1, 0]);
check("duplicate reason is explicit", duplicate.censors.some((row) => row.code === "duplicate_scorecard"), true);

const receipt = exactReceiptForFrozenCandidate(first, baseAt + 30 * 60_000);
check("exact adapter preserves frozen identities", [receipt.candidateId, receipt.opportunityId, receipt.orderPathAuthorized], [first.candidateId, first.executionOpportunityId, false]);
check("exact adapter does not upgrade the live snapshot basis", [receipt.liveObservedAsk?.feed, receipt.liveObservedAsk?.exactExecutable], ["alpaca_snapshot", false]);

console.log(`dark-exact-replay-selftest: ${checks}/${checks} PASS`);
