/** Whole-intent completion is stronger than broker flatness. The buy chain must
 * be sealed and every acknowledged command resolved; otherwise a paused winner
 * may still own a POST capability even when no order is visible at the broker.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedBuySeal, fixedLedgerId, planFixedEntryCoverage, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolRecord, fixedProtocolObservation, readFixedProtocolRecord, claimFixedProtocolRecord,
  type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { inspectFixedEntryInventory, fixedFactCoverageFill } from "./fixedEntryLedgerInventory.js";
import { validFixedExitRequest } from "./fixedEntryExitRequest.js";
import { fixedPositionIdentityMatches, type FixedCoverageSnapshot } from "./fixedEntryCoverageMaterialization.js";
import { fixedBookedRowHash, type FixedSellBookingReceipt } from "./fixedEntrySellBooking.js";
import { readFixedRowFence } from "./fixedEntryRowFence.js";
export interface FixedIntentSettlement {
  protocol: "fixed-intent-settlement-v1";
  intentId: string;
  sessionDateEt: string;
  sessionEntryConsumed: boolean;
  boughtQty: number;
  soldQty: number;
  cumulativeBuyCost: string;
  closedEntryCost: string;
  basisRoundingResidual: string;
  buySealHash: string;
  commands: { commandId: string; claimHash: string; terminalHash: string; bookingHash: string | null }[];
  closedPositions: { positionId: string; positionHash: string }[];
}
export async function sealFixedEntryBuys(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  records: readonly FixedProtocolRecord[], reason: "exit-required" | "buy-plan-finished", at: string): Promise<FixedProtocolRecord | null> {
  const original = await readFixedProtocolRecord(storage, intent, intent.id);
  if (canonicalJson(original?.body.intent) !== canonicalJson(intent)) throw new Error("fixed_settlement:original_intent_not_durable");
  const inventory = inspectFixedEntryInventory(intent, records);
  if (inventory.buySeal) {
    const storedSeal = await readFixedProtocolRecord(storage, intent, inventory.buySeal.id);
    return storedSeal?.kind === "command" && canonicalJson(storedSeal.body.command) === canonicalJson(inventory.buySeal)
      ? storedSeal : null;
  }
  const buys = inventory.facts.filter(f => f.command.side === "buy");
  if (reason === "exit-required") {
    const exit = inventory.records.get(fixedLedgerId("exit-required", [intent.id]));
    if (!exit || !validFixedExitRequest(exit, intent)) return null;
  } else {
    const bought = buys.reduce((n, f) => n + (f.provenFill?.filledQty ?? 0), 0);
    if (!buys.every(f => f.terminal) || !(bought === 4 || buys.length === intent.executionPlan.buyRungs.length)) return null;
  }
  const command = fixedBuySeal({ intentId: intent.id, sequence: buys.length, reason });
  const record = fixedProtocolRecord({ id: command.id, intentId: intent.id, kind: "command", recordedAt: at, body: { command } });
  await claimFixedProtocolRecord(storage, fixedProtocolObservation(intent, record));
  const stored = await readFixedProtocolRecord(storage, intent, command.id);
  // A concurrent buy command may win this same slot. Never skip that command
  // or allocate another slot from the old snapshot; refresh the complete chain.
  return stored && (stored.body.command as { kind?: string }).kind === "buy-seal" ? stored : null;
}
function settlementEvidence(intent: FixedEntryIntent, snapshot: Pick<FixedCoverageSnapshot, "records" | "positions">): FixedIntentSettlement {
  const inventory = inspectFixedEntryInventory(intent, snapshot.records);
  if (!inventory.buySeal) throw new Error("fixed_settlement:buy_seal_required");
  if (inventory.facts.some(f => !f.terminal || (f.command.side === "sell" && !f.booking))) {
    throw new Error("fixed_settlement:unresolved_command_capability");
  }
  const positions = [...snapshot.positions].sort((a, b) => readFixedRowFence(a).generation - readFixedRowFence(b).generation);
  if (positions.some((p, i) => p.status !== "closed" || !fixedPositionIdentityMatches(intent, p)
      || readFixedRowFence(p).generation !== i)) throw new Error("fixed_settlement:open_or_invalid_position");
  const sellBookings = inventory.facts.filter(f => f.command.side === "sell").map(f => f.booking!.body.booking as FixedSellBookingReceipt);
  for (const row of positions) {
    const proofs = sellBookings.filter(b => b.soldQty > 0 && b.rowId === row.id);
    if (proofs.length !== 1 || proofs[0].bookedRowHash !== fixedBookedRowHash(row)) throw new Error("fixed_settlement:closed_position_unproven");
  }
  const fills = inventory.facts.map(fixedFactCoverageFill);
  if (fills.some(f => f === null)) throw new Error("fixed_settlement:terminal_fill_missing");
  const plan = planFixedEntryCoverage({ intentId: intent.id, commands: inventory.facts.map(f => f.command), fills: fills.map(f => f!),
    rows: positions.map(p => ({ id: p.id, intentId: intent.id, status: "closed", qty: p.qty, avgEntryPrice: String(p.avg_entry_price) })),
    brokerNetQty: 0 });
  if (plan.state !== "ready" || plan.netQty !== 0) throw new Error("fixed_settlement:ledger_not_flat");
  return { protocol: "fixed-intent-settlement-v1", intentId: intent.id, sessionDateEt: intent.sessionDateEt,
    sessionEntryConsumed: plan.boughtQty > 0, boughtQty: plan.boughtQty, soldQty: plan.soldQty,
    cumulativeBuyCost: plan.cumulativeBuyCost, closedEntryCost: plan.closedEntryCost,
    basisRoundingResidual: plan.basisRoundingResidual,
    buySealHash: inventory.records.get(inventory.buySeal.id)!.contentHash,
    commands: inventory.facts.map(f => ({ commandId: f.command.id, claimHash: f.record.contentHash,
      terminalHash: f.terminal!.contentHash, bookingHash: f.booking?.contentHash ?? null })),
    closedPositions: positions.map(p => ({ positionId: p.id, positionHash: fixedBookedRowHash(p) })) };
}
/** Validate a previously persisted completion against its complete immutable
 * ledger and closed positions. This is historical proof, not a current broker
 * snapshot and never permission to create a new completion receipt. */
export function verifyFixedIntentSettlement(intent: FixedEntryIntent,
  snapshot: Pick<FixedCoverageSnapshot, "records" | "positions">): FixedProtocolRecord | null {
  try {
    const evidence = settlementEvidence(intent, snapshot);
    const record = snapshot.records.find(r => r.id === fixedLedgerId("intent-settlement", [intent.id]));
    return record?.kind === "settlement" && canonicalJson(record.body) === canonicalJson({ intentSettlement: evidence }) ? record : null;
  } catch { return null; }
}
export async function settleFixedEntryIntent(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  snapshot: FixedCoverageSnapshot, nowMs: number): Promise<FixedProtocolRecord | null> {
  const original = await readFixedProtocolRecord(storage, intent, intent.id);
  if (canonicalJson(original?.body.intent) !== canonicalJson(intent)) throw new Error("fixed_settlement:original_intent_not_durable");
  const age = nowMs - snapshot.brokerObservedAtMs;
  if (snapshot.brokerNetQty !== 0 || !Number.isFinite(age) || age < 0 || age > 2_000) return null;
  let evidence: FixedIntentSettlement;
  try { evidence = settlementEvidence(intent, snapshot); } catch { return null; }
  const record = fixedProtocolRecord({ id: fixedLedgerId("intent-settlement", [intent.id]), intentId: intent.id,
    kind: "settlement", recordedAt: new Date(nowMs).toISOString(), body: { intentSettlement: evidence } });
  const previous = await readFixedProtocolRecord(storage, intent, record.id);
  if (previous) return canonicalJson(previous.body) === canonicalJson(record.body) ? previous : null;
  await claimFixedProtocolRecord(storage, fixedProtocolObservation(intent, record));
  const verified = await readFixedProtocolRecord(storage, intent, record.id);
  return verified && canonicalJson(verified.body) === canonicalJson(record.body) ? verified : null;
}
