import assert from "node:assert/strict";
import { selectExecutableShadowContract, type ExecutableShadowContractCandidate } from "./executableShadowContractSelection";

const row = (overrides: Partial<ExecutableShadowContractCandidate>): ExecutableShadowContractCandidate => ({
  id: "q0", occSymbol: "SPY260901C00700000", optionType: "call", expiration: "2026-09-01",
  strike: 700, delta: null, underlyingPrice: 700.2, capturedAt: "2026-09-01T14:00:01.500Z",
  requestStartedAt: "2026-09-01T14:00:01.400Z", observedAt: "2026-09-01T14:00:01.480Z",
  providerAt: "2026-09-01T14:00:01.300Z", bid: 1, ask: 1.02, askSize: 10, ...overrides,
});
const policy = { maxEntryDelayMs: 75_000, maxQuoteAgeMs: 15_000, maxSpreadShare: 0.25,
  requireProviderClock: true, requireDisplayedSize: true };
const candidates = [
  row({ id: "base", occSymbol: "SPY260901C00700000", strike: 700 }),
  row({ id: "itm1", occSymbol: "SPY260901C00699000", strike: 699 }),
  row({ id: "itm2", occSymbol: "SPY260901C00698000", strike: 698 }),
  row({ id: "later", occSymbol: "SPY260901C00697000", strike: 697,
    capturedAt: "2026-09-01T14:01:01.500Z", requestStartedAt: "2026-09-01T14:01:01.400Z" }),
];

const itm = selectExecutableShadowContract({ decisionAt: "2026-09-01T14:00:00Z", expiration: "2026-09-01",
  optionType: "call", quantity: 2, candidates, arm: { kind: "itm_steps", steps: 2,
    baseOccSymbol: "SPY260901C00700000" }, policy });
assert.equal(itm.occSymbol, "SPY260901C00698000", "ITM steps must be counted inside the first chain snapshot");

const absentDelta = selectExecutableShadowContract({ decisionAt: "2026-09-01T14:00:00Z", expiration: "2026-09-01",
  optionType: "call", quantity: 2, candidates, arm: { kind: "abs_delta", target: 0.6 }, policy });
assert.equal(absentDelta.occSymbol, null);
assert.equal(absentDelta.reason, "first_chain_snapshot_has_no_observed_delta");

const staleFirst = selectExecutableShadowContract({ decisionAt: "2026-09-01T14:00:00Z", expiration: "2026-09-01",
  optionType: "call", quantity: 2, candidates: candidates.map((candidate, index) => index < 3
    ? { ...candidate, providerAt: "2026-09-01T13:59:00Z" } : candidate),
  arm: { kind: "itm_steps", steps: 1, baseOccSymbol: "SPY260901C00700000" }, policy });
assert.equal(staleFirst.occSymbol, null, "an arm must not skip a bad first snapshot and look ahead");

console.log("executable-shadow contract-selection self-test passed");
