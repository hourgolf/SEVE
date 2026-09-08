/** Common interpretation of one complete immutable intent inventory. Runtime
 * adapters supply all paginated records or fail; guards and materialization use
 * the same terminal/fill-floor facts rather than independent broker summaries.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, validFixedCommandSlot, compareFixedDecimal, fixedFillCost,
  type FixedEntryIntent, type FixedOrderCommand, type FixedOrderFill, type FixedBuySeal } from "./fixedEntryLedgerModel.js";
import { parseFixedProtocolRecord, type FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { validateFixedCommandClaim, validFixedCommandResolution, type FixedCommandResolution } from "./fixedEntryCommandCoordinator.js";
import { validFixedFillEvidence, type FixedFillEvidence } from "./fixedEntryFillEvidence.js";
import { validFixedSellBookingReceipt } from "./fixedEntrySellBooking.js";
export interface FixedCommandFact {
  record: FixedProtocolRecord;
  command: FixedOrderCommand;
  terminal: FixedProtocolRecord | null;
  booking: FixedProtocolRecord | null;
  floor: FixedProtocolRecord | null;
  provenFill: FixedOrderFill | null;
  notSubmitted: boolean;
}
export function inspectFixedEntryInventory(intent: FixedEntryIntent, input: readonly FixedProtocolRecord[]): {
  records: Map<string, FixedProtocolRecord>;
  facts: FixedCommandFact[];
  buySeal: FixedBuySeal | null;
} {
  const records = new Map(input.map(r => [r.id, r]));
  if (records.size !== input.length || input.some(r => !parseFixedProtocolRecord(r) || r.intentId !== intent.id)
      || canonicalJson(records.get(intent.id)?.body.intent) !== canonicalJson(intent)) throw new Error("fixed_inventory:original_or_record_invalid");
  const facts: FixedCommandFact[] = [];
  let buySeal: FixedBuySeal | null = null;
  for (const side of ["buy", "sell"] as const) {
    const chain = input.filter(r => r.kind === "command" && (r.body.command as { side?: string }).side === side)
      .sort((a, b) => (a.body.command as FixedOrderCommand).sequence - (b.body.command as FixedOrderCommand).sequence);
    for (const [index, record] of chain.entries()) {
      const slot = record.body.command;
      if (!validFixedCommandSlot(slot) || slot.sequence !== index) throw new Error("fixed_inventory:command_chain_gap");
      if (slot.kind === "buy-seal") {
        if (side !== "buy" || index !== chain.length - 1) throw new Error("fixed_inventory:command_after_seal");
        buySeal = slot; continue;
      }
      validateFixedCommandClaim(intent, record.body);
      const terminal = records.get(fixedLedgerId("terminal", [slot.id])) ?? null;
      if (terminal && !validFixedCommandResolution(terminal, record)) throw new Error("fixed_inventory:terminal_invalid");
      const resolution = terminal?.body.resolution as FixedCommandResolution | undefined;
      const booking = records.get(fixedLedgerId("booking", [slot.id])) ?? null;
      if (booking && (side !== "sell" || !terminal || !validFixedSellBookingReceipt(booking, record, terminal))) {
        throw new Error("fixed_inventory:booking_invalid");
      }
      let floor: FixedProtocolRecord | null = null;
      for (let qty = 0; qty <= slot.quantity; qty++) {
        const r = records.get(fixedLedgerId("fill-floor", [slot.id, qty]));
        if (!r) continue;
        if (!validFixedFillEvidence(r, record)) throw new Error("fixed_inventory:fill_floor_invalid");
        const next = r.body.fillEvidence as FixedFillEvidence;
        if (floor) {
          const before = floor.body.fillEvidence as FixedFillEvidence;
          if (next.brokerOrderId !== before.brokerOrderId || compareFixedDecimal(next.cumulativeCost, before.cumulativeCost) < 0) {
            throw new Error("fixed_inventory:fill_floor_regression");
          }
        }
        floor = r;
      }
      const finalFill = resolution?.fill;
      const best = floor?.body.fillEvidence as FixedFillEvidence | undefined;
      if (terminal && best && (best.filledQty > (finalFill?.filledQty ?? 0)
          || compareFixedDecimal(best.cumulativeCost, fixedFillCost(finalFill?.filledQty ?? 0, finalFill?.averageFillPrice ?? null)) > 0
          || (finalFill && finalFill.brokerOrderId !== best.brokerOrderId))) throw new Error("fixed_inventory:terminal_regresses_fill");
      facts.push({ record, command: slot, terminal, booking, floor,
        provenFill: finalFill ?? (best ? { ...best, status: "durable-fill-floor" } : null),
        notSubmitted: resolution?.outcome === "not-submitted" });
    }
  }
  return { records, facts, buySeal };
}
/** Internal arithmetic adapter only. A proven local non-submission contributes
 * terminal zero; this synthetic value MUST NOT be emitted as a broker fill. */
export function fixedFactCoverageFill(fact: FixedCommandFact): FixedOrderFill | null {
  if (fact.provenFill) return fact.provenFill;
  if (!fact.notSubmitted) return null;
  const c = fact.command;
  return { commandId: c.id, brokerOrderId: `not-submitted:${c.id}`, clientOrderId: c.clientOrderId,
    side: c.side, requestedQty: c.quantity, filledQty: 0, averageFillPrice: null, status: "rejected" };
}
