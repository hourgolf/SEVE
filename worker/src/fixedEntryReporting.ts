/** Replayable reporting projection from complete original-intent evidence.
 * No broker calls or invented fills/clocks. Protocol custody records remain
 * separate from these ordinary decision, terminal broker and lineage events.
 */
import { fixedLedgerId, parseFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import type { FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { fixedOriginalMaterialization, fixedPositionCoverageHash, type FixedCoverageMaterializationReceipt,
  type FixedMaterializedPosition } from "./fixedEntryCoverageMaterialization.js";
import { readFixedRowFence, fixedRowId, fixedReserveSellCas } from "./fixedEntryRowFence.js";
import { fixedBookedRowHash, type FixedSellBookingReceipt } from "./fixedEntrySellBooking.js";
import { validFixedExitRequest, type FixedIntentExitRequest } from "./fixedEntryExitRequest.js";
import { buildDecisionObservation, buildBrokerObservation, buildPositionRouteObservation,
  type DecisionObservationInput, type ExecutionObservationDraft } from "./executionObservationModel.js";
import { buildPositionOutcome, type PositionOutcomeDraft } from "./positionOutcomeModel.js";
export interface FixedReportingPlan {
  execution: ExecutionObservationDraft[];
  outcomes: PositionOutcomeDraft[];
  cohorts: { position: FixedMaterializedPosition; censorCode: string | null; evidenceAt: string }[];
  /** Known terminal evidence may be published while custody remains unresolved.
   * This count explicitly identifies commands with no publishable terminal. */
  pendingCommands: number;
}
export function buildFixedEntryReporting(intent: FixedEntryIntent, input: {
  records: readonly FixedProtocolRecord[]; positions: readonly FixedMaterializedPosition[];
}): FixedReportingPlan {
  if (!parseFixedEntryIntent(intent)) throw new Error("fixed_reporting:invalid_original");
  const inventory = inspectFixedEntryInventory(intent, input.records);
  const positions = [...input.positions].sort((a,b) => readFixedRowFence(a).generation - readFixedRowFence(b).generation);
  if (new Set(positions.map(r => r.id)).size !== positions.length
      || positions.some((r,i) => r.id !== fixedRowId(intent.id,i))) throw new Error("fixed_reporting:incomplete_row_lineage");
  for (const record of input.records) if (record.body.coverage) {
    const c = record.body.coverage as FixedCoverageMaterializationReceipt;
    if (!positions.some(r => r.id === c.rowId)) throw new Error("fixed_reporting:durable_coverage_row_missing");
  }
  const opened = positions.map(row => fixedOriginalMaterialization(intent, row, input.records));
  for (const row of positions) {
    const latestCoverageRevision = Math.max(-1, ...input.records.flatMap(r => {
      const c = r.body.coverage as FixedCoverageMaterializationReceipt | undefined;
      return c?.rowId === row.id ? [c.revision] : [];
    }));
    const latestBookedRevision = Math.max(-1, ...inventory.facts.flatMap(f => {
      const b = f.booking?.body.booking as FixedSellBookingReceipt | undefined;
      if (b?.rowId !== row.id) return [];
      if (b.soldQty > 0 && row.status !== "closed") throw new Error("fixed_reporting:booked_row_still_open");
      // A locally not-submitted command can be booked after its reservation
      // failed, advancing only one revision. Its exact durable zero-booking
      // hash proves that current projection; never generalize to accepting an
      // old reserved row after a successful reservation+release.
      if (b.soldQty === 0 && b.bookedRowHash === fixedBookedRowHash(row)) return [readFixedRowFence(row).revision];
      return [readFixedRowFence(f.record.body.sellRow as FixedMaterializedPosition).revision + 2];
    }));
    if (readFixedRowFence(row).revision < Math.max(latestCoverageRevision,latestBookedRevision)) throw new Error("fixed_reporting:stale_current_row");
  }
  for (const row of positions) if (row.status === "closed") {
    const bookings = inventory.facts.filter(f => {
      const b = f.booking?.body.booking as FixedSellBookingReceipt | undefined;
      return b?.rowId === row.id && b.soldQty > 0 && b.bookedRowHash === fixedBookedRowHash(row);
    });
    if (bookings.length !== 1) throw new Error("fixed_reporting:closed_booking_readback_mismatch");
  } else if (row.status !== "open") throw new Error("fixed_reporting:row_status_invalid");
  for (const row of positions) if (row.status === "open") {
    const coverageHash = fixedPositionCoverageHash(row);
    const covered = input.records.some(r => {
      const c = r.body.coverage as FixedCoverageMaterializationReceipt | undefined;
      return c?.rowId === row.id && c.positionHash === coverageHash;
    });
    // Pending reservation and terminal-zero release advance the fence without
    // changing coverage economics. Accept only their exact durable projection.
    const reserved = inventory.facts.some(f => {
      const before = f.record.body.sellRow as FixedMaterializedPosition | null;
      if (f.command.side !== "sell" || !before || before.id !== row.id) return false;
      const change = fixedReserveSellCas(before, f.command.id);
      return fixedPositionCoverageHash({ ...before, ...change.update } as FixedMaterializedPosition) === coverageHash;
    });
    const released = inventory.facts.some(f => {
      const b = f.booking?.body.booking as FixedSellBookingReceipt | undefined;
      return b?.rowId === row.id && b.soldQty === 0 && b.bookedRowHash === fixedBookedRowHash(row);
    });
    if (!covered && !reserved && !released) throw new Error("fixed_reporting:open_row_evidence_mismatch");
  }
  const execution: ExecutionObservationDraft[] = [], outcomes: PositionOutcomeDraft[] = [];
  const channel = { id: intent.strategistId, slug: intent.slug, underlying: intent.underlying };
  const base: DecisionObservationInput = { channel, accountId: intent.accountId,
    decisionAtMs: Date.parse(intent.sourceBarAt), observedAtMs: Date.parse(intent.createdAt), chainAgeMs: NaN,
    configurationWriteStamp: intent.writeStamp,
    decision: { slug: intent.slug, status: "armed", action: "enter", reason: intent.reason,
      occ: intent.occ, direction: intent.optionSide, qty: 4, blocked: null, detail: structuredClone(intent.evidence) } };
  const entry = buildDecisionObservation(base);
  if (!entry) throw new Error("fixed_reporting:entry_identity");
  // Production intents carry the same opportunity identity as the original
  // bar-loop observation. Older synthetic fixtures may explicitly omit it.
  if (intent.opportunityId && entry.opportunity_id !== intent.opportunityId) throw new Error("fixed_reporting:opportunity_mismatch");
  const opportunityId = entry.opportunity_id;
  execution.push(entry);
  const exitRecord = inventory.records.get(fixedLedgerId("exit-required", [intent.id]));
  if (exitRecord && !validFixedExitRequest(exitRecord, intent)) throw new Error("fixed_reporting:invalid_exit_request");
  const exit = exitRecord?.body.exitRequest as FixedIntentExitRequest | undefined;
  const exitInput: DecisionObservationInput | null = exit ? { ...base,
    decisionAtMs: Date.parse(exit.requestedAt), observedAtMs: Date.parse(exit.requestedAt),
    decision: { ...base.decision, action: "exit", reason: exit.reason, detail: {} } } : null;
  if (exitInput) {
    const decision = buildDecisionObservation(exitInput);
    if (!decision) throw new Error("fixed_reporting:exit_identity");
    execution.push(decision);
  }
  for (const fact of inventory.facts) {
    // A cumulative partial cannot occupy an immutable terminal observation ID.
    // A local non-submission is protocol evidence, never a synthetic broker fill.
    if (!fact.terminal || fact.notSubmitted) continue;
    const fill = fact.provenFill!;
    const source = fact.command.side === "buy" ? base : exitInput;
    if (!source) throw new Error("fixed_reporting:sell_without_exit_latch");
    const positionId = fact.command.side === "sell" ? (fact.record.body.sellRow as { id: string }).id : null;
    const row = buildBrokerObservation({ ...source, observedAtMs: Date.parse(fact.terminal.recordedAt),
      positionId, clientOrderId: fill.clientOrderId, brokerOrderId: fill.brokerOrderId,
      brokerStatus: fill.status, filledQty: fill.filledQty, fillPrice: Number(fill.averageFillPrice ?? 0),
      executionGuardVersion: "fixed-durable-command-v1" });
    if (!row) throw new Error("fixed_reporting:terminal_observation_invalid");
    row.requested_qty = fact.command.quantity;
    // Zero fills have no execution price. The generic legacy builder accepts
    // only a number; preserve unavailable price explicitly in the output.
    if (!fill.filledQty) row.fill_price = null;
    row.payload.fixedCommandEvidence = { intentId: intent.id, commandId: fact.command.id,
      terminalRecordId: fact.terminal.id, terminalContentHash: fact.terminal.contentHash,
      logicalRequestedQty: 4, commandRequestedQty: fact.command.quantity,
      submittedAt: null, filledAt: fill.filledAt ?? null, terminalObservedAt: fact.terminal.recordedAt };
    execution.push(row);
    if (!fact.booking) continue;
    const booked = fact.booking.body.booking as FixedSellBookingReceipt;
    if (booked.soldQty === 0) continue;
    const closed = positions.find(r => r.id === booked.rowId);
    if (!closed || closed.status !== "closed" || fixedBookedRowHash(closed) !== booked.bookedRowHash) {
      throw new Error("fixed_reporting:closed_booking_readback_mismatch");
    }
    const outcome = buildPositionOutcome({ eventKind: "position_booked", eventAtMs: Date.parse(booked.closedAt),
      positionId: closed.id, opportunityId, quantity: booked.soldQty, avgEntryPrice: booked.originalBasis,
      exitPrice: booked.databaseMark, realizedPnl: booked.realizedPnl, closeReason: booked.exitReason,
      payload: { intentId: intent.id, commandId: fact.command.id, bookingRecordId: fact.booking.id,
        bookingContentHash: fact.booking.contentHash, closedAtSource: booked.closedAtSource } });
    if (!outcome) throw new Error("fixed_reporting:booking_outcome_invalid");
    outcomes.push(outcome);
  }
  for (const [generation, original] of opened.entries()) {
    const { row, receipt } = original;
    const parentPositionId = generation ? positions[generation - 1].id : null;
    const outcome = buildPositionOutcome({ eventKind: generation ? "position_remainder_opened" : "position_opened",
      eventAtMs: Date.parse(receipt.recordedAt), positionId: row.id, parentPositionId, opportunityId,
      quantity: row.qty, avgEntryPrice: row.avg_entry_price,
      payload: { intentId: intent.id, originalEntryObservedAt: row.opened_at, materializationRecordId: receipt.id,
        materializationContentHash: receipt.contentHash, entryTimeSource: "fill-observed-at" } });
    const route = buildPositionRouteObservation({ channel, accountId: intent.accountId, positionId: row.id,
      observedAtMs: Date.parse(receipt.recordedAt), sourceBarAtMs: Date.parse(intent.sourceBarAt),
      occSymbol: intent.occ, optionSide: intent.optionSide, quantity: row.qty, parentPositionId, opportunityId,
      routeKind: generation ? "partial_remainder" : "entry", configurationIds: intent.writeStamp });
    if (!outcome || !route) throw new Error("fixed_reporting:opening_lineage_invalid");
    outcomes.push(outcome); execution.push(route);
  }
  const observedPartialBuy = inventory.facts.some(f => f.command.side === "buy"
    && Array.from({ length: 3 }, (_, n) => n + 1).some(q => inventory.records.has(fixedLedgerId("fill-floor", [f.command.id, q]))));
  return { execution, outcomes,
    cohorts: opened.map(({ row, receipt }) => ({ position: row, evidenceAt: receipt.recordedAt,
      censorCode: row.qty !== 4 || positions.length > 1 || observedPartialBuy ? "fixed_partial_or_multiple_coverage_generations" : null })),
    pendingCommands: inventory.facts.filter(f => !f.terminal).length };
}
