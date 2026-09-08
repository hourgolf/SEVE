/** Durable sell ladders use the original intent's execution settings and the
 * quote at the start of each exit wave. Restart cannot silently reprice a rung.
 * Waves share the intent-wide sell command sequence; they never create a new
 * ownership namespace for a partial remainder or a different exit reason.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedExecutionRungs, type FixedPlannedRung } from "./fixedEntryExecutionPlan.js";
import { fixedProtocolRecord, fixedProtocolObservation, claimFixedProtocolRecord, readFixedProtocolRecord,
  type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { validFixedExitRequest } from "./fixedEntryExitRequest.js";
import { readFixedRowFence, type FixedFencedRow } from "./fixedEntryRowFence.js";
import { validateFixedCommandClaim, type FixedCommandClaim } from "./fixedEntryCommandCoordinator.js";
export interface FixedSellPlan {
  protocol: "fixed-sell-plan-v1";
  intentId: string;
  sequenceStart: number;
  rowId: string;
  generation: number;
  exitRequestHash: string;
  /** null records the existing market fallback for unavailable/crossed NBBO. */
  quote: { bid: number; ask: number; observedAt: string } | null;
  rungs: FixedPlannedRung[];
}
function build(intent: FixedEntryIntent, input: Omit<FixedSellPlan, "protocol" | "intentId" | "rungs">): FixedSellPlan {
  if (!Number.isSafeInteger(input.sequenceStart) || input.sequenceStart < 0
      || !Number.isSafeInteger(input.generation) || input.generation < 0
      || input.rowId !== fixedLedgerId("row", [intent.id, input.generation])
      || !/^sha256:[0-9a-f]{64}$/.test(input.exitRequestHash)) throw new Error("fixed_sell_plan:identity_invalid");
  let quote = input.quote;
  if (quote && (!Number.isFinite(Date.parse(quote.observedAt)) || quote.bid <= 0 || quote.ask < quote.bid
      || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask))) throw new Error("fixed_sell_plan:quote_invalid");
  if (quote) quote = { ...quote, observedAt: new Date(quote.observedAt).toISOString() };
  return { protocol: "fixed-sell-plan-v1", intentId: intent.id, ...input, quote,
    rungs: quote ? fixedExecutionRungs("sell", intent.executionPlan.spreadCapture, intent.executionPlan.ladder, quote)
      : [{ type: "market", limitPrice: null, cancelAfterMs: null }] };
}
function parse(intent: FixedEntryIntent, record: FixedProtocolRecord): FixedSellPlan {
  const p = record.body.sellPlan as FixedSellPlan;
  const { protocol: _p, intentId: _i, rungs: _r, ...input } = p;
  const rebuilt = build(intent, input);
  if (record.kind !== "settlement" || record.intentId !== intent.id
      || record.id !== fixedLedgerId("sell-plan", [intent.id, p.sequenceStart])
      || canonicalJson(Object.keys(record.body)) !== canonicalJson(["sellPlan"])
      || canonicalJson(p) !== canonicalJson(rebuilt)
      || (p.quote && Date.parse(p.quote.observedAt) > Date.parse(record.recordedAt))) throw new Error("fixed_sell_plan:record_invalid");
  return rebuilt;
}
export function inspectFixedSellPlans(intent: FixedEntryIntent, records: readonly FixedProtocolRecord[]): {
  plans: FixedSellPlan[]; planFor(sequence: number): FixedSellPlan | null;
} {
  const inventory = inspectFixedEntryInventory(intent, records);
  const sellFacts = inventory.facts.filter(f => f.command.side === "sell");
  const exit = inventory.records.get(fixedLedgerId("exit-required", [intent.id]));
  const plans = records.filter(r => "sellPlan" in r.body).map(r => parse(intent, r)).sort((a, b) => a.sequenceStart - b.sequenceStart);
  if (plans.length && (!exit || !validFixedExitRequest(exit, intent))) throw new Error("fixed_sell_plan:exit_not_latched");
  for (const [index, p] of plans.entries()) {
    if (p.exitRequestHash !== exit!.contentHash || p.sequenceStart > sellFacts.length
        || p.generation !== sellFacts.slice(0, p.sequenceStart).filter(f => (f.provenFill?.filledQty ?? 0) > 0 && f.booking).length
        || (index === 0 && p.sequenceStart !== 0)) throw new Error("fixed_sell_plan:sequence_invalid");
    const previous = plans[index - 1];
    if (previous) {
      if (p.sequenceStart <= previous.sequenceStart) throw new Error("fixed_sell_plan:duplicate_or_reversed_wave");
      const before = sellFacts[p.sequenceStart - 1];
      if (!before?.terminal || !before.booking) throw new Error("fixed_sell_plan:prior_wave_unsettled");
      const waveFilled = before.provenFill?.filledQty === before.command.quantity;
      if (p.sequenceStart !== previous.sequenceStart + previous.rungs.length && !waveFilled) {
        throw new Error("fixed_sell_plan:premature_wave_restart");
      }
    }
  }
  const planFor = (sequence: number) => {
    const p = [...plans].reverse().find(p => p.sequenceStart <= sequence);
    if (!p || sequence >= p.sequenceStart + p.rungs.length) return null;
    const previous = sellFacts[sequence - 1];
    if (sequence > p.sequenceStart && previous?.terminal && previous.provenFill?.filledQty === previous.command.quantity) return null;
    return p;
  };
  for (const fact of sellFacts) {
    const claim = validateFixedCommandClaim(intent, fact.record.body), p = planFor(fact.command.sequence);
    if (!p || !matches(intent, p, claim, sellFacts)) throw new Error("fixed_sell_plan:command_outside_plan");
  }
  return { plans, planFor };
}
function matches(intent: FixedEntryIntent, plan: FixedSellPlan, claim: FixedCommandClaim,
  facts: ReturnType<typeof inspectFixedEntryInventory>["facts"]): boolean {
  const rung = plan.rungs[claim.command.sequence - plan.sequenceStart];
  const generation = plan.generation + facts.filter(f => f.command.side === "sell"
    && f.command.sequence >= plan.sequenceStart && f.command.sequence < claim.command.sequence && (f.provenFill?.filledQty ?? 0) > 0).length;
  return claim.command.side === "sell" && claim.sellRow?.id === fixedLedgerId("row", [intent.id, generation]) && !!rung
    && readFixedRowFence(claim.sellRow).generation === generation
    && claim.request.type === rung.type && (claim.request.limit_price ?? null) === rung.limitPrice;
}
export function fixedSellClaimMatchesPlan(intent: FixedEntryIntent, records: readonly FixedProtocolRecord[], claim: FixedCommandClaim): boolean {
  try {
    const p = inspectFixedSellPlans(intent, records).planFor(claim.command.sequence);
    return !!p && matches(intent, p, validateFixedCommandClaim(intent, claim), inspectFixedEntryInventory(intent, records).facts);
  } catch { return false; }
}
export async function ensureFixedSellPlan(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  records: readonly FixedProtocolRecord[], row: FixedFencedRow, quote: FixedSellPlan["quote"], at: string): Promise<FixedSellPlan | null> {
  const inventory = inspectFixedEntryInventory(intent, records);
  const sells = inventory.facts.filter(f => f.command.side === "sell");
  if (sells.some(f => !f.terminal || !f.booking)) return null;
  const exit = inventory.records.get(fixedLedgerId("exit-required", [intent.id]));
  if (!exit || !validFixedExitRequest(exit, intent)) return null;
  const fence = readFixedRowFence(row);
  if (fence.intentId !== intent.id || row.status !== "open" || fence.activeSellCommandId) return null;
  if (fence.generation !== sells.filter(f => (f.provenFill?.filledQty ?? 0) > 0).length) return null;
  const previous = inspectFixedSellPlans(intent, records);
  const pending = previous.planFor(sells.length);
  if (pending) return pending;
  const plan = build(intent, { sequenceStart: sells.length, rowId: row.id, generation: fence.generation,
    exitRequestHash: exit.contentHash, quote });
  const record = fixedProtocolRecord({ id: fixedLedgerId("sell-plan", [intent.id, plan.sequenceStart]), intentId: intent.id,
    kind: "settlement", recordedAt: at, body: { sellPlan: plan } });
  // Validate the proposed wave against every existing command before writing.
  inspectFixedSellPlans(intent, [...records, record]);
  await claimFixedProtocolRecord(storage, fixedProtocolObservation(intent, record));
  const actual = await readFixedProtocolRecord(storage, intent, record.id);
  if (!actual) return null;
  const winner = parse(intent, actual);
  // A concurrent caller's quote may win. Its original wave is authoritative.
  return winner.rowId === row.id && winner.exitRequestHash === exit.contentHash ? winner : null;
}
