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
