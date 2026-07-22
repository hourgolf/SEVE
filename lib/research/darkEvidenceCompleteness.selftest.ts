import { strict as assert } from "node:assert";
import type { DarkCandidateFreeze, FrozenDarkCandidateDecision } from "./darkCandidateFreeze.js";
import { deriveDarkEvidenceCompleteness } from "./darkEvidenceCompleteness.js";
import type { VbCandidateScorecard, VbManagerArmResult } from "./vbCandidateEvidence.js";

const candidate = (id: string, channelSlug = "vb-ribbon-cross"): FrozenDarkCandidateDecision => ({
  schemaVersion: 1, candidateId: id, signalId: `${id}-signal`, executionObservationId: `${id}-execution`,
  executionOpportunityId: `${id}-opportunity`, sessionDateEt: "2026-07-21", strategistId: "s", accountId: "a",
  channelSlug, channelVersion: "sha256:a", configurationEpochId: "sha256:b", managerVersion: "sha256:c",
  sourceVersion: "stream-test", sourceBarAt: "2026-07-21T14:00:00.000Z", decisionObservedAt: "2026-07-21T14:00:01.000Z",
  executionObservedAt: "2026-07-21T14:00:01.100Z", underlying: "SPY", optionSide: "call", occSymbol: "SPY260721C00750000",
  blockedReason: "day1_dark_lifecycle", liveObservedAsk: 1, liveAskFeed: "alpaca_snapshot", liveAskFreshnessMs: 100,
  liveAskExact: false, independentOpportunityClaimed: false, managerSpecificReplayRequired: true, orderPathAuthorized: false,
});

const freeze = (candidates: FrozenDarkCandidateDecision[], censors = 0): DarkCandidateFreeze => ({
  schemaVersion: 1, freezerVersion: "dark-candidate-freezer-v1", sessionDateEt: "2026-07-21",
  source: "supabase_select_only_signals_plus_execution_observations",
  sourceCounts: { signals: candidates.length + censors, executionObservations: candidates.length },
  methodology: { independence: "raw_decisions_retained_no_independent_trade_claim", replay: "manager_specific_sequential_replay_after_exact_path", liveAskBasis: "alpaca_snapshot_non_exact_provenance_only", exactPathBasis: "databento_cbbo_1s_required", signalExecutionClockMaxSkewMs: 5000, externalWrites: false, orderPathAuthorized: false },
  candidates,
  censors: Array.from({ length: censors }, (_, i) => ({ signalId: `bad-${i}`, code: "missing_execution_observation", fact: "missing" })),
  contractRequests: candidates.length ? [{ requestId: "r", sessionDateEt: "2026-07-21", dataset: "OPRA.PILLAR", schema: "cbbo-1s", occSymbol: "SPY260721C00750000", rawSymbol: "SPY   260721C00750000", startIso: "2026-07-21T14:00:00.000Z", endIso: "2026-07-21T19:55:00.000Z", candidateIds: candidates.map((row) => row.candidateId), rawDecisionCount: candidates.length, estimatedMaximumOneSecondRows: 1 }]: [],
  summary: { validRawDecisions: candidates.length, censoredSignals: censors, exactContracts: candidates.length ? 1 : 0, estimatedMaximumOneSecondRows: candidates.length ? 1 : 0, liveAskUnavailableDecisions: 0, byBlockedReason: candidates.length ? { day1_dark_lifecycle: candidates.length } : {}, byChannel: Object.fromEntries(candidates.map((row) => [row.channelSlug, 1])), byCensor: censors ? { missing_execution_observation: censors } : {} },
  canonicalSha256: "test",
});

const arm = (managerId: VbManagerArmResult["managerId"]): VbManagerArmResult => ({ managerId, managerVersion: "manager-lab-preregister-v1", exitAtMs: 1, exitBid: 1, exitReason: "eod", returnPct: 0, pnlPerContract: 0, basis: "databento_entry_ask_to_executable_bid" });
const managerIds: VbManagerArmResult["managerId"][] = ["LOCK20/30", "LOCK30/30", "LOCK50/30", "WIDE20/50", "BANK20/RUN50", "ARM20/HALF-GIVEBACK", "BELL/-30", "BELL/no-stop"];
const scorecard = (id: string, eligible = true): VbCandidateScorecard => ({ candidateId: id, opportunityId: `${id}-opp`, channelSlug: "vb-ribbon-cross", exactEntryAsk: eligible ? 1 : null, exactEntryQuoteAtMs: eligible ? 1 : null, liveObservedAsk: null, exactBasis: "databento_cbbo_1s", exactArms: eligible ? managerIds.map(arm) : [], nativeSynthetic: null, censors: eligible ? [] : ["missing_exact_path"], eligible, policyChangeAuthorized: false, orderPathAuthorized: false });

const before = Date.parse("2026-07-22T19:00:00Z");
const gate = Date.parse("2026-07-22T20:00:00Z");
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([]), nowMs: before, exactGateReadyAtMs: gate }).state, "no_candidates");
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), nowMs: before, exactGateReadyAtMs: gate }).state, "exact_pending");
const complete = deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), scorecards: [scorecard("a")], nowMs: gate, exactGateReadyAtMs: gate });
assert.equal(complete.state, "complete");
assert.deepEqual([complete.counts.completedManagerArms, complete.counts.expectedManagerArms], [8, 8]);
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), nowMs: gate, exactGateReadyAtMs: gate }).state, "censored");
assert.match(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), nowMs: gate, exactGateReadyAtMs: gate }).blockers[0], /^exact-missing:/);
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), scorecards: [scorecard("a", false)], nowMs: gate, exactGateReadyAtMs: gate }).state, "censored");
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a"), candidate("b", "vb-gap-drift")]), scorecards: [scorecard("a")], nowMs: before, exactGateReadyAtMs: gate }).state, "partial");
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([], 1), nowMs: before, exactGateReadyAtMs: gate }).tone, "red");
assert.equal(deriveDarkEvidenceCompleteness({ freeze: freeze([candidate("a")]), scorecards: [scorecard("a"), scorecard("a")], nowMs: gate, exactGateReadyAtMs: gate }).state, "censored");
assert.throws(() => deriveDarkEvidenceCompleteness({ freeze: freeze([]), nowMs: Number.NaN, exactGateReadyAtMs: gate }));

console.log("dark-evidence-completeness-selftest: 11/11 passed");
