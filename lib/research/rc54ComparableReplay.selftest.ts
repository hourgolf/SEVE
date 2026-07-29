import assert from "node:assert/strict";
import {
  deriveRc54ComparableTargetGrid,
  type Rc54ComparableCandidate,
} from "./rc54ComparableReplay";
import type { DatabentoCbboQuote } from "./databentoExactPath";

let passed = 0;
const check = (name: string, test: () => void): void => {
  test();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const session = "2026-07-28";
const start = Date.parse("2026-07-28T13:30:00.000Z");
const occ = "SPY260728C00640000";
const quote = (minute: number, bid: number, ask = Math.max(bid, 1)): DatabentoCbboQuote => ({
  occSymbol: occ,
  atMs: start + minute * 60_000,
  bid,
  ask,
  bidSize: null,
  askSize: null,
  publisherId: null,
  source: "databento_cbbo_1s",
});
const candidate = (
  id: string,
  minute: number,
  channelSlug = "vb-macd-state",
): Rc54ComparableCandidate => ({
  candidateId: id,
  sessionDateEt: session,
  channelSlug,
  occSymbol: occ,
  decisionAtMs: start + minute * 60_000,
});
const map = (quotes: DatabentoCbboQuote[]) =>
  new Map([[`${session}\u0000${occ}`, quotes]]);

check("entry is exact ask and exits use executable bids", () => {
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c1", 1)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 0.95, 1),
      quote(2, 1.31, 1.35),
      quote(3, 1.51, 1.55),
      quote(355, 1.2, 1.25),
    ]),
    targetGrid: [30],
    runnerGrid: ["fixed-50"],
  });
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].entryAsk, 1);
  assert.deepEqual(result.paths[0].lotExits.map((lot) => [lot.exitReason, lot.exitBid]), [
    ["target", 1.31],
    ["target", 1.51],
  ]);
  assert.equal(result.paths[0].pnl, 82);
});

check("no posted ask blocks entry but remains valid after an exact entry", () => {
  const blocked = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c-no-ask-entry", 1)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 0.95, 0),
      quote(2, 1.31, 0),
      quote(355, 1.2, 1.25),
    ]),
    targetGrid: [30],
    runnerGrid: ["fixed-50"],
  });
  assert.equal(blocked.paths.length, 0);
  assert.ok(blocked.censors.some((row) => row.code === "invalid_entry_ask"));

  const afterEntry = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c-no-ask-after-entry", 1)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 0.95, 1),
      quote(2, 1.31, 0),
      quote(3, 1.51, 0),
      quote(355, 1.2, 1.25),
    ]),
    targetGrid: [30],
    runnerGrid: ["fixed-50"],
  });
  assert.equal(afterEntry.paths.length, 1);
  assert.deepEqual(afterEntry.paths[0].lotExits.map((lot) => lot.exitBid), [1.31, 1.51]);
});

check("risk remains first and applies to both lots", () => {
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c2", 1)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 1, 1),
      quote(2, 0.69, 0.72),
      quote(355, 2, 2.1),
    ]),
    targetGrid: [30],
    runnerGrid: ["a13"],
  });
  assert.deepEqual(result.paths[0].lotExits.map((lot) => lot.exitReason), [
    "stop",
    "prearm_stop",
  ]);
});

check("different target profiles have independent sequential lanes", () => {
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c3", 1), candidate("c4", 3)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 1, 1),
      quote(2, 1.21, 1.25),
      quote(3, 1, 1),
      quote(4, 1.31, 1.35),
      quote(355, 1.1, 1.15),
    ]),
    targetGrid: [20, 30],
    runnerGrid: ["ride"],
  });
  const c4 = result.paths.filter((path) => path.candidateId === "c4");
  assert.equal(c4.length, 0);
  assert.ok(result.censors.some((row) => row.candidateId === "c4"
    && row.code === "sequential_reentry_active" && row.profileId === "BANK20/RIDE"));
  assert.ok(result.censors.some((row) => row.candidateId === "c4"
    && row.code === "sequential_reentry_active" && row.profileId === "BANK30/RIDE"));
});

check("overlapping channels remain independent", () => {
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c5", 1), candidate("c6", 2, "vb-squeeze-break")],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 1, 1),
      quote(2, 1, 1),
      quote(355, 1.1, 1.15),
    ]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.equal(result.paths.length, 2);
});

check("old shadow exit fields are not an input to comparable replay", () => {
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c7", 1)],
    quotesByOccSession: map([
      quote(0, 0.9, 1),
      quote(1, 1, 1),
      quote(2, 1.31, 1.35),
      quote(355, 1.1, 1.15),
    ]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.equal(result.methodology.historicalVirtualOutcomesIgnored, true);
});

check("non-Databento paths fail closed", () => {
  const bad = quote(0, 1, 1);
  const result = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c8", 1)],
    quotesByOccSession: new Map([[`${session}\u0000${occ}`, [
      { ...bad, source: "other" as "databento_cbbo_1s" },
    ]]]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.equal(result.paths.length, 0);
  assert.ok(result.censors.some((row) => row.code === "non_exact_path_source"));
});

check("missing entry state and post-flatten decisions fail closed", () => {
  const missing = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c9", 0)],
    quotesByOccSession: map([quote(1, 1, 1), quote(355, 1, 1)]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.ok(missing.censors.some((row) => row.code === "missing_entry_state"));
  const late = deriveRc54ComparableTargetGrid({
    candidates: [candidate("c10", 356)],
    quotesByOccSession: map([quote(0, 1, 1), quote(355, 1, 1)]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.ok(late.censors.some((row) => row.code === "entry_after_flatten"));
});

check("duplicate candidate identities fail closed", () => {
  const repeated = candidate("same", 1);
  const result = deriveRc54ComparableTargetGrid({
    candidates: [repeated, repeated],
    quotesByOccSession: map([quote(0, 1, 1), quote(355, 1, 1)]),
    targetGrid: [30],
    runnerGrid: ["ride"],
  });
  assert.equal(result.paths.length, 0);
  assert.equal(result.source.exactCensoredCandidateClocks, 2);
  assert.ok(result.censors.every((row) => row.code === "duplicate_candidate"));
});

check("receipt is deterministic and has no authority surface", () => {
  const input = {
    candidates: [candidate("c11", 1)],
    quotesByOccSession: map([quote(0, 1, 1), quote(355, 1.1, 1.15)]),
    targetGrid: [30],
    runnerGrid: ["ride"] as const,
  };
  const first = deriveRc54ComparableTargetGrid(input);
  const second = deriveRc54ComparableTargetGrid(input);
  assert.equal(first.canonicalSha256, second.canonicalSha256);
  assert.equal(first.methodology.externalWrites, false);
  assert.equal(first.methodology.orderPathAuthorized, false);
  assert.equal(first.methodology.policyChangeAuthorized, false);
});

console.log(`rc54-comparable-replay-selftest: ${passed}/${passed} PASS`);
