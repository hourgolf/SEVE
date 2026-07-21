import { buildVbExactCandidateBatchPlan } from "./vbExactCandidateBatch";
import { coalesceVbCandidateDecisions, type VbCandidateDecision } from "./vbCandidateEvidence";

const decision = (signalId: string, occSymbol: string, sourceBarAtMs: number, virtualExitAtMs: number): VbCandidateDecision => ({
  signalId,
  strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  channelSlug: "vb-test",
  channelVersion: `sha256:${"a".repeat(64)}`,
  configurationEpochId: `sha256:${"b".repeat(64)}`,
  sourceVersion: "batch-selftest-v1",
  sourceBarAtMs,
  decisionObservedAtMs: sourceBarAtMs + 200,
  underlying: "SPY",
  side: occSymbol.includes("C") ? "call" : "put",
  occSymbol,
  liveObservedAsk: null,
  blockedReason: "day1_dark_lifecycle",
  virtualExitAtMs,
});

const start = Date.parse("2026-07-21T13:45:00.000Z");
const candidates = coalesceVbCandidateDecisions([
  decision("11111111-1111-4111-8111-111111111111", "SPY260721C00755000", start, start + 60_000),
  decision("11111111-1111-4111-8111-111111111112", "SPY260721P00750000", start + 120_000, start + 240_000),
]);
const plan = buildVbExactCandidateBatchPlan(candidates, start + 240_000 + 24 * 60 * 60_000 + 1_102);

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
};
check("candidate count", plan.candidates.length, 2);
check("one bounded request per exact contract", plan.requests.length, 2);
check("first exact contract", plan.requests[0].occSymbols, ["SPY260721C00755000"]);
check("raw symbol retains OCC spacing", plan.requests[0].rawSymbols, ["SPY   260721C00755000"]);
check("start uses first decision observation", plan.requests[0].startIso, "2026-07-21T13:45:00.200Z");
check("end includes boundary allowance", plan.requests[1].endIso, "2026-07-21T13:49:01.101Z");
check("historical gate opens from newest requested quote", plan.access.ready, true);

let duplicate = false;
try { buildVbExactCandidateBatchPlan([candidates[0], candidates[0]], Date.now()); } catch { duplicate = true; }
check("duplicate candidate fails closed", duplicate, true);

console.log(`vb-exact-candidate-batch-selftest: ${passed}/8 passed`);
