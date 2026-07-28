import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildVbExactCandidateDryRun,
  canonicalVbCandidateId,
  candidateDbPayload,
  coalesceVbCandidateDecisions,
  VB_BOUNDARY_MAX_LAG_MS,
  VB_CBBO_ASOF_LOOKBACK_MS,
  VB_CANDIDATE_SQL_FIELDS,
  VB_EXACT_PATH_BUILDER_VERSION,
  VB_EXACT_PATH_SQL_FIELDS,
  type VbCandidateDecision,
} from "./vbCandidateEvidence.js";
import type { DatabentoCbboQuote } from "./databentoExactPath.js";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const t0 = Date.parse("2026-07-20T13:35:00.000Z");
const end = t0 + 4_000;
const base: VbCandidateDecision = {
  signalId: "11111111-1111-4111-8111-111111111111",
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "vb-squeeze-break-qqq",
  channelVersion: `sha256:${"a".repeat(64)}`,
  configurationEpochId: `sha256:${"b".repeat(64)}`,
  sourceVersion: "stream-test",
  sourceBarAtMs: t0,
  decisionObservedAtMs: t0 + 200,
  underlying: "QQQ",
  side: "call",
  occSymbol: "QQQ260720C00600000",
  liveObservedAsk: {
    price: 9.99,
    feed: "alpaca_snapshot",
    providerAtMs: null,
    observedAtMs: t0 + 200,
    freshnessMs: 200,
    exactExecutable: false,
  },
  blockedReason: "not_armed",
  virtualExitAtMs: end,
};

const id = canonicalVbCandidateId(base);
const otherAccount = { ...base, accountId: "44444444-4444-4444-8444-444444444444" };
check("candidate identity excludes routing account", id, canonicalVbCandidateId(otherAccount));
check("configuration changes candidate identity", canonicalVbCandidateId({ ...base, configurationEpochId: `sha256:${"c".repeat(64)}` }) === id, false);
check("source-clock changes candidate identity", canonicalVbCandidateId({ ...base, sourceBarAtMs: t0 + 60_000 }) === id, false);
check("invalid OCC fails closed", canonicalVbCandidateId({ ...base, occSymbol: "QQQ" }), null);
check("OCC side mismatch fails closed", canonicalVbCandidateId({ ...base, side: "put" }), null);
check("OCC underlying mismatch fails closed", canonicalVbCandidateId({ ...base, underlying: "SPY" }), null);

const coalesced = coalesceVbCandidateDecisions([
  base,
  { ...base, signalId: "55555555-5555-4555-8555-555555555555", sourceBarAtMs: t0 + 1_000, decisionObservedAtMs: t0 + 1_200, virtualExitAtMs: end + 1_000 },
  { ...base, signalId: "66666666-6666-4666-8666-666666666666", sourceBarAtMs: end, decisionObservedAtMs: end + 200, virtualExitAtMs: end + 4_000 },
]);
check("per-minute repeats coalesce until prior exit", coalesced.map((row) => row.signalId), [base.signalId, "66666666-6666-4666-8666-666666666666"]);
check("legitimate re-entry gets a new ordinal", coalesced.map((row) => row.reentryOrdinal), [1, 2]);
check("order path remains unauthorized", coalesced.every((row) => !row.orderPathAuthorized), true);
check("Day 1 dark lifecycle remains valid research evidence",
  candidateDbPayload({ ...coalesced[0], blockedReason: "day1_dark_lifecycle" })?.blocked_reason,
  "day1_dark_lifecycle");

const candidate = coalesced[0];
const candidatePayload = candidateDbPayload(candidate)!;
check("candidate payload retains strategist and source identity", [candidatePayload.strategist_id, candidatePayload.source_version], [base.strategistId, base.sourceVersion]);
check("candidate payload retains separate decision observation clock", candidatePayload.decision_observed_at, new Date(base.decisionObservedAtMs).toISOString());
check("live ask is explicitly non-exact provenance", [candidatePayload.live_observed_ask, candidatePayload.live_ask_feed, candidatePayload.live_ask_provider_at, candidatePayload.live_ask_exact], [9.99, "alpaca_snapshot", null, false]);

const quote = (atMs: number, bid: number, ask: number): DatabentoCbboQuote => ({
  occSymbol: base.occSymbol, atMs, bid, ask, bidSize: 10, askSize: 12,
  publisherId: 1, source: "databento_cbbo_1s",
});
const exactQuotes = [
  quote(t0, 0.95, 1.05),
  quote(t0 + 500, 0.95, 1.05),
  quote(t0 + 1_500, 1.2, 1.25),
  quote(t0 + 2_500, 1.1, 1.15),
  quote(t0 + 3_500, 1.3, 1.35),
  quote(end + 500, 1.1, 1.15),
];
const dry = buildVbExactCandidateDryRun({ candidate, databentoQuotes: exactQuotes, nativeSyntheticPnlPerContract: 33 });
check("dry run performs zero external writes", dry.externalWrites, false);
check("request uses the exact OCC and deterministic boundary", [dry.request?.occSymbol, dry.request?.startIso, dry.request?.endIso], [
  base.occSymbol, new Date(base.sourceBarAtMs - VB_CBBO_ASOF_LOOKBACK_MS).toISOString(), new Date(end + VB_BOUNDARY_MAX_LAG_MS + 1).toISOString(),
]);
check("Databento ask, not live observed ask, is the score entry", [dry.scorecard.exactEntryAsk, dry.scorecard.liveObservedAsk?.price], [1.05, 9.99]);
check("clean exact path produces every preregistered manager arm", [dry.scorecard.eligible, dry.scorecard.exactArms.length, dry.censors], [true, 8, []]);
check("manager exits use exact ask to executable bid", dry.scorecard.exactArms.every((row) => row.basis === "databento_entry_ask_to_executable_bid"), true);
check("native synthetic result remains separately labeled", dry.scorecard.nativeSynthetic, { basis: "native_mid_synthetic_development_only", pnlPerContract: 33 });
check("content and manifest are deterministic", buildVbExactCandidateDryRun({ candidate, databentoQuotes: [...exactQuotes].reverse() }).exactPathPayload, dry.exactPathPayload);
check("content address contains compressed checksum", dry.canonicalObject?.objectKey.includes(dry.canonicalObject.compressedSha256 ?? "missing"), true);
check("payload checksum verification is local and explicit", dry.exactPathPayload?.checksum_verified, true);
check("exact path uses a parser/canonicalizer version separate from candidate source", [
  dry.exactPathPayload?.path_builder_version,
  dry.candidatePayload?.source_version,
], [VB_EXACT_PATH_BUILDER_VERSION, base.sourceVersion]);
check("path builder version is inside canonical content", dry.canonicalObject?.bytes.includes(Buffer.from(VB_EXACT_PATH_BUILDER_VERSION)), true);
const scoreOnly = buildVbExactCandidateDryRun({
  candidate,
  databentoQuotes: exactQuotes,
  nativeSyntheticPnlPerContract: 33,
  materializeCanonicalObject: false,
});
check("score-only mode preserves exact manager outcomes without duplicating the source object", [
  scoreOnly.scorecard,
  scoreOnly.canonicalObject,
  scoreOnly.manifest,
  scoreOnly.exactPathPayload,
], [dry.scorecard, null, null, null]);

const leftCensored = buildVbExactCandidateDryRun({
  candidate,
  databentoQuotes: exactQuotes.filter((row) => row.atMs > candidate.decisionObservedAtMs),
});
check("a quote published only after the decision cannot be used with look-ahead", leftCensored.censors.includes("left_boundary_censored"), true);
const carriedTerminal = buildVbExactCandidateDryRun({ candidate, databentoQuotes: exactQuotes.filter((row) => row.atMs < end) });
check("an unchanged terminal CBBO carries the last published state forward", carriedTerminal.censors.includes("right_boundary_censored"), false);
const internalGap = buildVbExactCandidateDryRun({ candidate, databentoQuotes: [quote(t0 + 100, 1, 1.05), quote(end + 500, 1.1, 1.15)] });
check("internal gap above five seconds is censored", internalGap.censors.includes("internal_gap_censored"), false);
const longCandidate = { ...candidate, virtualExitAtMs: t0 + 8_000 };
const actualInternalGap = buildVbExactCandidateDryRun({ candidate: longCandidate, databentoQuotes: [quote(t0, 1, 1.05), quote(t0 + 5_400, 1.1, 1.15), quote(t0 + 8_500, 1.2, 1.25)] });
check("event-sparse CBBO gaps remain diagnostic instead of false missing-data censors", [
  actualInternalGap.censors.includes("internal_gap_censored"),
  Number(actualInternalGap.exactPathPayload?.max_internal_gap_ms ?? 0) > 5_000,
], [false, true]);
const staleUnproven = buildVbExactCandidateDryRun({ candidate: { ...candidate, liveObservedAsk: { ...candidate.liveObservedAsk!, freshnessMs: 999_999 } }, databentoQuotes: exactQuotes });
check("stale unproven live ask is never substituted into scoring", [staleUnproven.scorecard.eligible, staleUnproven.scorecard.exactEntryAsk], [true, 1.05]);
const noTerminalBid = buildVbExactCandidateDryRun({
  candidate,
  databentoQuotes: [...exactQuotes.filter((row) => row.atMs < end), quote(end, 0, 0.01)],
});
check("no posted terminal bid preserves the exact path without inventing exits", [
  noTerminalBid.censors,
  noTerminalBid.exactPathPayload != null,
  noTerminalBid.scorecard.eligible,
  (noTerminalBid.scorecard.armCensors ?? []).every((row) => row.code === "no_executable_exit_bid"),
  (noTerminalBid.scorecard.armCensors ?? []).length > 0,
], [[], true, false, true, true]);
const invalidExactAsk = buildVbExactCandidateDryRun({ candidate, databentoQuotes: [quote(t0 + 500, 1, 0.9), ...exactQuotes.slice(1)] });
check("invalid exact entry ask is censored", invalidExactAsk.censors.includes("invalid_exact_quote"), true);
const identityMismatch = buildVbExactCandidateDryRun({ candidate, databentoQuotes: [
  { ...exactQuotes[0], occSymbol: "SPY260720C00600000" }, ...exactQuotes.slice(1),
] });
check("Databento response contract mismatch is censored", identityMismatch.censors.includes("path_identity_mismatch"), true);
const approximateContract = buildVbExactCandidateDryRun({ candidate: { ...candidate, occSymbol: "QQQ" }, databentoQuotes: exactQuotes });
check("approximate contract is never substituted", [approximateContract.request, approximateContract.censors.includes("invalid_exact_contract")], [null, true]);

function sqlColumns(sql: string, table: string): string[] {
  const body = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"))?.[1] ?? "";
  return body.split("\n")
    .map((line) => line.match(/^\s{2}([a-z][a-z0-9_]*)\s+/)?.[1] ?? null)
    .filter((value): value is string => typeof value === "string"
      && !["created_at", "check", "unique", "foreign"].includes(value));
}
const migration = readFileSync(new URL("../../supabase/migrations/20260717210403_gate2_vb_exact_candidate_receipts.sql", import.meta.url), "utf8");
const gateShadow = readFileSync(new URL("../../scripts/gate-shadow.ts", import.meta.url), "utf8");
const gateShadowPolicy = readFileSync(new URL("./gateShadowPolicy.ts", import.meta.url), "utf8");
check("nightly reconstruction uses release-agnostic dark lifecycle sequential semantics", [
  /isGateShadowBlockReason/.test(gateShadow) && /"dark_lifecycle"/.test(gateShadowPolicy),
  /isGateShadowSequentialBlockReason/.test(gateShadow) && /"dark_lifecycle"/.test(gateShadowPolicy),
  /blocked_reason in \([^\)]*'day1_dark_lifecycle'/.test(migration),
], [true, true, true]);
check("candidate SQL and generated payload align field-for-field", sqlColumns(migration, "vb_candidate_receipts"), [...VB_CANDIDATE_SQL_FIELDS]);
check("exact-path SQL and generated payload align field-for-field", sqlColumns(migration, "vb_exact_path_receipts"), [...VB_EXACT_PATH_SQL_FIELDS]);
check("candidate generated keys exactly equal the SQL contract", Object.keys(dry.candidatePayload ?? {}), [...VB_CANDIDATE_SQL_FIELDS]);
check("exact generated keys exactly equal the SQL contract", Object.keys(dry.exactPathPayload ?? {}), [...VB_EXACT_PATH_SQL_FIELDS]);

console.log(`vb-candidate-evidence-selftest: ${checks}/${checks} PASS`);
