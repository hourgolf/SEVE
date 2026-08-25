export interface SessionNavSnapshot {
  netLiquidation: number;
  unrealizedPnl: number | null;
  capturedAt: string;
}

export interface SessionNavPositionRow {
  id: string;
  rootPositionId: string;
  status: "open" | "closed";
  realizedPnl: number;
  unrealizedPnl: number;
  openedAt: string | null;
  closedAt: string | null;
}

export interface SessionNavAccountInput {
  accountId: string;
  startingSnapshot: SessionNavSnapshot;
  endingSnapshot: SessionNavSnapshot;
  positionRows: readonly SessionNavPositionRow[];
}

export interface SessionNavAccountReconciliation {
  accountId: string;
  state: "complete" | "stale" | "invalid";
  brokerNavDeltaExact: number;
  realizedAttributionExact: number;
  openUnrealizedAttributionExact: number;
  logicalTradeAttributionExact: number;
  brokerAdjustmentExact: number;
  startingNavExact: number;
  endingNavExact: number;
  startingSnapshotAt: string;
  endingSnapshotAt: string;
  latestPositionEventAt: string | null;
  issues: string[];
}

export interface SessionNavReconciliation {
  state: "complete" | "partial" | "invalid";
  accounts: SessionNavAccountReconciliation[];
  brokerNavDeltaExact: number | null;
  realizedAttributionExact: number | null;
  openUnrealizedAttributionExact: number | null;
  logicalTradeAttributionExact: number | null;
  brokerAdjustmentExact: number | null;
  issues: string[];
  display: {
    brokerNavDelta: number | null;
    logicalTradeAttribution: number | null;
    brokerAdjustment: number | null;
  };
}

const cents = (value: number): number => Math.round(value * 100) / 100;
const validInstant = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function reconcileAccount(input: SessionNavAccountInput): SessionNavAccountReconciliation {
  const issues: string[] = [];
  const startMs = validInstant(input.startingSnapshot.capturedAt);
  const endMs = validInstant(input.endingSnapshot.capturedAt);
  if (startMs == null || endMs == null || endMs < startMs) issues.push("snapshot clock is invalid or reversed");
  if (!Number.isFinite(input.startingSnapshot.netLiquidation) || !Number.isFinite(input.endingSnapshot.netLiquidation)) {
    issues.push("snapshot NAV is not finite");
  }
  const ids = new Set<string>();
  let realized = 0;
  let openUnrealized = 0;
  let latestEventMs: number | null = null;
  for (const row of input.positionRows) {
    if (!row.id || ids.has(row.id)) issues.push(`position identity is missing or duplicated: ${row.id || "unknown"}`);
    ids.add(row.id);
    if (!row.rootPositionId) issues.push(`position ${row.id} lacks logical-trade lineage`);
    const openedMs = validInstant(row.openedAt);
    const closedMs = validInstant(row.closedAt);
    if (row.openedAt && openedMs == null) issues.push(`position ${row.id} has an invalid open clock`);
    if (row.closedAt && closedMs == null) issues.push(`position ${row.id} has an invalid close clock`);
    if (openedMs != null) latestEventMs = Math.max(latestEventMs ?? openedMs, openedMs);
    if (closedMs != null) latestEventMs = Math.max(latestEventMs ?? closedMs, closedMs);
    if (row.status === "closed") {
      if (closedMs == null) issues.push(`closed position ${row.id} lacks a close clock`);
      if (!Number.isFinite(row.realizedPnl)) issues.push(`closed position ${row.id} lacks finite realized attribution`);
      else realized += row.realizedPnl;
    } else {
      if (closedMs != null) issues.push(`open position ${row.id} carries a close clock`);
      if (!Number.isFinite(row.unrealizedPnl)) issues.push(`open position ${row.id} lacks finite unrealized attribution`);
      else openUnrealized += row.unrealizedPnl;
    }
  }
  const brokerDelta = cents(input.endingSnapshot.netLiquidation - input.startingSnapshot.netLiquidation);
  const realizedExact = cents(realized);
  const openExact = cents(openUnrealized);
  const attributed = cents(realizedExact + openExact);
  const adjustment = cents(brokerDelta - attributed);
  const stale = endMs != null && latestEventMs != null && endMs < latestEventMs;
  if (stale) issues.push("ending broker snapshot predates the latest position event");
  const hasOpen = input.positionRows.some((row) => row.status === "open");
  if (!hasOpen && input.endingSnapshot.unrealizedPnl != null
      && Math.abs(input.endingSnapshot.unrealizedPnl) >= 0.005) {
    issues.push("flat desk rows conflict with non-zero broker unrealized P&L");
  }
  return {
    accountId: input.accountId,
    state: issues.some((issue) => !issue.startsWith("ending broker snapshot predates")) ? "invalid" : stale ? "stale" : "complete",
    brokerNavDeltaExact: brokerDelta,
    realizedAttributionExact: realizedExact,
    openUnrealizedAttributionExact: openExact,
    logicalTradeAttributionExact: attributed,
    brokerAdjustmentExact: adjustment,
    startingNavExact: input.startingSnapshot.netLiquidation,
    endingNavExact: input.endingSnapshot.netLiquidation,
    startingSnapshotAt: input.startingSnapshot.capturedAt,
    endingSnapshotAt: input.endingSnapshot.capturedAt,
    latestPositionEventAt: latestEventMs == null ? null : new Date(latestEventMs).toISOString(),
    issues,
  };
}

export function reconcileSessionNav(input: { accounts: readonly SessionNavAccountInput[] }): SessionNavReconciliation {
  const accountIds = new Set<string>();
  const issues: string[] = [];
  for (const account of input.accounts) {
    if (!account.accountId || accountIds.has(account.accountId)) issues.push(`account identity is missing or duplicated: ${account.accountId || "unknown"}`);
    accountIds.add(account.accountId);
  }
  if (!input.accounts.length) issues.push("no account snapshots were supplied");
  const accounts = input.accounts.map(reconcileAccount);
  issues.push(...accounts.flatMap((account) => account.issues.map((issue) => `${account.accountId}: ${issue}`)));
  const complete = accounts.length > 0 && accounts.every((account) => account.state === "complete") && issues.length === 0;
  const invalid = accounts.some((account) => account.state === "invalid") || input.accounts.length === 0
    || new Set(input.accounts.map((account) => account.accountId)).size !== input.accounts.length;
  const sum = (field: keyof Pick<SessionNavAccountReconciliation,
    "brokerNavDeltaExact" | "realizedAttributionExact" | "openUnrealizedAttributionExact" | "logicalTradeAttributionExact" | "brokerAdjustmentExact">): number | null =>
    complete ? cents(accounts.reduce((total, account) => total + account[field], 0)) : null;
  const brokerNavDeltaExact = sum("brokerNavDeltaExact");
  const logicalTradeAttributionExact = sum("logicalTradeAttributionExact");
  const brokerAdjustmentExact = sum("brokerAdjustmentExact");
  return {
    state: complete ? "complete" : invalid ? "invalid" : "partial",
    accounts,
    brokerNavDeltaExact,
    realizedAttributionExact: sum("realizedAttributionExact"),
    openUnrealizedAttributionExact: sum("openUnrealizedAttributionExact"),
    logicalTradeAttributionExact,
    brokerAdjustmentExact,
    issues,
    display: {
      brokerNavDelta: brokerNavDeltaExact == null ? null : Math.round(brokerNavDeltaExact),
      logicalTradeAttribution: logicalTradeAttributionExact == null ? null : Math.round(logicalTradeAttributionExact),
      brokerAdjustment: brokerAdjustmentExact == null ? null : Math.round(brokerAdjustmentExact),
    },
  };
}
