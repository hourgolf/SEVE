import assert from "node:assert/strict";
import type { Rc54ComparableFreeze } from "./rc54ComparableFreeze";
import type { Rc54ComparablePath, Rc54ComparableReplayResult } from "./rc54ComparableReplay";
import { analyzeRc54ComparableTargets } from "./rc54TargetAnalysis";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const sessions = Array.from({ length: 12 }, (_, index) =>
  `2026-07-${String(index + 1).padStart(2, "0")}`);
const targets = [20, 25, 30, 35, 40];
const candidates = sessions.flatMap((session, sessionIndex) =>
  Array.from({ length: 2 }, (_, ordinal) => ({
    candidateId: `${session}-${ordinal}`,
    sessionDateEt: session,
    channelSlug: "vb-vwap-revert",
    occSymbol: "SPY260731C00640000",
    decisionAtMs: Date.parse(`${session}T14:00:0${ordinal}.000Z`),
    source: "virtual_trade_candidate_clock" as const,
    channelClass: "dark_vb" as const,
  })));

const path = (
  candidateId: string,
  sessionDateEt: string,
  targetPct: number,
  pnlPerContract: number,
): Rc54ComparablePath => ({
  candidateId,
  sessionDateEt,
  channelSlug: "vb-vwap-revert",
  occSymbol: "SPY260731C00640000",
  profileId: `BANK${targetPct}/RIDE`,
  targetPct,
  runner: "ride",
  decisionAt: `${sessionDateEt}T14:00:00.000Z`,
  entryQuoteAt: `${sessionDateEt}T13:59:59.000Z`,
  entryAsk: 1,
  exitAt: `${sessionDateEt}T19:25:00.000Z`,
  pnl: pnlPerContract * 2,
  pnlPerContract,
  lotExits: [],
  basis: "databento_entry_ask_to_executable_bid",
  independentOpportunity: true,
});

const paths = candidates.flatMap((candidate) => targets.map((target) => {
  const pnl = target === 25 || target === 30 ? 10 : target === 20 ? 6 : -2;
  return path(candidate.candidateId, candidate.sessionDateEt, target, pnl);
}));
const freeze = {
  canonicalSha256: "sha256:freeze",
  candidates,
} as unknown as Rc54ComparableFreeze;
const replay = {
  canonicalSha256: "sha256:replay",
  paths,
  source: {
    exactEligibleCandidateClocks: candidates.length,
    exactCensoredCandidateClocks: 0,
  },
} as unknown as Rc54ComparableReplayResult;

check("channel analysis preserves the target grid and runner identity", () => {
  const result = analyzeRc54ComparableTargets({ freeze, replay });
  assert.equal(result.channels.length, 1);
  assert.deepEqual(result.channels[0].profiles.map((profile) => profile.targetPct), targets);
  assert.equal(result.channels[0].runner, "ride");
});

check("adjacent chronologically stable near-top targets form a descriptive plateau", () => {
  const result = analyzeRc54ComparableTargets({ freeze, replay });
  assert.equal(result.channels[0].candidatePlateau.disposition, "descriptive_plateau");
  assert.deepEqual(result.channels[0].candidatePlateau.targets, [25, 30]);
});

check("small samples do not emit a target range", () => {
  const result = analyzeRc54ComparableTargets({
    freeze,
    replay: { ...replay, paths: paths.slice(0, 5) },
  });
  assert.equal(result.channels[0].candidatePlateau.disposition, "insufficient");
  assert.deepEqual(result.channels[0].candidatePlateau.targets, []);
});

check("out-of-freeze path identity fails closed", () => {
  assert.throws(() => analyzeRc54ComparableTargets({
    freeze,
    replay: {
      ...replay,
      paths: [path("unknown", sessions[0], 30, 1)],
    },
  }));
});

check("analysis cannot select, propose, activate, write, or place orders", () => {
  const result = analyzeRc54ComparableTargets({ freeze, replay });
  assert.equal(result.decisionBoundary.strategicValuesSelected, false);
  assert.equal(result.decisionBoundary.proposalCreated, false);
  assert.equal(result.decisionBoundary.activationAuthorized, false);
  assert.equal(result.externalWrites, false);
  assert.equal(result.orderPathAuthorized, false);
  assert.equal(result.policyChangeAuthorized, false);
});

console.log(`rc54-target-analysis-selftest: ${passed}/${passed} PASS`);
