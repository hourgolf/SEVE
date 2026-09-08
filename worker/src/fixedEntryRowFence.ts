/** Fixed-only position materialization. Every economic update compares the
 * exact open row read by its caller, including the command reservation. */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, fixedSellEconomics } from "./fixedEntryLedgerModel.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FIXED_ROW_IDENTITY_KEYS = ["strategist_id", "occ_symbol", "underlying", "expiration", "strike",
  "opt_type", "opened_at", "entry_reason", "runner_of", "channel_spec_version_id", "release_manifest_id",
  "configuration_epoch_id"] as const;

export interface FixedRowFence {
  protocol: "fixed-entry-row-v1";
  intentId: string;
  generation: number;
  revision: number;
  activeSellCommandId: string | null;
}
export interface FixedFencedRow {
  id: string;
  status: string;
  qty: number;
  avg_entry_price: number;
  entry_features: Record<string, unknown>;
}
export interface FixedRowCas {
  expected: FixedFencedRow;
  update: Record<string, unknown>;
}
/** Match the database ownership projection; unrelated PositionRow fields must
 * neither grant ownership nor make a successful reservation appear to fail. */
export function fixedFencedProjection(row: FixedFencedRow): FixedFencedRow {
  return structuredClone({ id: row.id, status: row.status, qty: row.qty,
    avg_entry_price: row.avg_entry_price, entry_features: row.entry_features });
}
export function fixedRowId(intentId: string, generation: number): string {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("fixed_entry:row_generation");
  return fixedLedgerId("row", [intentId, generation]);
}
export function readFixedRowFence(row: FixedFencedRow): FixedRowFence {
  const f = row.entry_features.fixed_entry_coverage as FixedRowFence | undefined;
  if (!f || f.protocol !== "fixed-entry-row-v1"
      || !UUID.test(f.intentId)
      || !Number.isSafeInteger(f.revision) || f.revision < 0
      || row.id !== fixedRowId(f.intentId, f.generation)
      || (f.activeSellCommandId !== null && !UUID.test(f.activeSellCommandId))) {
    throw new Error("fixed_entry:row_fence_invalid");
  }
  return f;
}
function revision(row: FixedFencedRow, activeSellCommandId: string | null): Record<string, unknown> {
  const f = readFixedRowFence(row);
  return { ...row.entry_features, fixed_entry_coverage: { ...f,
    revision: f.revision + 1, activeSellCommandId } };
}
function open(row: FixedFencedRow): void {
  if (row.status !== "open" || !Number.isSafeInteger(row.qty) || row.qty < 1 || row.qty > 4
      || !Number.isFinite(row.avg_entry_price) || row.avg_entry_price <= 0) throw new Error("fixed_entry:row_not_open");
}
export function fixedCoverageCas(row: FixedFencedRow, quantity: number, basis: number): FixedRowCas {
  open(row);
  if (readFixedRowFence(row).activeSellCommandId != null) throw new Error("fixed_entry:sell_owns_row");
  if (!Number.isSafeInteger(quantity) || quantity < row.qty || quantity > 4
      || !Number.isFinite(basis) || basis <= 0 || Number(basis.toFixed(4)) !== basis
      || (quantity === row.qty && basis < row.avg_entry_price)) throw new Error("fixed_entry:coverage_value");
  return { expected: structuredClone(row), update: { qty: quantity, avg_entry_price: basis,
    entry_features: revision(row, null) } };
}
/** Caller must first validate this command's durable terminal-zero or locally
 * proven not-submitted receipt. A pending sell never permits reservation release. */
export function fixedReleaseSellCas(row: FixedFencedRow, commandId: string): FixedRowCas {
  open(row);
  if (readFixedRowFence(row).activeSellCommandId !== commandId) throw new Error("fixed_entry:sell_not_owned");
  return { expected: structuredClone(row), update: { entry_features: revision(row, null) } };
}
export function fixedReserveSellCas(row: FixedFencedRow, commandId: string): FixedRowCas {
  open(row);
  if (readFixedRowFence(row).activeSellCommandId != null || !UUID.test(commandId)) throw new Error("fixed_entry:sell_owns_row");
  return { expected: structuredClone(row), update: { entry_features: revision(row, commandId) } };
}
export function fixedBookSellCas(input: {
  row: FixedFencedRow; commandId: string; soldQty: number; exitPrice: number | string;
  closedAt: string; reason: string;
}): FixedRowCas {
  const { row } = input; open(row);
  if (readFixedRowFence(row).activeSellCommandId !== input.commandId
      || !Number.isSafeInteger(input.soldQty) || input.soldQty < 1 || input.soldQty > row.qty
      || !Number.isFinite(Number(input.exitPrice)) || Number(input.exitPrice) <= 0
      || !Number.isFinite(Date.parse(input.closedAt))) {
    throw new Error("fixed_entry:sell_booking_invalid");
  }
  const economics = fixedSellEconomics(row.avg_entry_price, input.soldQty, String(input.exitPrice));
  return { expected: structuredClone(row), update: { status: "closed", qty: input.soldQty,
    current_mark: economics.databaseMark,
    realized_pnl: economics.realizedPnl,
    unrealized_pnl: 0,
    closed_at: input.closedAt, close_reason: input.reason,
    entry_features: revision(row, input.commandId) } };
}
/** Hermetic equivalent of the database WHERE predicate, used in adversarial
 * interleaving tests. Runtime uses the same fields in its conditional UPDATE. */
export function fixedRowCasMatches(actual: FixedFencedRow, expected: FixedFencedRow): boolean {
  const a = actual as unknown as Record<string, unknown>, e = expected as unknown as Record<string, unknown>;
  return actual.id === expected.id && actual.status === "open" && expected.status === "open"
    && actual.qty === expected.qty && actual.avg_entry_price === expected.avg_entry_price
    && canonicalJson(actual.entry_features) === canonicalJson(expected.entry_features)
    && FIXED_ROW_IDENTITY_KEYS.every(key => key === "opened_at" && a[key] != null && e[key] != null
      ? Number.isFinite(Date.parse(String(a[key]))) && Date.parse(String(a[key])) === Date.parse(String(e[key]))
      : a[key] === e[key]);
}
