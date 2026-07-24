import { readFileSync } from "node:fs";
import {
  DARK_CANDIDATE_PATH_END_MINUTES_BEFORE_CLOSE,
  DARK_CANDIDATE_REQUEST_PADDING_MS,
  DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS,
  freezeDarkCandidates,
  type DarkExecutionEvidenceRow,
  type DarkSignalEvidenceRow,
} from "./darkCandidateFreeze.js";

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const sid = (n: number): string => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const strategistId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const channelVersion = `sha256:${"a".repeat(64)}`;
const epoch = `sha256:${"b".repeat(64)}`;

function signal(id: number, sourceBarAt: string, overrides: Partial<DarkSignalEvidenceRow> = {}): DarkSignalEvidenceRow {
  return {
    id: sid(id), strategistId, createdAt: new Date(Date.parse(sourceBarAt) + 900).toISOString(),
    blockedReason: "day1_dark_lifecycle", direction: "call",
    rationale: {
      occ: "SPY260720C00750000", account_id: accountId,
      decision_source_bar_at: sourceBarAt,
      decision_observed_at: new Date(Date.parse(sourceBarAt) + 800).toISOString(),
      candidate_underlying: "SPY", candidate_side: "call",
      channel_version: channelVersion, configuration_epoch_id: epoch,
      manager_version: `sha256:${"c".repeat(64)}`, worker_version: "stream-test",
    },
    ...overrides,
  };
}

function observation(id: number, sourceBarAt: string, overrides: Partial<DarkExecutionEvidenceRow> = {}): DarkExecutionEvidenceRow {
  return {
    id: sid(id), strategistId, accountId, channelSlug: "vb-test", opportunityId: `opp:${sid(id + 100)}`,
    eventKind: "decision", action: "enter", eventAt: new Date(Date.parse(sourceBarAt) + 700).toISOString(),
    sourceBarAt, blockedReason: "day1_dark_lifecycle", underlying: "SPY",
    occSymbol: "SPY260720C00750000", optionSide: "call", quoteSource: "alpaca_snapshot",
    quoteAgeMs: 120, ask: 1.25,
    ...overrides,
  };
}

const t0 = "2026-07-20T14:00:00.000Z";
const t1 = "2026-07-20T14:01:00.000Z";
const base = freezeDarkCandidates({
  sessionDateEt: "2026-07-20",
  signals: [signal(1, t0), signal(2, t1)],
  executionObservations: [observation(11, t0), observation(12, t1)],
});
check("retains repeated raw decisions without an independence claim", base.candidates.length, 2);
check("every candidate defers manager-specific opportunity replay", base.candidates.map((row) => [row.independentOpportunityClaimed, row.managerSpecificReplayRequired]), [[false, true], [false, true]]);
check("deduplicates only the exact contract request", [base.contractRequests.length, base.contractRequests[0].rawDecisionCount], [1, 2]);
check("request starts two seconds before the regular-session open", base.contractRequests[0].startIso, "2026-07-20T13:29:58.000Z");
check("normal-day request ends five minutes before close plus padding", base.contractRequests[0].endIso, "2026-07-20T19:55:02.000Z");
check("request contract is exact CBBO", [base.contractRequests[0].dataset, base.contractRequests[0].schema, base.contractRequests[0].rawSymbol], ["OPRA.PILLAR", "cbbo-1s", "SPY   260720C00750000"]);
check("live ask stays explicitly non-exact", base.candidates.map((row) => [row.liveAskFeed, row.liveAskExact]), [["alpaca_snapshot", false], ["alpaca_snapshot", false]]);
check("no external or order writes are authorized", [base.methodology.externalWrites, base.methodology.orderPathAuthorized, base.candidates.every((row) => !row.orderPathAuthorized)], [false, false, true]);

const reversed = freezeDarkCandidates({
  sessionDateEt: "2026-07-20",
  signals: [signal(2, t1), signal(1, t0)],
  executionObservations: [observation(12, t1), observation(11, t0)],
});
check("input order does not change canonical identity", reversed.canonicalSha256, base.canonicalSha256);

const missing = freezeDarkCandidates({ sessionDateEt: "2026-07-20", signals: [signal(3, t0)], executionObservations: [] });
check("missing execution evidence fails closed", [missing.candidates.length, missing.censors[0].code], [0, "missing_execution_observation"]);

const malformed = freezeDarkCandidates({
  sessionDateEt: "2026-07-20",
  signals: [signal(4, t0, { rationale: { ...(signal(4, t0).rationale as object), configuration_epoch_id: "mutable" } })],
  executionObservations: [observation(14, t0)],
});
check("mutable configuration identity is censored", malformed.censors[0].code, "missing_configuration_epoch");

const noAsk = freezeDarkCandidates({
  sessionDateEt: "2026-07-20", signals: [signal(5, t0)], executionObservations: [observation(15, t0, { ask: null })],
});
check("missing live ask remains null provenance and exact reconstruction stays possible", [noAsk.candidates.length, noAsk.candidates[0].liveObservedAsk, noAsk.summary.liveAskUnavailableDecisions], [1, null, 1]);

const reusedObservation = freezeDarkCandidates({
  sessionDateEt: "2026-07-20",
  signals: [signal(10, t0, {
    rationale: {
      ...(signal(10, t0).rationale as object),
      decision_observed_at: new Date(Date.parse(t0) + DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS + 701).toISOString(),
    },
  })],
  executionObservations: [observation(20, t0)],
});
check("an earlier execution observation cannot support a later configuration decision", reusedObservation.censors[0].code, "execution_identity_mismatch");

const wrongSession = freezeDarkCandidates({
  sessionDateEt: "2026-07-21",
  signals: [signal(21, t0)],
  executionObservations: [observation(22, t0)],
});
check("a source bar from another ET session is censored", wrongSession.censors[0].code, "session_date_mismatch");

const ambiguous = freezeDarkCandidates({
  sessionDateEt: "2026-07-20", signals: [signal(6, t0)],
  executionObservations: [observation(16, t0), observation(17, t0)],
});
check("ambiguous evidence join fails closed", ambiguous.censors[0].code, "ambiguous_execution_observation");

const duplicate = freezeDarkCandidates({
  sessionDateEt: "2026-07-20", signals: [signal(7, t0), signal(8, t0)],
  executionObservations: [observation(18, t0)],
});
check("duplicate canonical candidates are not silently pooled", [duplicate.candidates.length, duplicate.censors.map((row) => row.code)], [0, ["conflicting_canonical_candidate", "conflicting_canonical_candidate"]]);

const halfDayBar = "2026-11-27T15:00:00.000Z";
const halfDay = freezeDarkCandidates({
  sessionDateEt: "2026-11-27", signals: [signal(9, halfDayBar)], executionObservations: [observation(19, halfDayBar)],
});
check("half-day request honors maintained market close", halfDay.contractRequests[0].endIso, "2026-11-27T17:55:02.000Z");
check("path cutoff constant is explicit", DARK_CANDIDATE_PATH_END_MINUTES_BEFORE_CLOSE, 5);

const lateDecisionBar = "2026-07-20T19:56:00.000Z";
const lateDecision = freezeDarkCandidates({
  sessionDateEt: "2026-07-20",
  signals: [signal(30, lateDecisionBar)],
  executionObservations: [observation(31, lateDecisionBar)],
});
check(
  "late observed decisions extend their own future request instead of becoming out-of-window",
  lateDecision.contractRequests[0].endIso,
  new Date(Date.parse(lateDecisionBar) + 800 + DARK_CANDIDATE_REQUEST_PADDING_MS).toISOString(),
);

const script = readFileSync(new URL("../../scripts/freeze-dark-candidates.ts", import.meta.url), "utf8");
check("adapter contains no Supabase mutation calls", /\.(?:insert|upsert|delete)\s*\(|sb\.from[^;]+\.update\s*\(/s.test(script), false);
check("adapter contains no order API", /orderAndFill|placeOrder|closePosition/.test(script), false);
check("adapter labels itself SELECT-only", script.includes("Supabase SELECT-only"), true);

console.log(`dark-candidate-freeze-selftest: ${checks}/${checks} PASS`);
