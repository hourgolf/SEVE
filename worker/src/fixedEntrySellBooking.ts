/** Materialize one terminal fixed sell, from its original command-frozen row.
 * Positive terminal partials close ONLY their sold share. Coverage coordinator
 * must materialize the remaining ledger net before another sell can be admitted.
 * No broker calls, no unguarded closePositionRow or random remainder insertion.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerHash, fixedLedgerId, fixedSellEconomics, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolRecord, fixedProtocolObservation, claimFixedProtocolRecord,
  parseFixedProtocolRecord, readFixedProtocolRecord, type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { validateFixedCommandClaim, validFixedCommandResolution,
  type FixedCommandResolution } from "./fixedEntryCommandCoordinator.js";
import { fixedBookSellCas, fixedReserveSellCas, fixedReleaseSellCas, readFixedRowFence,
  fixedFencedProjection, type FixedFencedRow, type FixedRowCas } from "./fixedEntryRowFence.js";

interface FixedBookingMarker {
  protocol: "fixed-sell-booking-v1";
  commandId: string;
  claimHash: string;
  resolutionHash: string;
  soldQty: number;
  originalRowQty: number;
  originalBasis: number;
  realizedPnl: number;
  databaseMark: number | null;
  exitReason: string;
  closedAt: string;
  closedAtSource: "broker-filled-at" | "terminal-observed-at" | "no-fill";
}
export interface FixedSellBookingReceipt extends FixedBookingMarker {
  rowId: string;
  /** Closed history is immutable. A subsequent recovery may expand an open
   * terminal-zero row, so its receipt attests readback at booking, not forever. */
  bookedRowHash: string;
}
export interface FixedSellBookingPorts {
  storage: ImmutableClaimStorage;
  now(): number;
  readRow(id: string): Promise<FixedEconomicRow | null>;
  cas(change: FixedRowCas): Promise<{ state: "applied" | "lost-race" | "unknown"; row: FixedFencedRow | null }>;
}
export interface FixedEconomicRow extends FixedFencedRow {
  current_mark: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  closed_at: string | null;
  close_reason: string | null;
}
export type FixedSellBookingResult = {
  state: "booked" | "unresolved";
  reason: string;
  receipt: FixedProtocolRecord | null;
};
const failure = (reason: string): FixedSellBookingResult => ({ state: "unresolved", reason, receipt: null });
function markerFor(claim: FixedProtocolRecord, terminal: FixedProtocolRecord): FixedBookingMarker {
  const c = claim.body.command as { id: string };
  const row = claim.body.sellRow as FixedFencedRow;
  const resolution = terminal.body.resolution as FixedCommandResolution;
  const soldQty = resolution.fill?.filledQty ?? 0;
  const economics = soldQty > 0 ? fixedSellEconomics(row.avg_entry_price, soldQty, resolution.fill!.averageFillPrice!) : null;
  return { protocol: "fixed-sell-booking-v1", commandId: c.id,
    claimHash: claim.contentHash, resolutionHash: terminal.contentHash,
    soldQty, originalRowQty: row.qty, originalBasis: row.avg_entry_price,
    realizedPnl: economics?.realizedPnl ?? 0, databaseMark: economics?.databaseMark ?? null,
    exitReason: claim.body.exitReason as string,
    closedAt: resolution.fill?.filledAt ?? terminal.recordedAt,
    closedAtSource: soldQty === 0 ? "no-fill" : resolution.fill?.filledAt ? "broker-filled-at" : "terminal-observed-at" };
}
export function validFixedSellBookingReceipt(receipt: FixedProtocolRecord, claim: FixedProtocolRecord,
  terminal: FixedProtocolRecord): boolean {
  try {
    if (!parseFixedProtocolRecord(receipt) || !validFixedCommandResolution(terminal, claim)
        || receipt.kind !== "settlement" || receipt.intentId !== claim.intentId
        || receipt.id !== fixedLedgerId("booking", [claim.id])) return false;
    const body = receipt.body.booking as FixedSellBookingReceipt;
    const { rowId, bookedRowHash, ...marker } = body;
    return canonicalJson(Object.keys(receipt.body)) === canonicalJson(["booking"])
      && rowId === (claim.body.sellRow as FixedFencedRow).id
      && /^sha256:[0-9a-f]{64}$/.test(bookedRowHash)
      && canonicalJson(marker) === canonicalJson(markerFor(claim, terminal));
  } catch { return false; }
}
async function stored(ports: FixedSellBookingPorts, intent: FixedEntryIntent, id: string): Promise<FixedProtocolRecord | null> {
  return readFixedProtocolRecord(ports.storage, intent, id);
}
export function fixedBookedRowHash(row: FixedEconomicRow): string {
  return fixedLedgerHash({ ...fixedFencedProjection(row), current_mark: row.current_mark,
    realized_pnl: row.realized_pnl, unrealized_pnl: row.unrealized_pnl,
    closed_at: row.closed_at == null ? null : new Date(row.closed_at).toISOString(), close_reason: row.close_reason });
}
function equalField(key: string, actual: unknown, expected: unknown): boolean {
  if (key === "closed_at" && actual != null && expected != null) {
    return new Date(String(actual)).toISOString() === new Date(String(expected)).toISOString();
  }
  return canonicalJson(actual) === canonicalJson(expected);
}
/** Idempotent after response loss or restart, without rewriting a previously
 * closed row's quantity, entry basis or realized P&L. */
export async function bookFixedSellCommand(ports: FixedSellBookingPorts, originalIntent: FixedEntryIntent,
  commandId: string): Promise<FixedSellBookingResult> {
  const intent = structuredClone(originalIntent);
  try {
    const original = await stored(ports, intent, intent.id);
    if (original?.kind !== "intent" || canonicalJson(original.body.intent) !== canonicalJson(intent)) {
      return failure("original-intent-not-durable");
    }
    const claim = await stored(ports, intent, commandId);
    if (!claim || claim.kind !== "command" || claim.intentId !== intent.id) return failure("command-missing");
    const c = validateFixedCommandClaim(intent, claim.body);
    if (c.command.side !== "sell" || !c.sellRow) return failure("not-sell-command");
    const terminal = await stored(ports, intent, fixedLedgerId("terminal", [commandId]));
    if (!terminal || !validFixedCommandResolution(terminal, claim)) return failure("terminal-proof-missing");
    const bookingId = fixedLedgerId("booking", [commandId]);
    const prior = await stored(ports, intent, bookingId);
    if (prior) {
      if (!validFixedSellBookingReceipt(prior, claim, terminal)) return failure("booking-conflict");
      const booking = prior.body.booking as FixedSellBookingReceipt;
      if (booking.soldQty > 0) {
        const closed = await ports.readRow(booking.rowId);
        if (!closed || closed.status !== "closed" || fixedBookedRowHash(closed) !== booking.bookedRowHash) {
          return failure("closed-row-drift-after-booking");
        }
      }
      return { state: "booked", reason: "existing-booking", receipt: prior };
    }
    const marker = markerFor(claim, terminal);
    let row = await ports.readRow(c.sellRow.id);
    if (!row || readFixedRowFence(row).intentId !== intent.id) return failure("row-missing-or-wrong-intent");
    const recordedMarker = row.entry_features.fixed_entry_booking;
    if (canonicalJson(recordedMarker ?? null) !== canonicalJson(marker)) {
      let change: FixedRowCas;
      if (marker.soldQty > 0) {
        const reserved = fixedReserveSellCas(c.sellRow, commandId);
        const frozen = { ...reserved.expected, ...reserved.update } as FixedFencedRow;
        if (canonicalJson(fixedFencedProjection(row)) !== canonicalJson(fixedFencedProjection(frozen))) return failure("reserved-row-mismatch");
        const fill = (terminal.body.resolution as FixedCommandResolution).fill!;
        change = fixedBookSellCas({ row, commandId, soldQty: marker.soldQty,
          exitPrice: fill.averageFillPrice!, closedAt: marker.closedAt,
          reason: marker.exitReason });
      } else {
        const fence = readFixedRowFence(row);
        if (row.status !== "open" || (fence.activeSellCommandId !== null && fence.activeSellCommandId !== commandId)) {
          return failure("zero-fill-row-owned-elsewhere");
        }
        change = fence.activeSellCommandId === commandId ? fixedReleaseSellCas(row, commandId)
          : { expected: structuredClone(row), update: { entry_features: { ...row.entry_features,
            fixed_entry_coverage: { ...fence, revision: fence.revision + 1 } } } };
      }
      change.update.entry_features = { ...(change.update.entry_features as Record<string, unknown>), fixed_entry_booking: marker };
      await ports.cas(change);
      // A timeout after a successful CAS is recovered by exact marker/economic
      // readback. It does not imply a failed close and never authorizes a sell.
      row = await ports.readRow(c.sellRow.id);
      const expected = { ...change.expected, ...change.update } as FixedEconomicRow;
      if (!row || canonicalJson(fixedFencedProjection(row)) !== canonicalJson(fixedFencedProjection(expected))
          || Object.entries(change.update).some(([key, value]) => !equalField(key, row![key as keyof FixedEconomicRow], value))) {
        return failure("booking-row-readback-unconfirmed");
      }
    }
    if ((marker.soldQty > 0 && (row.status !== "closed" || row.qty !== marker.soldQty
        || row.avg_entry_price !== marker.originalBasis || row.realized_pnl !== marker.realizedPnl
        || row.close_reason !== marker.exitReason || row.closed_at == null
        || new Date(row.closed_at).toISOString() !== new Date(marker.closedAt).toISOString()
        || row.current_mark !== marker.databaseMark
        || row.unrealized_pnl !== 0))
        || (marker.soldQty === 0 && (row.status !== "open" || readFixedRowFence(row).activeSellCommandId !== null))) {
      return failure("booked-economics-mismatch");
    }
    const receipt = fixedProtocolRecord({ id: bookingId, intentId: intent.id, kind: "settlement",
      recordedAt: new Date(ports.now()).toISOString(), body: { booking: { ...marker,
        rowId: row.id, bookedRowHash: fixedBookedRowHash(row) } satisfies FixedSellBookingReceipt } });
    await claimFixedProtocolRecord(ports.storage, fixedProtocolObservation(intent, receipt));
    const verified = await stored(ports, intent, bookingId);
    if (!verified || !validFixedSellBookingReceipt(verified, claim, terminal)
        || canonicalJson(verified.body) !== canonicalJson(receipt.body)) return failure("booking-receipt-unconfirmed");
    return { state: "booked", reason: "terminal-sell-booked", receipt: verified };
  } catch { return failure("booking-evidence-unavailable"); }
}
