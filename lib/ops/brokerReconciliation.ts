export interface BrokerPositionInput {
  symbol: string;
  qty: number;
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
  const latest = new Map<string, { accountId: string; eventMs: number; observationId: string }>();

  if (input.readError) {
    issues.push(`execution-route evidence unavailable: ${input.readError}`);
    missingPositionIds.push(...input.positions.map((position) => position.id));
    return { byAccount, missingPositionIds, unconfiguredRoutes, issues, ok: false };
  }

  for (const observation of input.observations) {
    const positionId = observation.position_id?.trim() ?? "";
    const accountId = observation.account_id?.trim() ?? "";
    const observationId = observation.id?.trim() ?? "";
    const eventMs = Date.parse(observation.event_at);
    if (!positionId || !accountId || !observationId || !Number.isFinite(eventMs)
      || !requestedPositionIds.has(positionId)) continue;
    const current = latest.get(positionId);
    if (!current
      || eventMs > current.eventMs
      || (eventMs === current.eventMs && observationId.localeCompare(current.observationId) > 0)) {
      latest.set(positionId, { accountId, eventMs, observationId });
    }
  }

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

const finiteQty = (value: number): number => Number.isFinite(value) ? Math.round(value) : 0;

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
