export interface DailyDigestPositionRow {
  id: string;
  strategist_id: string;
  runner_of: string | null;
  status: string;
  closed_at: string | null;
  realized_pnl: number | string | null;
  configuration_epoch_id: string | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  [key: string]: unknown;
}

export interface DailyDigestRouteRow {
  id: string;
  position_id: string | null;
  account_id: string | null;
  event_at: string;
}

export interface DailyLogicalTradeGroup<T extends DailyDigestPositionRow> {
  rootPositionId: string;
  root: T;
  rows: T[];
  accountId: string;
  configurationEpochId: string;
  channelSpecVersionId: string;
  releaseManifestId: string;
  realizedPnl: number;
  terminalAt: string;
}

export interface DailyLogicalTradeResult<T extends DailyDigestPositionRow> {
  groups: DailyLogicalTradeGroup<T>[];
  issues: string[];
  positionRows: number;
  runnerRows: number;
}

const latestRoutes = (routes: readonly DailyDigestRouteRow[]): Map<string, DailyDigestRouteRow> => {
  const latest = new Map<string, DailyDigestRouteRow>();
  for (const route of routes) {
    if (!route.position_id || !route.account_id || !Number.isFinite(Date.parse(route.event_at))) continue;
    const current = latest.get(route.position_id);
    if (!current || Date.parse(route.event_at) > Date.parse(current.event_at)
      || (route.event_at === current.event_at && route.id.localeCompare(current.id) > 0)) latest.set(route.position_id, route);
  }
  return latest;
};

/** Pure fail-closed reducer used by the hosted daily report generator. */
export function collapseDailyLogicalTrades<T extends DailyDigestPositionRow>(input: {
  rows: readonly T[];
  routes: readonly DailyDigestRouteRow[];
  session: string;
  sessionOf: (iso: string) => string;
}): DailyLogicalTradeResult<T> {
  const issues: string[] = [];
  const byId = new Map(input.rows.map((row) => [row.id, row]));
  const routeByPosition = latestRoutes(input.routes);
  const rootOf = (row: T): string | null => {
    let current: DailyDigestPositionRow = row;
    const seen = new Set<string>();
    while (current.runner_of) {
      if (seen.has(current.id)) { issues.push(`runner lineage cycle at ${row.id}`); return null; }
      seen.add(current.id);
      const parent = byId.get(current.runner_of);
      if (!parent) { issues.push(`runner ${row.id} lacks parent ${current.runner_of}`); return null; }
      current = parent;
    }
    return current.id;
  };
  const grouped = new Map<string, T[]>();
  for (const row of input.rows) {
    const root = rootOf(row);
    if (root) grouped.set(root, [...(grouped.get(root) ?? []), row]);
  }
  const groups: DailyLogicalTradeGroup<T>[] = [];
  for (const [rootPositionId, rows] of grouped) {
    if (rows.some((row) => row.status !== "closed" || !row.closed_at || row.realized_pnl == null)) continue;
    const terminalAt = rows.map((row) => row.closed_at as string)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    if (input.sessionOf(terminalAt) !== input.session) continue;
    const root = byId.get(rootPositionId) as T;
    const strategistIds = [...new Set(rows.map((row) => row.strategist_id))];
    if (strategistIds.length !== 1) { issues.push(`logical trade ${rootPositionId} spans channel identities`); continue; }
    const accounts = [...new Set(rows.map((row) => routeByPosition.get(row.id)?.account_id ?? ""))];
    if (accounts.length !== 1 || !accounts[0]) { issues.push(`logical trade ${rootPositionId} lacks one immutable account route`); continue; }
    const configurationEpochId = root.configuration_epoch_id ?? "";
    const channelSpecVersionId = root.channel_spec_version_id ?? "";
    const releaseManifestId = root.release_manifest_id ?? "";
    if (!configurationEpochId || !channelSpecVersionId || !releaseManifestId) {
      issues.push(`logical trade ${rootPositionId} lacks exact configuration identity`); continue;
    }
    if (rows.some((row) => row.configuration_epoch_id != null && row.configuration_epoch_id !== configurationEpochId
      || row.channel_spec_version_id != null && row.channel_spec_version_id !== channelSpecVersionId
      || row.release_manifest_id != null && row.release_manifest_id !== releaseManifestId)) {
      issues.push(`logical trade ${rootPositionId} spans configuration identities`); continue;
    }
    const realizedPnl = rows.reduce((sum, row) => sum + Number(row.realized_pnl), 0);
    if (!Number.isFinite(realizedPnl)) { issues.push(`logical trade ${rootPositionId} has invalid realized P&L`); continue; }
    groups.push({
      rootPositionId, root, rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)), accountId: accounts[0],
      configurationEpochId, channelSpecVersionId, releaseManifestId, realizedPnl, terminalAt,
    });
  }
  groups.sort((left, right) => Date.parse(left.terminalAt) - Date.parse(right.terminalAt)
    || left.rootPositionId.localeCompare(right.rootPositionId));
  return {
    groups,
    issues: [...new Set(issues)].sort(),
    positionRows: groups.reduce((sum, group) => sum + group.rows.length, 0),
    runnerRows: groups.reduce((sum, group) => sum + group.rows.filter((row) => row.runner_of != null).length, 0),
  };
}
