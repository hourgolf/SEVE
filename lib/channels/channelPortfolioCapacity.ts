import type {
  AdmissionPolicySpec,
  ChannelSpecVersion,
} from "./channelControlPlane";

export const CHANNEL_PORTFOLIO_CAPACITY_VERSION =
  "channel-portfolio-capacity-v1" as const;

export interface PortfolioAccountLimit {
  accountId: string;
  equityUsd: number;
  maxConcurrentDebitUsd: number;
  maxConcurrentRiskUsd: number;
  maxDebitPctOfEquity: number;
  maxRiskPctOfEquity: number;
  maxOpenPositions: number;
}

export interface PortfolioUnderlyingLimit {
  underlying: string;
  maxConcurrentDebitUsd: number;
  maxConcurrentRiskUsd: number;
  maxOpenPositions: number;
}

export interface PortfolioCorrelationLimit {
  id: string;
  underlyings: string[];
  maxConcurrentDebitUsd: number;
  maxConcurrentRiskUsd: number;
  maxOpenPositions: number;
}

export interface PortfolioCapacityEnvelope {
  version: typeof CHANNEL_PORTFOLIO_CAPACITY_VERSION;
  paperOnly: true;
  maxContractsPerEntry: number;
  accounts: PortfolioAccountLimit[];
  underlyings: PortfolioUnderlyingLimit[];
  correlationGroups: PortfolioCorrelationLimit[];
}

export interface LivePortfolioPosition {
  accountId: string;
  underlying: string;
  occSymbol: string;
  debitUsd: number;
  riskUsd: number;
}

export interface LivePortfolioTruth {
  complete: boolean;
  observedAt: string;
  openOrders: number;
  positions: LivePortfolioPosition[];
}

export interface CapacityMetric {
  id: string;
  current: number;
  projected: number;
  limit: number;
  state: "pass" | "block";
}

export interface PortfolioCapacityEvaluation {
  version: typeof CHANNEL_PORTFOLIO_CAPACITY_VERSION;
  state: "pass" | "block";
  evaluatedPaperSlugs: string[];
  metrics: CapacityMetric[];
  blockers: string[];
  limitations: string[];
  executionAuthority: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

type ExposureField = "maxDebitUsd" | "maxRiskUsd" | "openPositions";

function specValue(spec: ChannelSpecVersion, field: ExposureField): number {
  if (field === "maxDebitUsd") return spec.maxDebitUsd;
  if (field === "maxRiskUsd") return spec.riskLimits.maxRiskUsd;
  return 1;
}

function liveValue(
  position: LivePortfolioPosition,
  field: ExposureField,
): number {
  if (field === "maxDebitUsd") return position.debitUsd;
  if (field === "maxRiskUsd") return position.riskUsd;
  return 1;
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function domainWorstCase(input: {
  specs: readonly ChannelSpecVersion[];
  policy: AdmissionPolicySpec;
  field: ExposureField;
  include: (spec: ChannelSpecVersion) => boolean;
}): number {
  const candidates = input.specs
    .filter(input.include)
    .sort((left, right) => specValue(right, input.field)
      - specValue(left, input.field));
  let best = 0;
  const families = new Map<string, number>();
  const underlyings = new Map<string, number>();

  const visit = (index: number, selected: number, total: number): void => {
    if (total > best) best = total;
    if (index >= candidates.length
        || selected >= input.policy.maxOpenGlobal) return;
    for (let cursor = index; cursor < candidates.length; cursor++) {
      const spec = candidates[cursor];
      const underlying = spec.symbolScope[0] ?? "";
      const familyCount = families.get(spec.familyId) ?? 0;
      const underlyingCount = underlyings.get(underlying) ?? 0;
      if (familyCount >= input.policy.maxOpenPerFamily
          || underlyingCount
            >= (input.policy.maxOpenByUnderlying[underlying] ?? 0)) continue;
      families.set(spec.familyId, familyCount + 1);
      underlyings.set(underlying, underlyingCount + 1);
      visit(
        cursor + 1,
        selected + 1,
        total + specValue(spec, input.field),
      );
      if (familyCount) families.set(spec.familyId, familyCount);
      else families.delete(spec.familyId);
      if (underlyingCount) underlyings.set(underlying, underlyingCount);
      else underlyings.delete(underlying);
    }
  };
  visit(0, 0, 0);
  return best;
}

function worstCase(input: {
  specs: readonly ChannelSpecVersion[];
  policies: readonly AdmissionPolicySpec[];
  field: ExposureField;
  include: (spec: ChannelSpecVersion) => boolean;
}): number {
  const byDomain = new Map<string, ChannelSpecVersion[]>();
  for (const spec of input.specs) {
    const rows = byDomain.get(spec.collisionDomain) ?? [];
    rows.push(spec);
    byDomain.set(spec.collisionDomain, rows);
  }
  const policyById = new Map(input.policies.map((policy) => [policy.id, policy]));
  let total = 0;
  for (const [domain, specs] of byDomain) {
    const policy = policyById.get(domain);
    if (!policy) continue;
    total += domainWorstCase({ ...input, specs, policy });
  }
  return total;
}

function boundedAccountLimit(
  absolute: number,
  equity: number,
  fraction: number,
): number {
  return Math.min(absolute, equity * fraction);
}

export function evaluatePortfolioCapacity(input: {
  specs: readonly ChannelSpecVersion[];
  admissionPolicies: readonly AdmissionPolicySpec[];
  envelope: PortfolioCapacityEnvelope;
  live: LivePortfolioTruth;
}): PortfolioCapacityEvaluation {
  const blockers: string[] = [];
  const metrics: CapacityMetric[] = [];
  const paperSpecs = input.specs.filter((spec) =>
    (spec.executionPosture ?? "paper") === "paper");
  const policyIds = new Set(input.admissionPolicies.map((policy) => policy.id));
  const accountLimits = new Map(input.envelope.accounts.map((limit) =>
    [limit.accountId, limit]));
  const underlyingLimits = new Map(input.envelope.underlyings.map((limit) =>
    [limit.underlying, limit]));
  const correlationMembership = new Map<string, string[]>();
  for (const group of input.envelope.correlationGroups) {
    for (const underlying of group.underlyings) {
      const memberships = correlationMembership.get(underlying) ?? [];
      memberships.push(group.id);
      correlationMembership.set(underlying, memberships);
    }
  }

  if (input.envelope.version !== CHANNEL_PORTFOLIO_CAPACITY_VERSION
      || input.envelope.paperOnly !== true) {
    blockers.push("capacity:envelope_invalid");
  }
  if (!input.live.complete
      || !Number.isFinite(Date.parse(input.live.observedAt))) {
    blockers.push("capacity:live_truth_incomplete");
  }
  if (!Number.isInteger(input.live.openOrders) || input.live.openOrders < 0) {
    blockers.push("capacity:open_orders_unknown");
  } else if (input.live.openOrders > 0) {
    blockers.push("capacity:open_orders_present");
  }
  if (!Number.isInteger(input.envelope.maxContractsPerEntry)
      || input.envelope.maxContractsPerEntry < 1) {
    blockers.push("capacity:max_contracts_invalid");
  }

  for (const spec of paperSpecs) {
    if (spec.accountMode !== "paper") blockers.push(`capacity:not_paper:${spec.slug}`);
    if (!accountLimits.has(spec.accountId)) {
      blockers.push(`capacity:account_limit_missing:${spec.slug}`);
    }
    const underlying = spec.symbolScope[0] ?? "";
    if (!underlyingLimits.has(underlying)) {
      blockers.push(`capacity:underlying_limit_missing:${spec.slug}`);
    }
    if (!correlationMembership.has(underlying)) {
      blockers.push(`capacity:correlation_group_missing:${spec.slug}`);
    }
    if (!policyIds.has(spec.collisionDomain)) {
      blockers.push(`capacity:collision_policy_missing:${spec.slug}`);
    }
    if (spec.quantity > input.envelope.maxContractsPerEntry) {
      blockers.push(`capacity:contract_limit:${spec.slug}`);
    }
    if (!finiteNonnegative(spec.maxDebitUsd)
        || !finiteNonnegative(spec.riskLimits.maxRiskUsd)
        || spec.riskLimits.maxRiskUsd > spec.maxDebitUsd) {
      blockers.push(`capacity:risk_projection_invalid:${spec.slug}`);
    }
  }
  for (const position of input.live.positions) {
    if (!accountLimits.has(position.accountId)) {
      blockers.push(`capacity:live_account_limit_missing:${position.accountId}`);
    }
    if (!underlyingLimits.has(position.underlying)) {
      blockers.push(`capacity:live_underlying_limit_missing:${position.underlying}`);
    }
    if (![position.debitUsd, position.riskUsd].every(finiteNonnegative)) {
      blockers.push(`capacity:live_position_invalid:${position.occSymbol}`);
    }
  }

  const addMetric = (
    id: string,
    current: number,
    projectedNew: number,
    limit: number,
  ): void => {
    const projected = current + projectedNew;
    const state = finiteNonnegative(limit) && projected <= limit + 1e-9
      ? "pass" as const
      : "block" as const;
    metrics.push({ id, current, projected, limit, state });
    if (state === "block") blockers.push(`capacity:limit:${id}`);
  };

  for (const limit of input.envelope.accounts) {
    const live = input.live.positions.filter((position) =>
      position.accountId === limit.accountId);
    const include = (spec: ChannelSpecVersion): boolean =>
      spec.accountId === limit.accountId;
    addMetric(
      `account:${limit.accountId}:debit`,
      live.reduce((sum, position) => sum + position.debitUsd, 0),
      worstCase({
        specs: paperSpecs,
        policies: input.admissionPolicies,
        field: "maxDebitUsd",
        include,
      }),
      boundedAccountLimit(
        limit.maxConcurrentDebitUsd,
        limit.equityUsd,
        limit.maxDebitPctOfEquity,
      ),
    );
    addMetric(
      `account:${limit.accountId}:risk`,
      live.reduce((sum, position) => sum + position.riskUsd, 0),
      worstCase({
        specs: paperSpecs,
        policies: input.admissionPolicies,
        field: "maxRiskUsd",
        include,
      }),
      boundedAccountLimit(
        limit.maxConcurrentRiskUsd,
        limit.equityUsd,
        limit.maxRiskPctOfEquity,
      ),
    );
    addMetric(
      `account:${limit.accountId}:positions`,
      live.length,
      worstCase({
        specs: paperSpecs,
        policies: input.admissionPolicies,
        field: "openPositions",
        include,
      }),
      limit.maxOpenPositions,
    );
  }

  for (const limit of input.envelope.underlyings) {
    const live = input.live.positions.filter((position) =>
      position.underlying === limit.underlying);
    const include = (spec: ChannelSpecVersion): boolean =>
      spec.symbolScope[0] === limit.underlying;
    for (const [field, metric, ceiling] of [
      ["maxDebitUsd", "debit", limit.maxConcurrentDebitUsd],
      ["maxRiskUsd", "risk", limit.maxConcurrentRiskUsd],
      ["openPositions", "positions", limit.maxOpenPositions],
    ] as const) {
      addMetric(
        `underlying:${limit.underlying}:${metric}`,
        live.reduce((sum, position) =>
          sum + liveValue(position, field), 0),
        worstCase({
          specs: paperSpecs,
          policies: input.admissionPolicies,
          field,
          include,
        }),
        ceiling,
      );
    }
  }

  for (const limit of input.envelope.correlationGroups) {
    const members = new Set(limit.underlyings);
    const live = input.live.positions.filter((position) =>
      members.has(position.underlying));
    const include = (spec: ChannelSpecVersion): boolean =>
      members.has(spec.symbolScope[0] ?? "");
    for (const [field, metric, ceiling] of [
      ["maxDebitUsd", "debit", limit.maxConcurrentDebitUsd],
      ["maxRiskUsd", "risk", limit.maxConcurrentRiskUsd],
      ["openPositions", "positions", limit.maxOpenPositions],
    ] as const) {
      addMetric(
        `correlation:${limit.id}:${metric}`,
        live.reduce((sum, position) =>
          sum + liveValue(position, field), 0),
        worstCase({
          specs: paperSpecs,
          policies: input.admissionPolicies,
          field,
          include,
        }),
        ceiling,
      );
    }
  }

  const deduped = unique(blockers);
  return Object.freeze({
    version: CHANNEL_PORTFOLIO_CAPACITY_VERSION,
    state: deduped.length ? "block" : "pass",
    evaluatedPaperSlugs: paperSpecs.map((spec) => spec.slug).sort(),
    metrics: metrics.sort((left, right) => left.id.localeCompare(right.id)),
    blockers: deduped,
    limitations: [
      "Configured exposure is the worst concurrent set allowed by each admission domain; it is not an efficacy forecast.",
      "Exact option-contract collision remains an entry-time broker and OCC check.",
      "A passing preview grants no activation or order authority.",
    ],
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
