// Local-only renderer for a frozen legacy VB candidate ledger plus a completed
// exact-replay report. It performs no network or database I/O.

import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  deriveDarkEvidenceCompleteness,
  type DarkEvidenceCompleteness,
} from "../lib/research/darkEvidenceCompleteness.js";
import type { DarkCandidateFreeze } from "../lib/research/darkCandidateFreeze.js";
import type { VbCandidateReceipt, VbCandidateScorecard } from "../lib/research/vbCandidateEvidence.js";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const CANDIDATES = arg("candidates", "data/vb-candidates.json");
const CANDIDATE_CENSORS = arg("candidate-censors", "data/vb-candidate-censors.json");
const EXACT_REPORT = arg("exact-report");
const GATE_READY_AT = arg("gate-ready-at");
const OUT = arg("out");
const EXPECTED_SHA256 = arg("expected-sha256");
const expectedManagerArmsArg = arg("expected-manager-arms");
const EXPECTED_MANAGER_ARMS = expectedManagerArmsArg ? Number(expectedManagerArmsArg) : undefined;

if (!EXACT_REPORT || !GATE_READY_AT || !OUT) {
  throw new Error("--exact-report, --gate-ready-at, and --out are required");
}

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const load = <T>(path: string): { value: T; bytes: Buffer; sha256: string } => {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")) as T, bytes, sha256: sha256(bytes) };
};

interface LegacyCandidateCensor { signalId: string; code: string }
interface ExactReport { scorecards: VbCandidateScorecard[] }

const candidates = load<VbCandidateReceipt[]>(CANDIDATES);
const candidateCensors = load<LegacyCandidateCensor[]>(CANDIDATE_CENSORS);
const exact = load<ExactReport>(EXACT_REPORT);
if (EXPECTED_SHA256 && candidates.sha256 !== EXPECTED_SHA256) {
  throw new Error(`candidate checksum mismatch: expected ${EXPECTED_SHA256}, got ${candidates.sha256}`);
}
if (!Number.isFinite(Date.parse(GATE_READY_AT))) throw new Error("invalid --gate-ready-at");
if (EXPECTED_MANAGER_ARMS != null && (!Number.isInteger(EXPECTED_MANAGER_ARMS) || EXPECTED_MANAGER_ARMS <= 0)) {
  throw new Error("--expected-manager-arms must be a positive integer");
}

const sessionDates = [...new Set(candidates.value.map((row) => row.sessionDateEt))];
if (sessionDates.length !== 1) throw new Error(`candidate ledger spans ${sessionDates.length} sessions`);
const contractKeys = [...new Set(candidates.value.map((row) => `${row.sessionDateEt}\u0000${row.occSymbol}`))];
const byChannel = Object.fromEntries(
  [...new Set(candidates.value.map((row) => row.channelSlug))]
    .sort()
    .map((slug) => [slug, candidates.value.filter((row) => row.channelSlug === slug).length]),
);
const byCensor = Object.fromEntries(
  [...new Set(candidateCensors.value.map((row) => row.code))]
    .sort()
    .map((code) => [code, candidateCensors.value.filter((row) => row.code === code).length]),
);

// The legacy frozen ledger predates DarkCandidateFreeze's richer wrapper, but
// it already carries the identity fields used by the completeness derivation.
// This adapter does not invent execution claims; it only supplies wrapper
// counts and the independently frozen candidate/censor arrays.
const freeze = {
  schemaVersion: 1,
  freezerVersion: "dark-candidate-freezer-v1",
  sessionDateEt: sessionDates[0],
  source: "supabase_select_only_signals_plus_execution_observations",
  sourceCounts: {
    signals: candidates.value.length + candidateCensors.value.length,
    executionObservations: candidates.value.length,
  },
  methodology: {
    independence: "raw_decisions_retained_no_independent_trade_claim",
    replay: "manager_specific_sequential_replay_after_exact_path",
    liveAskBasis: "alpaca_snapshot_non_exact_provenance_only",
    exactPathBasis: "databento_cbbo_1s_required",
    signalExecutionClockMaxSkewMs: 5000,
    externalWrites: false,
    orderPathAuthorized: false,
  },
  candidates: candidates.value,
  censors: candidateCensors.value,
  contractRequests: contractKeys.map((key) => ({ requestId: key })),
  summary: {
    validRawDecisions: candidates.value.length,
    censoredSignals: candidateCensors.value.length,
    exactContracts: contractKeys.length,
    estimatedMaximumOneSecondRows: 0,
    liveAskUnavailableDecisions: candidates.value.filter((row) => row.liveObservedAsk == null).length,
    byBlockedReason: {},
    byChannel,
    byCensor,
  },
  canonicalSha256: candidates.sha256,
} as unknown as DarkCandidateFreeze;

const completeness: DarkEvidenceCompleteness = deriveDarkEvidenceCompleteness({
  freeze,
  scorecards: exact.value.scorecards,
  nowMs: Date.now(),
  exactGateReadyAtMs: Date.parse(GATE_READY_AT),
  expectedManagerArms: EXPECTED_MANAGER_ARMS,
});
const candidateById = new Map(candidates.value.map((row) => [row.candidateId, row]));
const exactCensors = exact.value.scorecards
  .filter((row) => row.censors.length > 0 || !row.eligible)
  .map((row) => ({
    candidateId: row.candidateId,
    channelSlug: row.channelSlug,
    occSymbol: candidateById.get(row.candidateId)?.occSymbol ?? null,
    censors: row.censors.length ? row.censors : ["incomplete-manager-arms"],
  }));

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputs: {
    candidates: { path: CANDIDATES, sha256: candidates.sha256 },
    candidateCensors: { path: CANDIDATE_CENSORS, sha256: candidateCensors.sha256 },
    exactReport: { path: EXACT_REPORT, sha256: exact.sha256 },
  },
  completeness,
  exactCensors,
};
mkdirSync(dirname(OUT), { recursive: true });
const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`, "utf8");
writeFileSync(OUT, bytes);
writeFileSync(`${OUT}.receipt.json`, `${JSON.stringify({
  version: completeness.version,
  sessionDateEt: completeness.sessionDateEt,
  state: completeness.state,
  tone: completeness.tone,
  reportSha256: sha256(bytes),
  externalWrites: false,
  orderPathAuthorized: false,
  policyChangeAuthorized: false,
}, null, 2)}\n`);
console.log(`dark-evidence-completeness: ${completeness.state}/${completeness.tone} · ${completeness.counts.exactEligible}/${completeness.counts.frozenCandidates} exact eligible · ${exactCensors.length} censored`);
console.log(`  wrote ${OUT} · external writes NONE`);
