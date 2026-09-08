import type { AtlasVirtualTradeRow, DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { REVIEWED_VIRTUAL_TRADE_REPAIRS } from "./reviewedVirtualTradeRepairs";

const fields = ["exit_at", "exit_px", "exit_reason", "giveback_pct", "mfe_pct", "pnl_per_contract", "stop_pct", "tp_pct"] as const;

function equivalent(field: typeof fields[number], actual: unknown, expected: unknown): boolean {
  if (actual == null || expected == null) return actual === expected;
  if (field === "exit_reason") return actual === expected;
  if (field === "exit_at") {
    if (typeof actual !== "string" || typeof expected !== "string") return false;
    const timestamp = Date.parse(actual);
    return Number.isFinite(timestamp) && timestamp === Date.parse(expected);
  }
  if ((typeof actual !== "number" && typeof actual !== "string")
      || (typeof actual === "string" && actual.trim() === "")) return false;
  return Number.isFinite(Number(actual)) && Number(actual) === Number(expected);
}

/** Pin previously approved repaired economics whenever that evidence enters a
 * later report. A current-session verifier cannot certify older source rows.
 * This check rejects drift; it never substitutes values, drops rows, or writes.
 * A snapshot containing neither the signal nor its row may be outside this
 * historical window and is not required to invent that evidence. */
export function assertReviewedVirtualTradeRepairs(
  snapshot: Pick<DecisionAtlasSourceSnapshot, "virtualTrades" | "signals">,
): void {
  const byId = new Map<string, AtlasVirtualTradeRow>();
  const duplicates = new Set<string>();
  for (const row of snapshot.virtualTrades) {
    if (byId.has(row.signal_id)) duplicates.add(row.signal_id);
    byId.set(row.signal_id, row);
  }
  const signalIds = new Set(snapshot.signals.map(signal => signal.id));
  const issues: string[] = [];
  for (const repair of REVIEWED_VIRTUAL_TRADE_REPAIRS) {
    const row = byId.get(repair.signalId);
    if (!row && !signalIds.has(repair.signalId)) continue;
    if (!row) { issues.push(`${repair.signalId}:missing`); continue; }
    if (duplicates.has(repair.signalId)) issues.push(`${repair.signalId}:duplicate`);
    const changed = fields.filter(field => !equivalent(field, row[field], repair.economics[field]));
    if (changed.length) issues.push(`${repair.signalId}:${changed.join(",")}`);
  }
  if (issues.length) throw new Error(`Reviewed virtual-trade repair regressed; report publication blocked: ${issues.join("; ")}`);
}
