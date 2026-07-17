// Deterministic, in-memory Gate 2 proof. This script imports no storage or
// database client and cannot perform an R2 or Supabase write.
import {
  buildVbExactCandidateDryRun,
  coalesceVbCandidateDecisions,
  VB_CANDIDATE_SQL_FIELDS,
  VB_EXACT_PATH_SQL_FIELDS,
  type VbCandidateDecision,
} from "../lib/research/vbCandidateEvidence.js";
import type { DatabentoCbboQuote } from "../lib/research/databentoExactPath.js";

const sourceBarAtMs = Date.parse("2026-07-20T13:35:00.000Z");
const virtualExitAtMs = sourceBarAtMs + 4_000;
const decision: VbCandidateDecision = {
  signalId: "11111111-1111-4111-8111-111111111111",
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "vb-squeeze-break-qqq",
  channelVersion: `sha256:${"a".repeat(64)}`,
  configurationEpochId: `sha256:${"b".repeat(64)}`,
  sourceVersion: "stream-gate2-dry-run",
  sourceBarAtMs,
  underlying: "QQQ",
  side: "call",
  occSymbol: "QQQ260720C00600000",
  liveObservedAsk: {
    price: 9.99,
    feed: "alpaca_snapshot",
    providerAtMs: null,
    observedAtMs: sourceBarAtMs + 200,
    freshnessMs: 200,
    exactExecutable: false,
  },
  blockedReason: "not_armed",
  virtualExitAtMs,
};
const candidate = coalesceVbCandidateDecisions([decision])[0];
const quote = (offsetMs: number, bid: number, ask: number): DatabentoCbboQuote => ({
  occSymbol: decision.occSymbol,
  atMs: sourceBarAtMs + offsetMs,
  bid,
  ask,
  bidSize: 10,
  askSize: 12,
  publisherId: 1,
  source: "databento_cbbo_1s",
});
const dryRun = buildVbExactCandidateDryRun({
  candidate,
  databentoQuotes: [
    quote(500, 0.95, 1.05),
    quote(1_500, 1.20, 1.25),
    quote(2_500, 1.10, 1.15),
    quote(3_500, 1.30, 1.35),
    quote(4_500, 1.10, 1.15),
  ],
});

console.log(JSON.stringify({
  adapter: "candidate ledger -> exact request -> Databento validation -> content address + manifest -> proposed SQL payload -> manager scorecard",
  externalWrites: dryRun.externalWrites,
  request: dryRun.request,
  candidateId: candidate.candidateId,
  strategistId: dryRun.candidatePayload?.strategist_id,
  sourceVersion: dryRun.candidatePayload?.source_version,
  liveObservedAsk: dryRun.candidatePayload?.live_observed_ask,
  liveAskExact: dryRun.candidatePayload?.live_ask_exact,
  exactEntryAsk: dryRun.exactPathPayload?.entry_ask,
  entryQuoteAt: dryRun.exactPathPayload?.entry_quote_at,
  leftBoundaryLagMs: dryRun.exactPathPayload?.left_boundary_lag_ms,
  rightBoundaryLagMs: dryRun.exactPathPayload?.right_boundary_lag_ms,
  maxInternalGapMs: dryRun.exactPathPayload?.max_internal_gap_ms,
  contentSha256: dryRun.canonicalObject?.contentSha256,
  compressedSha256: dryRun.canonicalObject?.compressedSha256,
  objectKey: dryRun.canonicalObject?.objectKey,
  managerArms: dryRun.scorecard.exactArms.map((arm) => `${arm.managerVersion}:${arm.managerId}`),
  candidateSqlFieldsAligned: JSON.stringify(Object.keys(dryRun.candidatePayload ?? {})) === JSON.stringify(VB_CANDIDATE_SQL_FIELDS),
  exactPathSqlFieldsAligned: JSON.stringify(Object.keys(dryRun.exactPathPayload ?? {})) === JSON.stringify(VB_EXACT_PATH_SQL_FIELDS),
  censors: dryRun.censors,
  eligible: dryRun.scorecard.eligible,
  orderPathAuthorized: dryRun.scorecard.orderPathAuthorized,
}, null, 2));
