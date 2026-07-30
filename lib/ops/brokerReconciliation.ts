export interface BrokerPositionInput {
  symbol: string;
  qty: number;
  averageEntryPrice?: number | null;
  currentPrice?: number | null;
  unrealizedPnl?: number | null;
}

export interface DeskPositionInput {
  symbol: string;
  qty: number;
}

export interface BrokerAccountInput {
  accountId: string;
  accountName: string;
  reachable: boolean;
  error?: string;
  brokerPositions: BrokerPositionInput[];
  deskPositions: DeskPositionInput[];
}

export interface BrokerPositionMismatch {
  accountId: string;
  accountName: string;
  symbol: string;
  brokerQty: number;
  deskQty: number;
  delta: number;
}

export interface BrokerAccountReceipt {
  accountId: string;
  accountName: string;
  reachable: boolean;
  error: string;
  brokerContracts: number;
  deskContracts: number;
  mismatchCount: number;
  brokerPositions: BrokerPositionInput[];
}

export interface BrokerReconciliationReceipt {
  state: "matched" | "drift" | "partial";
  observedAt: string;
  allAccountsReachable: boolean;
  booksMatch: boolean;
  flatConfirmed: boolean;
  brokerContracts: number;
  deskContracts: number;
  accounts: BrokerAccountReceipt[];
  mismatches: BrokerPositionMismatch[];
}

export interface ExecutionAccountObservation {
  id: string;
  position_id: string | null;
  account_id: string | null;
  event_at: string;
}

export interface ImmutableExecutionAttribution<T extends { id: string }> {
  byAccount: Map<string, T[]>;
  missingPositionIds: string[];
  unconfiguredRoutes: Array<{ positionId: string; accountId: string }>;
  issues: string[];
  ok: boolean;
}

export interface LatestImmutableExecutionAccountRoute {
  accountId: string;
  eventMs: number;
  observationId: string;
}

export interface PositionOutcomeOpportunityRoute {
  id: string;
  position_id: string;
  opportunity_id: string | null;
  event_at: string;
}

export interface OpportunityExecutionAccountObservation {
  id: string;
  opportunity_id: string | null;
  account_id: string | null;
  event_at: string;
  event_kind: string;
  action: string;
  filled_qty: number | null;
}

export interface ImmutableOpportunityAccountRecovery<T extends { id: string }> {
  byAccount: Map<string, T[]>;
  recoveredPositionIds: string[];
  issues: string[];
  ok: boolean;
}

/**
 * Shared deterministic reducer for immutable execution-account observations.
 * Callers decide whether a missing route is a blocker or may use another
 * immutable identity (for example, a persisted opportunity id).
 */
export function latestImmutableExecutionAccountRoutes(
  observations: readonly ExecutionAccountObservation[],
  requestedPositionIds?: ReadonlySet<string>,
): Map<string, LatestImmutableExecutionAccountRoute> {
  const latest = new Map<string, LatestImmutableExecutionAccountRoute>();
  for (const observation of observations) {
    const positionId = observation.position_id?.trim() ?? "";
    const accountId = observation.account_id?.trim() ?? "";
    const observationId = observation.id?.trim() ?? "";
    const eventMs = Date.parse(observation.event_at);
    if (!positionId || !accountId || !observationId || !Number.isFinite(eventMs)
      || (requestedPositionIds && !requestedPositionIds.has(positionId))) continue;
    const current = latest.get(positionId);
    if (!current
      || eventMs > current.eventMs
      || (eventMs === current.eventMs && observationId.localeCompare(current.observationId) > 0)) {
      latest.set(positionId, { accountId, eventMs, observationId });
    }
  }
  return latest;
}

/**
 * Pure, fail-closed attribution of open desk rows to their immutable execution
 * accounts. Mutable strategist/channel assignments are deliberately not an
 * input. For duplicate observations, event time wins and observation id is the
 * deterministic tie-breaker.
 */
export function attributePositionsByImmutableExecutionAccount<T extends { id: string }>(input: {
  positions: readonly T[];
  observations: readonly ExecutionAccountObservation[];
  configuredPaperAccountIds: ReadonlySet<string>;
  readError?: string | null;
  /** Human-readable scope for fail-closed evidence messages. */
  positionLabel?: string;
}): ImmutableExecutionAttribution<T> {
  const byAccount = new Map<string, T[]>();
  const missingPositionIds: string[] = [];
  const unconfiguredRoutes: Array<{ positionId: string; accountId: string }> = [];
  const issues: string[] = [];
  const requestedPositionIds = new Set(input.positions.map((position) => position.id));

  if (input.readError) {
    issues.push(`execution-route evidence unavailable: ${input.readError}`);
    missingPositionIds.push(...input.positions.map((position) => position.id));
    return { byAccount, missingPositionIds, unconfiguredRoutes, issues, ok: false };
  }

  const latest = latestImmutableExecutionAccountRoutes(
    input.observations,
    requestedPositionIds,
  );

  for (const position of input.positions) {
    const route = latest.get(position.id);
    if (!route) {
      missingPositionIds.push(position.id);
      continue;
    }
    if (!input.configuredPaperAccountIds.has(route.accountId)) {
      unconfiguredRoutes.push({ positionId: position.id, accountId: route.accountId });
      continue;
    }
    const rows = byAccount.get(route.accountId) ?? [];
    rows.push(position);
    byAccount.set(route.accountId, rows);
  }

  if (missingPositionIds.length) {
    issues.push(`${input.positionLabel ?? "open desk positions"} lack immutable execution-account routing: ${missingPositionIds.join(",")}`);
  }
  if (unconfiguredRoutes.length) {
    issues.push(`immutable execution-account routes are not configured paper accounts: ${
      unconfiguredRoutes.map((route) => `${route.positionId}->${route.accountId}`).join(",")
    }`);
  }
  return {
    byAccount,
    missingPositionIds,
    unconfiguredRoutes,
    issues,
    ok: issues.length === 0,
  };
}

/**
 * Display-only recovery for legacy rows created before post-insert position
 * route receipts existed. It requires an exact position→outcome→opportunity
 * join and exactly one immutable filled-entry account for that opportunity.
 * Formal broker reconciliation and readiness deliberately do not call this:
 * they continue to require a position_id-bound execution observation.
 */
export function recoverPositionsByImmutableOpportunityAccountForDisplay<T extends { id: string }>(input: {
  positions: readonly T[];
  outcomes: readonly PositionOutcomeOpportunityRoute[];
  observations: readonly OpportunityExecutionAccountObservation[];
  configuredPaperAccountIds: ReadonlySet<string>;
  readError?: string | null;
}): ImmutableOpportunityAccountRecovery<T> {
  const byAccount = new Map<string, T[]>();
  const recoveredPositionIds: string[] = [];
  const issues: string[] = [];
  if (input.readError) {
    return {
      byAccount,
      recoveredPositionIds,
      issues: [`legacy immutable route evidence unavailable: ${input.readError}`],
      ok: false,
    };
  }

  const requested = new Set(input.positions.map((position) => position.id));
  const opportunityByPosition = new Map<string, {
    opportunityId: string;
    eventMs: number;
    outcomeId: string;
  }>();
  for (const outcome of input.outcomes) {
    const positionId = outcome.position_id?.trim() ?? "";
    const opportunityId = outcome.opportunity_id?.trim() ?? "";
    const outcomeId = outcome.id?.trim() ?? "";
    const eventMs = Date.parse(outcome.event_at);
    if (!requested.has(positionId) || !opportunityId || !outcomeId || !Number.isFinite(eventMs)) continue;
    const current = opportunityByPosition.get(positionId);
    if (!current || eventMs > current.eventMs
      || (eventMs === current.eventMs && outcomeId.localeCompare(current.outcomeId) > 0)) {
      opportunityByPosition.set(positionId, { opportunityId, eventMs, outcomeId });
    }
  }

  const accountsByOpportunity = new Map<string, Set<string>>();
  for (const observation of input.observations) {
    const opportunityId = observation.opportunity_id?.trim() ?? "";
    const accountId = observation.account_id?.trim() ?? "";
    if (!opportunityId || !accountId || observation.event_kind !== "broker_result"
      || observation.action !== "enter" || !(Number(observation.filled_qty) > 0)
      || !Number.isFinite(Date.parse(observation.event_at))) continue;
    const accounts = accountsByOpportunity.get(opportunityId) ?? new Set<string>();
    accounts.add(accountId);
    accountsByOpportunity.set(opportunityId, accounts);
  }

  for (const position of input.positions) {
    const route = opportunityByPosition.get(position.id);
    if (!route) {
      issues.push(`${position.id} lacks an immutable position outcome opportunity`);
      continue;
    }
    const accounts = [...(accountsByOpportunity.get(route.opportunityId) ?? [])].sort();
    if (accounts.length !== 1) {
      issues.push(`${position.id} has ${accounts.length || "no"} immutable filled-entry account routes`);
      continue;
    }
    const accountId = accounts[0];
    if (!input.configuredPaperAccountIds.has(accountId)) {
      issues.push(`${position.id} recovered to non-paper or unconfigured account ${accountId}`);
      continue;
    }
    const rows = byAccount.get(accountId) ?? [];
    rows.push(position);
    byAccount.set(accountId, rows);
    recoveredPositionIds.push(position.id);
  }

  return { byAccount, recoveredPositionIds, issues, ok: issues.length === 0 };
}

const finiteQty = (value: number): number => Number.isFinite(value) ? Math.round(value) : 0;
const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const aggregate = <T>(rows: T[], symbolOf: (row: T) => string, qtyOf: (row: T) => number): Map<string, number> => {
  const result = new Map<string, number>();
  for (const row of rows) {
    const symbol = symbolOf(row).trim().toUpperCase();
    if (!symbol) continue;
    result.set(symbol, (result.get(symbol) ?? 0) + finiteQty(qtyOf(row)));
  }
  return result;
};

/**
 * Pure current-book reconciliation. It compares every broker position against
 * the desk rows attributed to the same paper account. A missing account read is
 * partial observability, never evidence that the broker is flat.
 */
export function reconcileBrokerPositions(
  inputs: BrokerAccountInput[],
  observedAt = new Date().toISOString(),
): BrokerReconciliationReceipt {
  const mismatches: BrokerPositionMismatch[] = [];
  const accounts: BrokerAccountReceipt[] = [];
  let brokerContracts = 0;
  let deskContracts = 0;

  for (const account of inputs) {
    const broker = aggregate(account.brokerPositions, (row) => row.symbol, (row) => row.qty);
    const desk = aggregate(account.deskPositions, (row) => row.symbol, (row) => row.qty);
    const symbols = new Set([...broker.keys(), ...desk.keys()]);
    let mismatchCount = 0;
    let accountBroker = 0;
    let accountDesk = 0;
    for (const qty of broker.values()) accountBroker += Math.abs(qty);
    for (const qty of desk.values()) accountDesk += Math.abs(qty);
    brokerContracts += accountBroker;
    deskContracts += accountDesk;
    if (account.reachable) {
      for (const symbol of symbols) {
        const brokerQty = broker.get(symbol) ?? 0;
        const deskQty = desk.get(symbol) ?? 0;
        if (brokerQty === deskQty) continue;
        mismatchCount += 1;
        mismatches.push({
          accountId: account.accountId,
          accountName: account.accountName,
          symbol,
          brokerQty,
          deskQty,
          delta: deskQty - brokerQty,
        });
      }
    }
    accounts.push({
      accountId: account.accountId,
      accountName: account.accountName,
      reachable: account.reachable,
      error: account.error ?? "",
      brokerContracts: accountBroker,
      deskContracts: accountDesk,
      mismatchCount,
      brokerPositions: account.brokerPositions
        .map((position) => ({
          symbol: position.symbol.trim().toUpperCase(),
          qty: finiteQty(position.qty),
          averageEntryPrice: finiteOrNull(position.averageEntryPrice),
          currentPrice: finiteOrNull(position.currentPrice),
          unrealizedPnl: finiteOrNull(position.unrealizedPnl),
        }))
        .filter((position) => position.symbol && position.qty !== 0)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    });
  }

  const allAccountsReachable = inputs.length > 0 && inputs.every((account) => account.reachable);
  const booksMatch = allAccountsReachable && mismatches.length === 0;
  const flatConfirmed = booksMatch && brokerContracts === 0 && deskContracts === 0;
  return {
    state: !allAccountsReachable ? "partial" : mismatches.length ? "drift" : "matched",
    observedAt,
    allAccountsReachable,
    booksMatch,
    flatConfirmed,
    brokerContracts,
    deskContracts,
    accounts,
    mismatches,
  };
}
