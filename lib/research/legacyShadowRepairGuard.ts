import { createHash } from "node:crypto";

type Scalar = string | number | boolean | null;
export type LegacyRepairRow = Record<string, Scalar> & { signal_id: string };
export const LEGACY_REPAIR_COLUMNS = ["exit_reason", "exit_px", "exit_at", "pnl_per_contract", "stop_pct", "tp_pct", "mfe_pct", "giveback_pct"] as const;
const PROVENANCE = ["channel_spec_version_id", "release_manifest_id", "configuration_epoch_id", "native_manager_policy_version", "research_publisher_version"] as const;
export interface LegacyRepairAuthorization {
  version: "legacy-shadow-repair-authorization-v1";
  session: string;
  verificationFileSha256: string;
  sourceProposalSha256: string;
  expectedSessionRows: LegacyRepairRow[];
  repairs: Array<{ signal_id: string; changes: Record<string, Scalar> }>;
}
export interface LegacyRepairPlanRow {
  signalId: string;
  before: LegacyRepairRow;
  changes: Record<string, Scalar>;
  after: LegacyRepairRow;
}
const canonical = (row: Record<string, Scalar>): string => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])));
export const repairRowHash = (row: LegacyRepairRow): string => createHash("sha256").update(canonical(row)).digest("hex");
export function assertExactLegacySession(expected: LegacyRepairRow[], observed: LegacyRepairRow[]): void {
  const byId = new Map(observed.map(row => [row.signal_id, row]));
  if (byId.size !== observed.length || new Set(expected.map(row => row.signal_id)).size !== expected.length
      || expected.length !== observed.length || expected.some(row => !byId.has(row.signal_id)
        || canonical(row) !== canonical(byId.get(row.signal_id)!))) {
    throw new Error("Session before-images changed, missing, duplicated, or expanded; stop for review");
  }
}
export function buildLegacyRepairPlan(input: {
  authorization: LegacyRepairAuthorization;
  session: string;
  verificationFileSha256: string;
  repairIds: string[];
  observedSessionRows: LegacyRepairRow[];
}): LegacyRepairPlanRow[] {
  const a = input.authorization;
  if (a.version !== "legacy-shadow-repair-authorization-v1" || a.session !== input.session
      || a.verificationFileSha256.replace(/^sha256:/, "") !== input.verificationFileSha256.replace(/^sha256:/, "")
      || !/^[0-9a-f]{64}$/.test(a.sourceProposalSha256.replace(/^sha256:/, ""))) {
    throw new Error("Repair authorization scope or verification binding mismatch");
  }
  const authorizedIds = a.repairs.map(r => r.signal_id).sort();
  if (!authorizedIds.length || new Set(authorizedIds).size !== authorizedIds.length
      || JSON.stringify(authorizedIds) !== JSON.stringify([...input.repairIds].sort())) {
    throw new Error("Repair authorization IDs differ from independent verification");
  }
  assertExactLegacySession(a.expectedSessionRows, input.observedSessionRows);
  const beforeById = new Map(a.expectedSessionRows.map(row => [row.signal_id, row]));
  return [...a.repairs].sort((x,y) => x.signal_id.localeCompare(y.signal_id)).map(repair => {
    const before = beforeById.get(repair.signal_id);
    if (!before || PROVENANCE.some(k => before[k] !== null)) throw new Error("Refusing missing or provenance-stamped repair row");
    for (const [k,v] of Object.entries(before)) {
      if (!/^[a-z_][a-z0-9_]*$/.test(k) || (v !== null && !["string", "number", "boolean"].includes(typeof v))
          || (typeof v === "number" && !Number.isFinite(v))) throw new Error("Unsupported before-image field");
    }
    const keys = Object.keys(repair.changes);
    if (!keys.length || keys.some(k => !LEGACY_REPAIR_COLUMNS.includes(k as typeof LEGACY_REPAIR_COLUMNS[number]))) {
      throw new Error("Only approved economic columns may change");
    }
    if (keys.some(k => !(k in before) || (repair.changes[k] !== null && !["number", "string"].includes(typeof repair.changes[k]))
        || (typeof repair.changes[k] === "number" && !Number.isFinite(repair.changes[k])))) throw new Error("Malformed proposed economic values");
    return { signalId: repair.signal_id, before, changes: repair.changes, after: { ...before, ...repair.changes } };
  });
}

// Each PATCH is a compare-and-set against every saved column, including NULL provenance.
// This protects a single row atomically; it is deliberately not a multirow transaction.
interface ConditionalUpdate {
  eq(column: string, value: NonNullable<Scalar>): ConditionalUpdate;
  is(column: string, value: null): ConditionalUpdate;
  select(columns: string): PromiseLike<{ data: LegacyRepairRow[] | null; error: unknown }>;
}
export interface LegacyRepairClient {
  from(table: "virtual_trades"): { update(changes: Record<string, Scalar>): ConditionalUpdate };
}
export async function compareAndSetLegacyRepair(client: LegacyRepairClient, row: LegacyRepairPlanRow): Promise<void> {
  let query = client.from("virtual_trades").update(row.changes);
  for (const key of Object.keys(row.before).sort()) {
    const value = row.before[key];
    query = value === null ? query.is(key, null) : query.eq(key, value);
  }
  const result = await query.select("*");
  if (result.error) throw new Error("Conditional repair request failed; outcome may be unknown, inspect readback before retry");
  if (result.data?.length !== 1 || canonical(result.data[0]) !== canonical(row.after)) {
    throw new Error("Conditional repair matched zero/multiple rows or returned unexpected fields; stop for review");
  }
}
