import assert from "node:assert/strict";
import {
  buildOperatorPaperCapacityEnvelope,
  OPERATOR_PAPER_CAPACITY_LIMITS,
  OPERATOR_PAPER_CAPACITY_POLICY_VERSION,
} from "./channelPortfolioCapacityPolicy.js";

const envelope = buildOperatorPaperCapacityEnvelope({
  accounts: [
    { accountId: "paper-2", equityUsd: 80_000 },
    { accountId: "paper-1", equityUsd: 100_000 },
  ],
  underlyings: ["SPY", "QQQ", "SPY"],
});
assert.equal(OPERATOR_PAPER_CAPACITY_POLICY_VERSION, "operator-paper-capacity-policy-v1");
assert.equal(envelope.paperOnly, true);
assert.equal(envelope.maxContractsPerEntry, 12);
assert.equal(envelope.accounts[0].accountId, "paper-1");
assert.equal(envelope.accounts[0].maxConcurrentDebitUsd, 5_000);
assert.equal(envelope.accounts[0].maxConcurrentRiskUsd, 2_000);
assert.equal(envelope.underlyings.length, 2);
assert.equal(envelope.underlyings[0].maxConcurrentDebitUsd, 7_200);
assert.equal(envelope.correlationGroups[0].maxConcurrentDebitUsd, 9_000);
assert.equal(OPERATOR_PAPER_CAPACITY_LIMITS.maxCorrelatedOpenPositions, 8);
assert.throws(() => buildOperatorPaperCapacityEnvelope({
  accounts: [{ accountId: "paper-1", equityUsd: 0 }],
  underlyings: ["SPY"],
}), /exact account equity/);

console.log("channel-portfolio-capacity-policy-selftest: 8/8 passed");
