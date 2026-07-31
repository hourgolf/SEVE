import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import {
  CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  evaluatePortfolioCapacity,
  type LivePortfolioTruth,
  type PortfolioCapacityEnvelope,
} from "./channelPortfolioCapacity.js";
import {
  RC54_CONTROL_PLANE_FIXTURE,
} from "./rc54ControlPlaneFixture.js";

let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

const PAPER_1 = "cd817549-e025-4d38-805e-d32e607052f7";
const PAPER_2 = "995aa327-b0da-4050-bede-97ab462b06cd";
const PAPER_3 = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const compiled = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

function envelope(): PortfolioCapacityEnvelope {
  return {
    version: CHANNEL_PORTFOLIO_CAPACITY_VERSION,
    paperOnly: true,
    maxContractsPerEntry: 12,
    accounts: [PAPER_1, PAPER_2, PAPER_3].map((accountId) => ({
      accountId,
      equityUsd: 100_000,
      maxConcurrentDebitUsd: 5_000,
      maxConcurrentRiskUsd: 2_000,
      maxDebitPctOfEquity: 0.05,
      maxRiskPctOfEquity: 0.02,
      maxOpenPositions: 6,
    })),
    underlyings: ["SPY", "QQQ", "IWM"].map((underlying) => ({
      underlying,
      maxConcurrentDebitUsd: 4_000,
      maxConcurrentRiskUsd: 1_500,
      maxOpenPositions: 4,
    })),
    correlationGroups: [{
      id: "US-INDEX-LONG-PREMIUM",
      underlyings: ["SPY", "QQQ", "IWM"],
      maxConcurrentDebitUsd: 5_000,
      maxConcurrentRiskUsd: 2_000,
      maxOpenPositions: 6,
    }],
  };
}

function flat(): LivePortfolioTruth {
  return {
    complete: true,
    observedAt: "2026-07-31T14:00:00.000Z",
    openOrders: 0,
    positions: [],
  };
}

check("sealed nine-root roster fits a declared portfolio envelope", () => {
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: envelope(),
    live: flat(),
  });
  assert.equal(result.state, "pass");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evaluatedPaperSlugs.length, 9);
  assert.equal(result.orderAuthority, false);
});

check("worst-case exposure respects domain concurrency instead of summing every root", () => {
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: envelope(),
    live: flat(),
  });
  const paper1Debit = result.metrics.find((metric) =>
    metric.id === `account:${PAPER_1}:debit`);
  assert.equal(paper1Debit?.projected, 2_000);
});

check("account budget overrun blocks even when per-channel limits are valid", () => {
  const constrained = envelope();
  constrained.accounts[0].maxConcurrentDebitUsd = 1_000;
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: constrained,
    live: flat(),
  });
  assert.equal(result.state, "block");
  assert.ok(result.blockers.includes(
    `capacity:limit:account:${PAPER_1}:debit`,
  ));
});

check("NAV percentage ceiling is binding when tighter than the absolute ceiling", () => {
  const constrained = envelope();
  constrained.accounts[0].equityUsd = 10_000;
  constrained.accounts[0].maxDebitPctOfEquity = 0.05;
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: constrained,
    live: flat(),
  });
  const metric = result.metrics.find((candidate) =>
    candidate.id === `account:${PAPER_1}:debit`);
  assert.equal(metric?.limit, 500);
  assert.equal(metric?.state, "block");
});

check("oversized entry blocks independently of dollar capacity", () => {
  const oversized = compiled.channelSpecs.map((spec) => spec.slug === "pb-ride"
    ? {
      ...spec,
      quantity: 13,
      riskLimits: { ...spec.riskLimits, maxContracts: 13 },
    }
    : spec);
  const result = evaluatePortfolioCapacity({
    specs: oversized,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: envelope(),
    live: flat(),
  });
  assert.ok(result.blockers.includes("capacity:contract_limit:pb-ride"));
});

check("unknown or active orders fail closed", () => {
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: envelope(),
    live: { ...flat(), complete: false, openOrders: 1 },
  });
  assert.ok(result.blockers.includes("capacity:live_truth_incomplete"));
  assert.ok(result.blockers.includes("capacity:open_orders_present"));
});

check("live positions consume the same account, underlying, and correlation limits", () => {
  const live = flat();
  live.positions = [{
    accountId: PAPER_1,
    underlying: "SPY",
    occSymbol: "SPY260731C00640000",
    debitUsd: 600,
    riskUsd: 180,
  }];
  const result = evaluatePortfolioCapacity({
    specs: compiled.channelSpecs,
    admissionPolicies: compiled.manifest.admissionPolicies,
    envelope: envelope(),
    live,
  });
  assert.equal(result.metrics.find((metric) =>
    metric.id === `account:${PAPER_1}:debit`)?.projected, 2_600);
  assert.equal(result.metrics.find((metric) =>
    metric.id === "underlying:SPY:debit")?.current, 600);
});

console.log(`channel-portfolio-capacity selftest: ${checks} checks passed`);
