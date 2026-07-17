import assert from "node:assert/strict";
import {
  adaptVbCandidateToManagerScorecard,
  canonicalVbCandidateId,
  coalesceVbCandidateDecisions,
  exactPathObjectKey,
  type VbCandidateDecision,
} from "./vbCandidateEvidence.js";
import { EXACT_OPTION_PATH_DATASET, EXACT_OPTION_PATH_SCHEMA } from "./databentoExactPath.js";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, name);
  checks++;
}

const t0 = Date.parse("2026-07-20T13:35:00.000Z");
const base: VbCandidateDecision = {
  signalId: "signal-a",
  channelSlug: "vb-squeeze-break-qqq",
  channelVersion: `sha256:${"a".repeat(64)}`,
  configurationEpochId: `sha256:${"b".repeat(64)}`,
  sourceBarAtMs: t0,
  underlying: "QQQ",
  side: "call",
  occSymbol: "QQQ260720C00600000",
  entryAsk: 1,
  blockedReason: "not_armed",
  virtualExitAtMs: t0 + 120_000,
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const id = canonicalVbCandidateId(base);
const otherAccount = { ...base, accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
check("candidate id is deterministic", id, canonicalVbCandidateId(otherAccount));
check("account is provenance, not candidate identity", id?.startsWith("vbcan:"), true);
check("configuration changes candidate identity", canonicalVbCandidateId({ ...base, configurationEpochId: `sha256:${"c".repeat(64)}` }) === id, false);
check("source-clock changes candidate identity", canonicalVbCandidateId({ ...base, sourceBarAtMs: t0 + 60_000 }) === id, false);
check("invalid OCC fails closed", canonicalVbCandidateId({ ...base, occSymbol: "QQQ" }), null);
check("OCC side mismatch fails closed", canonicalVbCandidateId({ ...base, side: "put" }), null);
check("OCC underlying mismatch fails closed", canonicalVbCandidateId({ ...base, underlying: "SPY" }), null);

const coalesced = coalesceVbCandidateDecisions([
  base,
  { ...base, signalId: "signal-b", sourceBarAtMs: t0 + 60_000, virtualExitAtMs: t0 + 180_000 },
  { ...base, signalId: "signal-c", sourceBarAtMs: t0 + 120_000, virtualExitAtMs: t0 + 240_000 },
]);
check("per-minute repeats coalesce until prior exit", coalesced.map((row) => row.signalId), ["signal-a", "signal-c"]);
check("legitimate re-entry gets a new ordinal", coalesced.map((row) => row.reentryOrdinal), [1, 2]);
check("opportunities differ across re-entry", coalesced[0].opportunityId === coalesced[1].opportunityId, false);
check("order path stays unauthorized", coalesced.every((row) => !row.orderPathAuthorized), true);

const candidate = coalesced[0];
const scoreCandidate = { ...candidate, virtualExitAtMs: t0 + 2_000 };
const content = new TextEncoder().encode("canonical compressed bytes");
const keyA = exactPathObjectKey(candidate, content);
const keyB = exactPathObjectKey(candidate, content);
check("content-addressed R2 key is deterministic", keyA, keyB);
check("content-addressed checksum is sha256", keyA.compressedSha256.length, 64);

const exactPath = {
  schemaVersion: 1 as const,
  candidateId: scoreCandidate.candidateId,
  opportunityId: scoreCandidate.opportunityId,
  dataset: EXACT_OPTION_PATH_DATASET,
  schema: EXACT_OPTION_PATH_SCHEMA,
  objectKey: keyA.objectKey,
  compressedSha256: keyA.compressedSha256,
  rows: 3,
  startAtMs: t0,
  endAtMs: t0 + 2_000,
  checksumVerified: true,
  contractValid: true,
  quotes: [
    { atMs: t0, bid: 0.95, ask: 1.0 },
    { atMs: t0 + 1_000, bid: 1.2, ask: 1.25 },
    { atMs: t0 + 2_000, bid: 1.1, ask: 1.15 },
  ],
};
const scored = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath, nativeSyntheticPnlPerContract: 33 });
check("exact candidate is eligible across preregistered arms", [scored.eligible, scored.exactArms.length, scored.censors], [true, 8, []]);
check("manager exits use executable bid", scored.exactArms.every((row) => row.basis === "entry_executable_ask_exit_executable_bid"), true);
check("native result remains separately labeled development evidence", scored.nativeSynthetic, {
  basis: "native_mid_synthetic_development_only",
  pnlPerContract: 33,
});
check("scorecard never authorizes policy/order change", [scored.policyChangeAuthorized, scored.orderPathAuthorized], [false, false]);

const missing = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath: null });
check("missing exact path censors instead of substituting", [missing.eligible, missing.censors, missing.exactArms.length], [false, ["missing_exact_path"], 0]);
const badContract = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath: { ...exactPath, contractValid: false } });
check("invalid exact contract censors", badContract.censors.includes("invalid_exact_contract"), true);
const badChecksum = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath: { ...exactPath, checksumVerified: false } });
check("unverified content censors", badChecksum.censors.includes("path_checksum_unverified"), true);
const badBid = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath: { ...exactPath, quotes: [{ atMs: t0, bid: 0, ask: 1 }], rows: 1 } });
check("invalid bid path censors without approximation", badBid.censors.includes("invalid_executable_bid_path"), true);
const incomplete = adaptVbCandidateToManagerScorecard({ candidate: scoreCandidate, exactPath: { ...exactPath, endAtMs: t0 + 1_000 } });
check("path that does not cover virtual exit censors", incomplete.censors.includes("invalid_executable_bid_path"), true);

console.log(`vb-candidate-evidence-selftest: ${checks}/${checks} PASS`);
