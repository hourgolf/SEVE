export interface PositionLineageRow {
  id: string;
  runner_of?: string | null;
  status?: "open" | "closed";
  realized_pnl?: number | string | null;
  close_reason?: string | null;
}

export interface LogicalTradeGroup<T extends PositionLineageRow> {
  rootPositionId: string;
  rows: T[];
  status: "open" | "closed";
  realizedPnl: number | null;
  manualClose: boolean;
}

export interface LogicalTradeCohort<T extends PositionLineageRow> {
  groups: LogicalTradeGroup<T>[];
  opened: number;
  closed: number;
  open: number;
  positionRows: number;
  realizedPnl: number | null;
  manualCloses: number;
  issues: string[];
}

/**
 * Collapse durable runner/remainder rows into their entry-time logical trade.
 *
 * Position rows remain the source of tranche P&L and exit evidence; this helper
 * only supplies a truthful trade denominator. Missing parents fail closed by
 * default. A bounded UI window may allow an external parent so an already-open
 * runner can remain visible without inventing a second trade.
 */
export function summarizeLogicalTradeCohort<T extends PositionLineageRow>(
  rows: readonly T[],
  options: { allowExternalParents?: boolean } = {},
): LogicalTradeCohort<T> {
  const issues: string[] = [];
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!row.id) {
      issues.push("position row is missing an id");
      continue;
    }
    if (byId.has(row.id)) {
      issues.push(`duplicate position row ${row.id}`);
      continue;
    }
    byId.set(row.id, row);
  }

  const rootCache = new Map<string, string>();
  const rootOf = (positionId: string): string => {
    const cached = rootCache.get(positionId);
    if (cached) return cached;
    const seen = new Set<string>();
    let current = positionId;
    while (true) {
      if (seen.has(current)) {
        issues.push(`position lineage cycle includes ${current}`);
        rootCache.set(positionId, positionId);
        return positionId;
      }
      seen.add(current);
      const row = byId.get(current);
      const parent = row?.runner_of ?? null;
      if (!parent) {
        rootCache.set(positionId, current);
        return current;
      }
      if (!byId.has(parent)) {
        if (!options.allowExternalParents) {
          issues.push(`position ${current} references missing runner parent ${parent}`);
        }
        rootCache.set(positionId, parent);
        return parent;
      }
      current = parent;
    }
  };

  const grouped = new Map<string, T[]>();
  for (const row of byId.values()) {
    const root = rootOf(row.id);
    grouped.set(root, [...(grouped.get(root) ?? []), row]);
  }

  const groups = [...grouped.entries()]
    .map(([rootPositionId, groupRows]): LogicalTradeGroup<T> => {
      const sortedRows = [...groupRows].sort((left, right) => left.id.localeCompare(right.id));
      const status = sortedRows.every((row) => row.status === "closed") ? "closed" : "open";
      const realizedValues = sortedRows.map((row) => {
        if (row.realized_pnl == null) return null;
        const value = Number(row.realized_pnl);
        return Number.isFinite(value) ? value : null;
      });
      const realizedPnl = status === "closed" && realizedValues.every((value) => value != null)
        ? Math.round(realizedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100
        : null;
      return {
        rootPositionId,
        rows: sortedRows,
        status,
        realizedPnl,
        manualClose: sortedRows.some((row) => /manual|operator/i.test(row.close_reason ?? "")),
      };
    })
    .sort((left, right) => left.rootPositionId.localeCompare(right.rootPositionId));

  const closedGroups = groups.filter((group) => group.status === "closed");
  const realizedPnl = closedGroups.every((group) => group.realizedPnl != null)
    ? Math.round(closedGroups.reduce((sum, group) => sum + (group.realizedPnl ?? 0), 0) * 100) / 100
    : null;

  return {
    groups,
    opened: groups.length,
    closed: closedGroups.length,
    open: groups.length - closedGroups.length,
    positionRows: byId.size,
    realizedPnl,
    manualCloses: closedGroups.filter((group) => group.manualClose).length,
    issues: [...new Set(issues)].sort(),
  };
}
