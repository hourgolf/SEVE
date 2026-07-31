import {
  CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  type PortfolioCapacityEnvelope,
} from "./channelPortfolioCapacity";

export const OPERATOR_PAPER_CAPACITY_POLICY_VERSION =
  "operator-paper-capacity-policy-v1" as const;

export const OPERATOR_PAPER_CAPACITY_LIMITS = Object.freeze({
  maxContractsPerEntry: 12,
  maxAccountDebitPctOfEquity: 0.05,
  maxAccountRiskPctOfEquity: 0.02,
  maxAccountOpenPositions: 6,
  maxUnderlyingDebitPctOfFleetEquity: 0.04,
  maxUnderlyingRiskPctOfFleetEquity: 0.015,
  maxUnderlyingOpenPositions: 6,
  maxCorrelatedDebitPctOfFleetEquity: 0.05,
  maxCorrelatedRiskPctOfFleetEquity: 0.02,
  maxCorrelatedOpenPositions: 8,
});

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildOperatorPaperCapacityEnvelope(input: {
  accounts: Array<{ accountId: string; equityUsd: number }>;
  underlyings: string[];
}): PortfolioCapacityEnvelope {
  const accounts = [...input.accounts]
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
  const underlyings = [...new Set(input.underlyings)].sort();
  if (!accounts.length
      || new Set(accounts.map((account) => account.accountId)).size
        !== accounts.length
      || accounts.some((account) => !account.accountId.trim()
        || !Number.isFinite(account.equityUsd)
        || account.equityUsd <= 0)
      || !underlyings.length
      || underlyings.some((underlying) => !/^[A-Z]{1,8}$/.test(underlying))) {
    throw new Error("paper capacity policy requires exact account equity and underlyings");
  }
  const fleetEquity = accounts.reduce(
    (total, account) => total + account.equityUsd,
    0,
  );
  return Object.freeze({
    version: CHANNEL_PORTFOLIO_CAPACITY_VERSION,
    paperOnly: true,
    maxContractsPerEntry:
      OPERATOR_PAPER_CAPACITY_LIMITS.maxContractsPerEntry,
    accounts: accounts.map((account) => ({
      accountId: account.accountId,
      equityUsd: money(account.equityUsd),
      maxConcurrentDebitUsd: money(
        account.equityUsd
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxAccountDebitPctOfEquity,
      ),
      maxConcurrentRiskUsd: money(
        account.equityUsd
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxAccountRiskPctOfEquity,
      ),
      maxDebitPctOfEquity:
        OPERATOR_PAPER_CAPACITY_LIMITS.maxAccountDebitPctOfEquity,
      maxRiskPctOfEquity:
        OPERATOR_PAPER_CAPACITY_LIMITS.maxAccountRiskPctOfEquity,
      maxOpenPositions:
        OPERATOR_PAPER_CAPACITY_LIMITS.maxAccountOpenPositions,
    })),
    underlyings: underlyings.map((underlying) => ({
      underlying,
      maxConcurrentDebitUsd: money(
        fleetEquity
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxUnderlyingDebitPctOfFleetEquity,
      ),
      maxConcurrentRiskUsd: money(
        fleetEquity
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxUnderlyingRiskPctOfFleetEquity,
      ),
      maxOpenPositions:
        OPERATOR_PAPER_CAPACITY_LIMITS.maxUnderlyingOpenPositions,
    })),
    correlationGroups: [{
      id: "US-INDEX-LONG-PREMIUM",
      underlyings,
      maxConcurrentDebitUsd: money(
        fleetEquity
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxCorrelatedDebitPctOfFleetEquity,
      ),
      maxConcurrentRiskUsd: money(
        fleetEquity
          * OPERATOR_PAPER_CAPACITY_LIMITS.maxCorrelatedRiskPctOfFleetEquity,
      ),
      maxOpenPositions:
        OPERATOR_PAPER_CAPACITY_LIMITS.maxCorrelatedOpenPositions,
    }],
  });
}
