/** Durable cumulative fill floors are distinct from terminal order receipts.
 * A native exit may use already-proven partial buys while exact buy lookup is
 * unavailable; it may never treat an unknown sell as terminal or retry a POST.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, fixedFillCost, compareFixedDecimal, validFixedCommandSlot,
  type FixedEntryIntent, type FixedOrderCommand, type FixedOrderFill } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, readFixedProtocolRecord, claimFixedProtocolRecord,
  type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
export interface FixedFillEvidence {
  protocol: "fixed-cumulative-fill-v1";
  commandId: string;
  claimHash: string;
  brokerOrderId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  requestedQty: number;
  filledQty: number;
  averageFillPrice: string | null;
  cumulativeCost: string;
}
function evidence(claim: FixedProtocolRecord, fill: FixedOrderFill): FixedFillEvidence {
  const c = claim.body.command as FixedOrderCommand;
  if (claim.kind !== "command" || !validFixedCommandSlot(c) || c.kind !== "submit"
      || claim.id !== c.id || claim.intentId !== c.intentId || fill.commandId !== c.id
      || fill.clientOrderId !== c.clientOrderId || fill.side !== c.side
      || fill.requestedQty !== c.quantity || !fill.brokerOrderId
      || !Number.isSafeInteger(fill.filledQty) || fill.filledQty < 0 || fill.filledQty > c.quantity) {
    throw new Error("fixed_fill:claim_or_fill_identity");
  }
  return { protocol: "fixed-cumulative-fill-v1", commandId: c.id, claimHash: claim.contentHash,
    brokerOrderId: fill.brokerOrderId, clientOrderId: fill.clientOrderId, side: fill.side,
    requestedQty: fill.requestedQty, filledQty: fill.filledQty, averageFillPrice: fill.averageFillPrice,
    cumulativeCost: fixedFillCost(fill.filledQty, fill.averageFillPrice) };
}
export function validFixedFillEvidence(record: FixedProtocolRecord, claim: FixedProtocolRecord): boolean {
  try {
    const body = record.body.fillEvidence as FixedFillEvidence;
    if (record.kind !== "settlement" || record.intentId !== claim.intentId
        || record.id !== fixedLedgerId("fill-floor", [claim.id, body.filledQty])
        || canonicalJson(Object.keys(record.body)) !== canonicalJson(["fillEvidence"])) return false;
    return canonicalJson(body) === canonicalJson(evidence(claim, { ...body, status: "durable-floor" }));
  } catch { return false; }
}
/** Returns the highest durably proven cumulative quantity; every lower floor
 * is also checked for order identity and nondecreasing total entry cost. */
export async function readFixedFillFloor(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  claim: FixedProtocolRecord): Promise<FixedProtocolRecord | null> {
  const c = claim.body.command as FixedOrderCommand;
  if (!validFixedCommandSlot(c) || c.kind !== "submit") throw new Error("fixed_fill:not_submit_command");
  let highest: FixedProtocolRecord | null = null;
  for (let qty = 0; qty <= c.quantity; qty++) {
    const r = await readFixedProtocolRecord(storage, intent, fixedLedgerId("fill-floor", [claim.id, qty]));
    if (!r) continue;
    if (!validFixedFillEvidence(r, claim)) throw new Error("fixed_fill:floor_invalid");
    const current = r.body.fillEvidence as FixedFillEvidence;
    if (highest) {
      const previous = highest.body.fillEvidence as FixedFillEvidence;
      if (previous.brokerOrderId !== current.brokerOrderId
          || compareFixedDecimal(current.cumulativeCost, previous.cumulativeCost) < 0) throw new Error("fixed_fill:floor_regression");
    }
    highest = r;
  }
  return highest;
}
export async function persistFixedFillEvidence(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  claim: FixedProtocolRecord, fill: FixedOrderFill, observedAt: string): Promise<FixedProtocolRecord | null> {
  const original = await readFixedProtocolRecord(storage, intent, intent.id);
  const durableClaim = await readFixedProtocolRecord(storage, intent, claim.id);
  if (canonicalJson(original?.body.intent) !== canonicalJson(intent)
      || canonicalJson(durableClaim) !== canonicalJson(claim)) throw new Error("fixed_fill:original_claim_not_durable");
  const body = evidence(claim, fill);
  const previous = await readFixedFillFloor(storage, intent, claim);
  if (previous) {
    const floor = previous.body.fillEvidence as FixedFillEvidence;
    if (body.brokerOrderId !== floor.brokerOrderId || body.filledQty < floor.filledQty
        || compareFixedDecimal(body.cumulativeCost, floor.cumulativeCost) < 0) return null;
  }
  const record = fixedProtocolRecord({ id: fixedLedgerId("fill-floor", [claim.id, fill.filledQty]),
    intentId: intent.id, kind: "settlement", recordedAt: observedAt, body: { fillEvidence: body } });
  const existing = await readFixedProtocolRecord(storage, intent, record.id);
  if (existing) return validFixedFillEvidence(existing, claim) && canonicalJson(existing.body) === canonicalJson(record.body) ? existing : null;
  await claimFixedProtocolRecord(storage, fixedProtocolObservation(intent, record));
  const verified = await readFixedProtocolRecord(storage, intent, record.id);
  return verified && validFixedFillEvidence(verified, claim) && canonicalJson(verified.body) === canonicalJson(record.body) ? verified : null;
}
