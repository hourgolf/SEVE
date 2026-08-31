import type { ExecutionAccountObservation } from "../ops/brokerReconciliation";

export type PerformancePositionRow = Record<string, unknown> & {
  id: string;
  status: "open" | "closed";
  qty: number | string;
  realized_pnl: number | string | null;
  unrealized_pnl?: number | string | null;
  peak_mark: number | string | null;
  avg_entry_price: number | string;
  runner_of: string | null;
  closed_at: string | null;
  strategists?: { slug?: string } | null;
};

const FIELDS = "id,status,qty,unrealized_pnl,realized_pnl,peak_mark,avg_entry_price,runner_of,closed_at,strategists(slug)";
const PAGE = 250;
const MAX = 60_000;

/** All callers supply a total order and an exact count. A short server-capped
 * response is an error, never evidence that historical routes are missing. */
export async function readCompleteEvidence<T extends { id: string }>(
  make: () => any, label: string, max = MAX,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; from < max; from += PAGE) {
    const result = await make().range(from, from + PAGE - 1);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    if (!Number.isInteger(result.count) || result.count < 0) throw new Error(`${label}: exact count unavailable`);
    if (expected != null && expected !== result.count) throw new Error(`${label}: evidence changed during pagination; refresh`);
    expected = result.count;
    if (expected! > max) throw new Error(`${label}: exceeds ${max} row safety bound`);
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE || rows.length >= expected!) {
      if (rows.length !== expected) throw new Error(`${label}: incomplete read (${rows.length}/${expected})`);
      if (rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) {
        throw new Error(`${label}: missing or duplicate row identities`);
      }
      return rows;
    }
  }
  throw new Error(`${label}: pagination safety bound exceeded`);
}

/** Hydrate the whole parent/runner family before counting a logical trade.
 * A bank before the requested window must not disappear from its later runner. */
export async function readWindowedPositions(sb: any, start: string | null, asOf: string): Promise<PerformancePositionRow[]> {
  const query = () => sb.from("positions").select(FIELDS, { count: "exact" });
  const closed = await readCompleteEvidence<PerformancePositionRow>(() => {
    let q = query().eq("status", "closed").lte("closed_at", asOf);
    if (start) q = q.gte("closed_at", start);
    return q.order("closed_at", { ascending: false }).order("id");
  }, "closed positions");
  const open = await readCompleteEvidence<PerformancePositionRow>(() => query().eq("status", "open").order("id"), "open positions");
  const byId = new Map([...closed, ...open].map(row => [row.id, row]));
  if (byId.size !== closed.length + open.length) throw new Error("position changed state during read; refresh");
  const expanded = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    const missing = [...new Set([...byId.values()].flatMap(r => r.runner_of && !byId.has(r.runner_of) ? [r.runner_of] : []))];
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100);
      const parents = await readCompleteEvidence<PerformancePositionRow>(() => query().in("id", ids).order("id"), "trade parents");
      if (parents.length !== ids.length) throw new Error("logical trade parent evidence unavailable");
      parents.forEach(row => byId.set(row.id, row));
    }
    const pending = [...byId.keys()].filter(id => !expanded.has(id));
    if (!pending.length) {
      const rows = [...byId.values()];
      if (rows.some(row => !["open", "closed"].includes(row.status)
        || (row.runner_of != null && typeof row.runner_of !== "string")
        || (row.status === "closed" && (!row.closed_at || !Number.isFinite(Date.parse(row.closed_at)))))) {
        throw new Error("invalid logical trade status, parent, or close timestamp");
      }
      return rows;
    }
    for (let i = 0; i < pending.length; i += 100) {
      const ids = pending.slice(i, i + 100);
      const children = await readCompleteEvidence<PerformancePositionRow>(() => query().in("runner_of", ids).order("id"), "trade runners");
      for (const row of children) byId.set(row.id, row);
      ids.forEach(id => expanded.add(id));
    }
    if (byId.size > MAX) throw new Error("logical trade family exceeds safety bound");
    if ([...byId.values()].some(row => row.closed_at && row.closed_at > asOf)) {
      throw new Error("logical trade changed after the window cutoff; refresh");
    }
  }
  throw new Error("logical trade family depth exceeds safety bound");
}

export async function readWindowedExecutionRoutes(sb: any, positions: readonly { id: string }[]): Promise<ExecutionAccountObservation[]> {
  const rows: ExecutionAccountObservation[] = [];
  for (let from = 0; from < positions.length; from += 100) {
    const ids = positions.slice(from, from + 100).map(row => row.id);
    rows.push(...await readCompleteEvidence<ExecutionAccountObservation & { id: string }>(() => sb.from("execution_observations")
      .select("id,position_id,account_id,event_at", { count: "exact" })
      .in("position_id", ids).order("event_at").order("id"), "execution routes"));
  }
  return rows;
}
