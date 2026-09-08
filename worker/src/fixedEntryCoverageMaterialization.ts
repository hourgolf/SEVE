/** Deterministic fixed-intent position coverage. Only durable, original-command
 * fill evidence can create/grow coverage; closed rows are never rewritten.
 * Coverage of known quantity is distinct from global settlement of all orders.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerHash, fixedLedgerId, planFixedEntryCoverage,
  type FixedEntryIntent, type FixedCoveragePlan } from "./fixedEntryLedgerModel.js";
import { fixedProtocolRecord, fixedProtocolObservation, readFixedProtocolRecord, claimFixedProtocolRecord,
  type ImmutableClaimStorage, type FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import { inspectFixedEntryInventory, fixedFactCoverageFill } from "./fixedEntryLedgerInventory.js";
import { fixedBookedRowHash, type FixedEconomicRow, type FixedSellBookingReceipt } from "./fixedEntrySellBooking.js";
import { fixedRowId, readFixedRowFence, fixedCoverageCas, fixedFencedProjection,
  type FixedFencedRow, type FixedRowCas } from "./fixedEntryRowFence.js";
export interface FixedMaterializedPosition extends FixedEconomicRow {
  strategist_id: string;
  occ_symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  opt_type: "call" | "put";
  opened_at: string;
  entry_reason: string;
  entry_delta: number | null;
  runner_of: null;
  channel_spec_version_id: string;
  release_manifest_id: string;
  configuration_epoch_id: string;
  peak_mark: number;
  trough_mark: number;
  peak_at: string;
  trough_at: string;
}
export interface FixedCoverageSnapshot {
  records: readonly FixedProtocolRecord[];
  positions: readonly FixedMaterializedPosition[];
  brokerNetQty: number;
  brokerObservedAtMs: number;
}
export interface FixedCoveragePorts {
  storage: ImmutableClaimStorage;
  now(): number;
  /** Must return complete paginated original-intent records AND row lineage.
   * Query errors, truncation and malformed ownership are failures, not emptiness. */
  snapshot(intent: FixedEntryIntent): Promise<FixedCoverageSnapshot>;
  readPosition(id: string): Promise<FixedMaterializedPosition | null>;
  insertPosition(row: FixedMaterializedPosition): Promise<"inserted" | "existing" | "unknown">;
  cas(change: FixedRowCas): Promise<unknown>;
}
export interface FixedCoverageMaterializationReceipt {
  protocol: "fixed-coverage-materialization-v1";
  intentId: string;
  rowId: string;
  generation: number;
  revision: number;
  boughtQty: number;
  soldQty: number;
  cumulativeBuyCost: string;
  closedEntryCost: string;
  databaseBasis: string;
  basisRoundingResidual: string;
  ledgerEvidenceHash: string;
  positionHash: string;
}
export interface FixedCoverageResult {
  state: "covered" | "known-flat" | "unresolved";
  reason: string;
  position: FixedMaterializedPosition | null;
  receipt: FixedProtocolRecord | null;
  unprovenBrokerQty: number;
  unresolvedBuyCommands: string[];
}
function fail(reason: string): FixedCoverageResult {
  return { state: "unresolved", reason, position: null, receipt: null, unprovenBrokerQty: 0, unresolvedBuyCommands: [] };
}
export function fixedPositionIdentityMatches(intent: FixedEntryIntent, row: FixedMaterializedPosition): boolean {
  try {
    return readFixedRowFence(row).intentId === intent.id && row.strategist_id === intent.strategistId
      && row.occ_symbol === intent.occ && row.underlying === intent.underlying
      && row.opt_type === intent.optionSide && row.expiration === intent.sessionDateEt
      && row.strike === Number(intent.occ.slice(-8)) / 1000 && row.runner_of === null
      && row.channel_spec_version_id === intent.writeStamp.channel_spec_version_id
      && row.release_manifest_id === intent.writeStamp.release_manifest_id
      && row.configuration_epoch_id === intent.writeStamp.configuration_epoch_id
      && row.entry_reason === intent.reason && Number.isFinite(Date.parse(row.opened_at))
      && canonicalJson(row.entry_features.configuration_identity) === canonicalJson(intent.writeStamp.configuration_identity)
      && canonicalJson(row.entry_features.receipt_bound_entry_policy) === canonicalJson(intent.writeStamp.entry_policy);
  } catch { return false; }
}
/** Quote/MFE display updates do not change ownership evidence. */
export function fixedPositionCoverageHash(row: FixedMaterializedPosition): string {
  return fixedLedgerHash({ ...fixedFencedProjection(row), strategist_id: row.strategist_id,
    occ_symbol: row.occ_symbol, underlying: row.underlying, expiration: row.expiration, strike: row.strike,
    opt_type: row.opt_type, opened_at: new Date(row.opened_at).toISOString(), entry_reason: row.entry_reason,
    runner_of: row.runner_of, channel_spec_version_id: row.channel_spec_version_id,
    release_manifest_id: row.release_manifest_id, configuration_epoch_id: row.configuration_epoch_id });
}
function ledgerEconomics(plan: FixedCoveragePlan) {
  return { boughtQty: plan.boughtQty, soldQty: plan.soldQty, cumulativeBuyCost: plan.cumulativeBuyCost,
    closedEntryCost: plan.closedEntryCost, databaseBasis: plan.databaseBasis!, basisRoundingResidual: plan.basisRoundingResidual };
}
function receiptMatches(record: FixedProtocolRecord | null, intent: FixedEntryIntent,
  row: FixedMaterializedPosition, plan: FixedCoveragePlan): boolean {
  try {
    if (!record) return false;
    const coverage = record.body.coverage as FixedCoverageMaterializationReceipt;
    const fence = readFixedRowFence(row);
    const marker = row.entry_features.fixed_entry_materialization as { receiptId: string; ledgerEvidenceHash: string };
    const { protocol, intentId, rowId, generation, revision, ledgerEvidenceHash, positionHash, ...economic } = coverage;
    return record.kind === "settlement" && record.intentId === intent.id && record.id === marker.receiptId
      && record.id === fixedLedgerId("coverage", [row.id, fence.revision])
      && protocol === "fixed-coverage-materialization-v1" && intentId === intent.id && rowId === row.id
      && generation === fence.generation && revision === fence.revision
      && /^sha256:[0-9a-f]{64}$/.test(ledgerEvidenceHash) && ledgerEvidenceHash === marker.ledgerEvidenceHash
      && positionHash === fixedPositionCoverageHash(row)
      && canonicalJson(economic) === canonicalJson(ledgerEconomics(plan));
  } catch { return false; }
}
function newPosition(intent: FixedEntryIntent, generation: number, plan: Pick<FixedCoveragePlan, "netQty" | "databaseBasis">,
  firstFillObservedAt: string, ledgerEvidenceHash: string): FixedMaterializedPosition {
  const basis = Number(plan.databaseBasis);
  const id = fixedRowId(intent.id, generation);
  const evidence = structuredClone(intent.evidence);
  // Protocol and original-policy keys cannot be injected from signal features.
  for (const key of Object.keys(evidence)) if (key.startsWith("fixed_entry_")) delete evidence[key];
  return { id, status: "open", strategist_id: intent.strategistId, occ_symbol: intent.occ,
    underlying: intent.underlying, expiration: intent.sessionDateEt, strike: Number(intent.occ.slice(-8)) / 1000,
    opt_type: intent.optionSide, qty: plan.netQty, avg_entry_price: basis,
    current_mark: basis, realized_pnl: null, unrealized_pnl: 0, closed_at: null, close_reason: null,
    opened_at: firstFillObservedAt, entry_reason: intent.reason, entry_delta: null, runner_of: null,
    channel_spec_version_id: intent.writeStamp.channel_spec_version_id,
    release_manifest_id: intent.writeStamp.release_manifest_id, configuration_epoch_id: intent.writeStamp.configuration_epoch_id,
    peak_mark: basis, trough_mark: basis, peak_at: firstFillObservedAt, trough_at: firstFillObservedAt,
    entry_features: { ...evidence, opportunity_id: intent.opportunityId,
      configuration_identity: structuredClone(intent.writeStamp.configuration_identity),
      receipt_bound_entry_policy: structuredClone(intent.writeStamp.entry_policy),
      rc54_manager_profile: intent.writeStamp.configuration_identity.managerProfileId,
      fixed_entry_coverage: { protocol: "fixed-entry-row-v1", intentId: intent.id,
        generation, revision: 0, activeSellCommandId: null },
      fixed_entry_materialization: { protocol: "fixed-entry-materialization-v1",
        receiptId: fixedLedgerId("coverage", [id, 0]), ledgerEvidenceHash,
        openedAtSource: "fill-observed-at", originalSignalAt: intent.sourceBarAt,
        logicalEntryId: intent.id, rootPositionId: fixedRowId(intent.id, 0) } } };
}
/** Reconstruct the immutable FIRST materialization from its receipt, not the
 * current row's quantity/basis (which can grow or be partially booked). The
 * original position hash must match exactly before reporting an opening. */
export function fixedOriginalMaterialization(intent: FixedEntryIntent, current: FixedMaterializedPosition,
  records: readonly FixedProtocolRecord[]): { row: FixedMaterializedPosition; receipt: FixedProtocolRecord } {
  if (!fixedPositionIdentityMatches(intent, current)) throw new Error("fixed_reporting:row_identity");
  const generation = readFixedRowFence(current).generation;
  const inventory = inspectFixedEntryInventory(intent, records);
  const receipt = inventory.records.get(fixedLedgerId("coverage", [current.id, 0]));
  const c = receipt?.body.coverage as FixedCoverageMaterializationReceipt | undefined;
  if (!receipt || receipt.kind !== "settlement" || !c || c.protocol !== "fixed-coverage-materialization-v1"
      || c.intentId !== intent.id || c.rowId !== current.id || c.generation !== generation || c.revision !== 0
      || !Number.isSafeInteger(c.boughtQty) || !Number.isSafeInteger(c.soldQty)
      || c.boughtQty > 4 || c.soldQty < 0 || c.boughtQty <= c.soldQty
      || !Number.isFinite(Number(c.databaseBasis)) || Number(c.databaseBasis) <= 0
      || !/^sha256:[0-9a-f]{64}$/.test(c.ledgerEvidenceHash)) throw new Error("fixed_reporting:first_coverage_missing_or_invalid");
  const row = newPosition(intent, generation, { netQty: c.boughtQty - c.soldQty, databaseBasis: c.databaseBasis },
    current.opened_at, c.ledgerEvidenceHash);
  if (fixedPositionCoverageHash(row) !== c.positionHash) throw new Error("fixed_reporting:first_coverage_hash_mismatch");
  return { row, receipt };
}
export async function materializeFixedEntryCoverage(ports: FixedCoveragePorts,
  originalIntent: FixedEntryIntent): Promise<FixedCoverageResult> {
  const intent = structuredClone(originalIntent);
  try {
    const original = await readFixedProtocolRecord(ports.storage, intent, intent.id);
    if (canonicalJson(original?.body.intent) !== canonicalJson(intent)) return fail("original-intent-not-durable");
    const snapshot = structuredClone(await ports.snapshot(structuredClone(intent)));
    const inventory = inspectFixedEntryInventory(intent, snapshot.records);
    const age = ports.now() - snapshot.brokerObservedAtMs;
    if (!Number.isSafeInteger(snapshot.brokerNetQty) || snapshot.brokerNetQty < 0 || snapshot.brokerNetQty > 4
        || !Number.isFinite(age) || age < 0 || age > 2_000) return fail("holdings-unavailable-or-stale");
    const positions = [...snapshot.positions].sort((a, b) => readFixedRowFence(a).generation - readFixedRowFence(b).generation);
    if (positions.some((row, index) => !fixedPositionIdentityMatches(intent, row)
        || readFixedRowFence(row).generation !== index)) return fail("position-lineage-or-policy-invalid");
    const unresolvedBuyCommands: string[] = [];
    for (const fact of inventory.facts) {
      if (fact.command.side === "buy") { if (!fact.terminal) unresolvedBuyCommands.push(fact.command.id); continue; }
      if (!fact.terminal || !fact.booking) return fail("sell-must-be-terminal-and-booked-first");
      const book = fact.booking.body.booking as FixedSellBookingReceipt;
      if (book.soldQty > 0) {
        const closed = positions.find(row => row.id === book.rowId);
        if (!closed || closed.status !== "closed" || fixedBookedRowHash(closed) !== book.bookedRowHash) return fail("closed-booking-drift");
      }
    }
    const known = inventory.facts.map(f => ({ fact: f, fill: fixedFactCoverageFill(f) })).filter(x => x.fill !== null);
    const fills = known.map(x => x.fill!);
    const bought = fills.filter(f => f.side === "buy").reduce((n, f) => n + f.filledQty, 0);
    const sold = fills.filter(f => f.side === "sell").reduce((n, f) => n + f.filledQty, 0);
    if (snapshot.brokerNetQty < bought - sold) return fail("broker-attribution-mismatch");
    const plan = planFixedEntryCoverage({ intentId: intent.id, commands: known.map(x => x.fact.command), fills,
      rows: positions.map(row => ({ id: row.id, intentId: intent.id, status: row.status as "open" | "closed",
        qty: row.qty, avgEntryPrice: String(row.avg_entry_price) })), brokerNetQty: bought - sold });
    if (plan.state !== "ready") return fail(`coverage:${plan.blockers.join(",")}`);
    const unprovenBrokerQty = snapshot.brokerNetQty - plan.netQty;
    if (plan.netQty === 0) return { ...fail(unprovenBrokerQty ? "unproven-broker-exposure" : "proven-net-flat"),
      state: unprovenBrokerQty ? "unresolved" : "known-flat", unprovenBrokerQty, unresolvedBuyCommands };
    let position = positions.find(row => row.status === "open") ?? null;
    if (position && readFixedRowFence(position).activeSellCommandId !== null) return fail("sell-reservation-owns-row");
    const ledgerEvidenceHash = fixedLedgerHash(inventory.facts.map(f => ({ command: f.record.contentHash,
      terminal: f.terminal?.contentHash ?? null, floor: f.floor?.contentHash ?? null, booking: f.booking?.contentHash ?? null })));
    if (position && !plan.coverageRequired) {
      const marker = position.entry_features.fixed_entry_materialization as { receiptId?: string } | undefined;
      const prior = marker?.receiptId ? await readFixedProtocolRecord(ports.storage, intent, marker.receiptId) : null;
      if (receiptMatches(prior, intent, position, plan)) return { state: "covered", reason: "existing-verified-coverage",
        position, receipt: prior, unprovenBrokerQty, unresolvedBuyCommands };
    }
    let expected: FixedMaterializedPosition;
    if (position) {
      const change = fixedCoverageCas(position, plan.netQty, Number(plan.databaseBasis));
      const next = { ...position, ...change.update } as FixedMaterializedPosition;
      const fence = readFixedRowFence(next);
      next.entry_features.fixed_entry_materialization = { ...(position.entry_features.fixed_entry_materialization as object),
        protocol: "fixed-entry-materialization-v1", receiptId: fixedLedgerId("coverage", [next.id, fence.revision]), ledgerEvidenceHash };
      change.update.entry_features = next.entry_features;
      expected = structuredClone(next);
      await ports.cas(structuredClone(change));
    } else {
      const positiveTimes = inventory.facts.filter(f => f.command.side === "buy").flatMap(f => {
        const times: string[] = [];
        // A failed first insert followed by later fills must retain the earliest
        // proven observation, not move entry time to the highest quantity floor.
        for (let qty = 1; qty <= f.command.quantity; qty++) {
          const r = inventory.records.get(fixedLedgerId("fill-floor", [f.command.id, qty]));
          if (r) times.push(r.recordedAt);
        }
        if ((f.provenFill?.filledQty ?? 0) > 0 && f.terminal) times.push(f.terminal.recordedAt);
        return times;
      });
      const firstFillObservedAt = positions[0]?.opened_at ?? positiveTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
      if (!firstFillObservedAt) return fail("positive-fill-time-evidence-missing");
      expected = newPosition(intent, positions.length, plan, firstFillObservedAt, ledgerEvidenceHash);
      await ports.insertPosition(structuredClone(expected));
    }
    position = await ports.readPosition(expected.id);
    if (!position || !fixedPositionIdentityMatches(intent, position)
        || fixedPositionCoverageHash(position) !== fixedPositionCoverageHash(expected)) return fail("position-write-readback-unconfirmed");
    const fence = readFixedRowFence(position);
    const receipt = fixedProtocolRecord({ id: fixedLedgerId("coverage", [position.id, fence.revision]), intentId: intent.id,
      kind: "settlement", recordedAt: new Date(ports.now()).toISOString(), body: { coverage: {
        protocol: "fixed-coverage-materialization-v1", intentId: intent.id, rowId: position.id,
        generation: fence.generation, revision: fence.revision, ...ledgerEconomics(plan), ledgerEvidenceHash,
        positionHash: fixedPositionCoverageHash(position) } satisfies FixedCoverageMaterializationReceipt } });
    await claimFixedProtocolRecord(ports.storage, fixedProtocolObservation(intent, receipt));
    const verified = await readFixedProtocolRecord(ports.storage, intent, receipt.id);
    if (!receiptMatches(verified, intent, position, plan)) return fail("coverage-receipt-unconfirmed");
    return { state: "covered", reason: "coverage-materialized-and-verified", position, receipt: verified,
      unprovenBrokerQty, unresolvedBuyCommands };
  } catch { return fail("coverage-evidence-unavailable"); }
}
