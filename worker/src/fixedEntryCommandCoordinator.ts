/** One-command fixed-entry coordinator. The fresh INSERT winner can make one
 * broker POST; reading an existing claim never reconstructs that permission.
 *
 * This is deliberately not an entry signal or portfolio authorizer. The runtime
 * must supply the original finite order plan and a fresh ledger/affordability
 * guard. Each ladder rung calls this function separately. No legacy multi-POST
 * order helper may be supplied as submitOnce. Recovery uses exact coid lookup.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, parseFixedEntryIntent, validFixedCommandSlot,
  type FixedEntryIntent, type FixedOrderCommand, type FixedOrderFill } from "./fixedEntryLedgerModel.js";
import { claimFixedProtocolRecord, fixedProtocolObservation, fixedProtocolRecord,
  readFixedProtocolRecord, type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { fixedReserveSellCas, fixedFencedProjection, readFixedRowFence, type FixedFencedRow,
  type FixedRowCas } from "./fixedEntryRowFence.js";
import { persistFixedFillEvidence } from "./fixedEntryFillEvidence.js";

export interface FixedBrokerRequest {
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: "day";
  client_order_id: string;
  limit_price?: string;
}
export interface FixedBrokerOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  replaced_by?: string | null;
  filled_at?: string | null;
}
export interface FixedCommandClaim {
  command: FixedOrderCommand;
  request: FixedBrokerRequest;
  /** Guard expiry is not a lease: expiry never permits another owner to POST. */
  expiresAt: string;
  sellRow: FixedFencedRow | null;
  exitReason: string | null;
}
export interface FixedCommandResolution {
  protocol: "fixed-command-resolution-v1";
  commandId: string;
  claimHash: string;
  outcome: "broker-terminal" | "not-submitted";
  fill: FixedOrderFill | null;
  reason: "broker-terminal" | "row-reservation-failed" | "guard-rejected";
}
export interface FixedCommandPorts {
  storage: ImmutableClaimStorage;
  now(): number;
  /** Validate complete chain, native management, quote/account freshness and
   * quantity from original intent, at both preclaim and last pre-POST boundary.
   * Return false or throw on any unavailable prerequisite. */
  authorizeFresh(intent: FixedEntryIntent, claim: FixedCommandClaim): Promise<boolean>;
  /** Final synchronous local shutdown check after every awaited guard read. */
  canSubmitNow?(side:"buy"|"sell"):boolean;
  reserveSell(change: FixedRowCas): Promise<{ state: "applied" | "lost-race" | "unknown"; row: FixedFencedRow | null }>;
  /** MUST be exactly one HTTP POST without retry or internal ladder. */
  submitOnce(accountId: string, request: FixedBrokerRequest): Promise<FixedBrokerOrder>;
  /** null/404 means unknown, never terminal zero. Do not use a bounded order list. */
  lookupExact(accountId: string, clientOrderId: string): Promise<FixedBrokerOrder | null>;
}
export type FixedCommandResult = {
  state: "observed" | "resolved" | "unresolved" | "declined";
  reason: string;
  postAttempted: boolean;
  fill: FixedOrderFill | null;
  resolution: FixedProtocolRecord | null;
};
const TERMINAL = new Set(["filled", "canceled", "expired", "rejected"]);
const PRICE = /^(0|[1-9]\d{0,8})(\.\d{1,9})?$/;
const result = (state: FixedCommandResult["state"], reason: string,
  postAttempted = false, fill: FixedOrderFill | null = null,
  resolution: FixedProtocolRecord | null = null): FixedCommandResult => ({ state, reason, postAttempted, fill, resolution });

export function validateFixedCommandClaim(intent: FixedEntryIntent, value: unknown): FixedCommandClaim {
  const claim = value as FixedCommandClaim;
  if (!parseFixedEntryIntent(intent) || !claim || !validFixedCommandSlot(claim.command)
      || claim.command.kind !== "submit" || claim.command.intentId !== intent.id
      || !Number.isFinite(Date.parse(claim.expiresAt))) throw new Error("fixed_command:claim_identity");
  const r = claim.request, c = claim.command;
  if (!r || r.symbol !== intent.occ || r.qty !== String(c.quantity) || r.side !== c.side
      || r.client_order_id !== c.clientOrderId || r.time_in_force !== "day"
      || !["market", "limit"].includes(r.type)
      || (r.type === "limit" ? typeof r.limit_price !== "string" || !PRICE.test(r.limit_price)
        || Number(r.limit_price) <= 0 || Number(r.limit_price) !== Number(Number(r.limit_price).toFixed(2))
        : r.limit_price !== undefined)) throw new Error("fixed_command:request_identity");
  const keys = ["symbol", "qty", "side", "type", "time_in_force", "client_order_id",
    ...(r.type === "limit" ? ["limit_price"] : [])].sort();
  if (canonicalJson(Object.keys(r).sort()) !== canonicalJson(keys)
      || canonicalJson(Object.keys(claim).sort()) !== canonicalJson(["command", "request", "expiresAt", "sellRow", "exitReason"].sort())) {
    throw new Error("fixed_command:unknown_request_fields");
  }
  if (c.side === "sell") {
    if (!claim.sellRow || readFixedRowFence(claim.sellRow).intentId !== intent.id
        || claim.sellRow.qty !== c.quantity || typeof claim.exitReason !== "string"
        || !claim.exitReason.trim() || claim.exitReason.length > 120) throw new Error("fixed_command:sell_row_identity");
    // Validate that it is an unreserved, open row before claiming the command.
    fixedReserveSellCas(claim.sellRow, c.id);
  } else if (claim.sellRow !== null || claim.exitReason !== null) throw new Error("fixed_command:buy_has_sell_row");
  return structuredClone(claim);
}

export function fixedFillFromExactOrder(intent: FixedEntryIntent, command: FixedOrderCommand,
  order: FixedBrokerOrder): FixedOrderFill {
  if (!order || !order.id || order.client_order_id !== command.clientOrderId
      || order.symbol !== intent.occ || order.side !== command.side
      || order.qty !== String(command.quantity) || !/^[0-4]$/.test(order.filled_qty)
      || Number(order.filled_qty) > command.quantity || order.replaced_by
      || order.status === "replaced" || typeof order.status !== "string" || !order.status
      || (order.status === "filled" && Number(order.filled_qty) !== command.quantity)
      || (order.filled_at != null && !Number.isFinite(Date.parse(order.filled_at)))
      || (Number(order.filled_qty) > 0 && (typeof order.filled_avg_price !== "string"
        || !PRICE.test(order.filled_avg_price) || Number(order.filled_avg_price) <= 0))
      || (order.filled_avg_price !== null && (!PRICE.test(order.filled_avg_price)
        || Number(order.filled_avg_price) < 0))) throw new Error("fixed_command:broker_identity_or_fill");
  return { commandId: command.id, brokerOrderId: order.id, clientOrderId: order.client_order_id,
    side: command.side, requestedQty: command.quantity, filledQty: Number(order.filled_qty),
    averageFillPrice: Number(order.filled_qty) === 0 ? null : order.filled_avg_price, status: order.status,
    filledAt: order.filled_at == null ? null : new Date(order.filled_at).toISOString() };
}

export function validFixedCommandResolution(record: FixedProtocolRecord,
  claim: FixedProtocolRecord): boolean {
  const r = record.body.resolution as FixedCommandResolution | undefined;
  const c = claim.body.command as FixedOrderCommand | undefined;
  if (!r || !c || record.kind !== "settlement" || claim.kind !== "command"
      || record.id !== fixedLedgerId("terminal", [claim.id]) || record.intentId !== claim.intentId
      || r.protocol !== "fixed-command-resolution-v1" || r.commandId !== claim.id
      || r.claimHash !== claim.contentHash
      || canonicalJson(Object.keys(record.body)) !== canonicalJson(["resolution"])) return false;
  if (r.outcome === "not-submitted") return r.fill === null
    && ["row-reservation-failed", "guard-rejected"].includes(r.reason);
  const f = r.fill;
  return r.outcome === "broker-terminal" && r.reason === "broker-terminal" && !!f
    && f.commandId === c.id && f.clientOrderId === c.clientOrderId && f.side === c.side
    && f.requestedQty === c.quantity && Number.isSafeInteger(f.filledQty)
    && f.filledQty >= 0 && f.filledQty <= c.quantity && !!f.brokerOrderId
    && TERMINAL.has(f.status) && (f.status !== "filled" || f.filledQty === c.quantity)
    && (f.filledAt == null || Number.isFinite(Date.parse(f.filledAt)))
    && (f.filledQty === 0 ? f.averageFillPrice === null
      : typeof f.averageFillPrice === "string" && PRICE.test(f.averageFillPrice) && Number(f.averageFillPrice) > 0);
}

async function readRecord(ports: FixedCommandPorts, intent: FixedEntryIntent, id: string): Promise<FixedProtocolRecord | null> {
  return readFixedProtocolRecord(ports.storage, intent, id);
}
async function readResolution(ports: FixedCommandPorts, intent: FixedEntryIntent, claim: FixedProtocolRecord): Promise<FixedProtocolRecord | null> {
  const record = await readRecord(ports, intent, fixedLedgerId("terminal", [claim.id]));
  if (record && !validFixedCommandResolution(record, claim)) throw new Error("fixed_command:resolution_invalid");
  return record;
}
async function persistResolution(ports: FixedCommandPorts, intent: FixedEntryIntent,
  claim: FixedProtocolRecord, value: FixedCommandResolution): Promise<FixedProtocolRecord | null> {
  const record = fixedProtocolRecord({ id: fixedLedgerId("terminal", [claim.id]), intentId: intent.id,
    kind: "settlement", recordedAt: new Date(ports.now()).toISOString(), body: { resolution: value } });
  if (!validFixedCommandResolution(record, claim)) throw new Error("fixed_command:resolution_invalid");
  const existing = await readResolution(ports, intent, claim);
  if (existing) return canonicalJson(existing.body) === canonicalJson(record.body) ? existing : null;
  // A terminal receipt is evidence, never POST authority. Concurrent identical
  // terminal observations may differ in observation time; semantic equality is
  // sufficient here, unlike the fresh-INSERT command ownership rule.
  await claimFixedProtocolRecord(ports.storage, fixedProtocolObservation(intent, record));
  const stored = await readResolution(ports, intent, claim);
  return stored && canonicalJson(stored.body) === canonicalJson(record.body) ? stored : null;
}
async function observe(ports: FixedCommandPorts, intent: FixedEntryIntent,
  claimRecord: FixedProtocolRecord, postAttempted: boolean,
  order?: FixedBrokerOrder): Promise<FixedCommandResult> {
  const c = claimRecord.body.command as FixedOrderCommand;
  let fill: FixedOrderFill | null = null;
  try {
    // Preserve a known, validated broker fill even if the next storage read or
    // receipt write fails. Missing durability is not evidence of no exposure.
    if (order) {
      fill = fixedFillFromExactOrder(intent, c, order);
      if (!await persistFixedFillEvidence(ports.storage, intent, claimRecord, fill, new Date(ports.now()).toISOString())) {
        return result("unresolved", "fill-floor-unconfirmed-or-regressed", postAttempted, fill);
      }
    }
    const known = await readResolution(ports, intent, claimRecord);
    if (known) {
      const resolution = known.body.resolution as FixedCommandResolution;
      if (fill && canonicalJson(resolution.fill) !== canonicalJson(fill)) {
        return result("unresolved", "terminal-evidence-conflict", postAttempted, fill);
      }
      return result("resolved", resolution.outcome, postAttempted, resolution.fill, known);
    }
    if (!fill) {
      const exact = await ports.lookupExact(intent.accountId, c.clientOrderId);
      if (!exact) return result("unresolved", "exact-order-unknown", postAttempted);
      fill = fixedFillFromExactOrder(intent, c, exact);
      if (!await persistFixedFillEvidence(ports.storage, intent, claimRecord, fill, new Date(ports.now()).toISOString())) {
        return result("unresolved", "fill-floor-unconfirmed-or-regressed", postAttempted, fill);
      }
    }
    if (!TERMINAL.has(fill.status)) return result("observed", "broker-order-working", postAttempted, fill);
    const resolution = await persistResolution(ports, intent, claimRecord, {
      protocol: "fixed-command-resolution-v1", commandId: c.id, claimHash: claimRecord.contentHash,
      outcome: "broker-terminal", fill, reason: "broker-terminal" });
    return resolution ? result("resolved", "broker-terminal", postAttempted, fill, resolution)
      : result("unresolved", "terminal-receipt-unconfirmed", postAttempted, fill);
  } catch { return result("unresolved", "command-evidence-unavailable", postAttempted, fill); }
}

/** Safe to call concurrently or after restart. The returned result NEVER
 * contains a reusable submission capability. Unknown outcomes stay unresolved. */
export async function coordinateFixedCommand(ports: FixedCommandPorts, originalIntent: FixedEntryIntent,
  proposed: FixedCommandClaim): Promise<FixedCommandResult> {
  const intent = structuredClone(originalIntent);
  const claim = validateFixedCommandClaim(intent, proposed);
  let postAttempted = false;
  try {
    const intentRecord = await readRecord(ports, intent, intent.id);
    if (intentRecord?.kind !== "intent" || canonicalJson(intentRecord.body.intent) !== canonicalJson(intent)) {
      return result("declined", "original-intent-not-durable");
    }
    let record = await readRecord(ports, intent, claim.command.id);
    if (record) {
      if (record.intentId !== intent.id || record.kind !== "command") return result("unresolved", "command-slot-conflict");
      if ((record.body.command as { kind?: string }).kind === "buy-seal") return result("declined", "buy-plan-sealed");
      validateFixedCommandClaim(intent, record.body);
      return await observe(ports, intent, record, false);
    }
    if (ports.now() >= Date.parse(claim.expiresAt)
        || !await ports.authorizeFresh(structuredClone(intent), structuredClone(claim))) {
      return result("declined", "guard-rejected-before-claim");
    }
    record = fixedProtocolRecord({ id: claim.command.id, intentId: intent.id, kind: "command",
      recordedAt: new Date(ports.now()).toISOString(), body: { ...claim } });
    const won = await claimFixedProtocolRecord(ports.storage, fixedProtocolObservation(intent, record));
    if (!won.submissionAuthority) {
      // Even if this is the exact payload we just inserted, an ambiguous INSERT
      // must never be promoted into fresh submission permission by readback.
      const stored = await readRecord(ports, intent, claim.command.id);
      if (!stored || stored.kind !== "command" || stored.intentId !== intent.id) return result("unresolved", "claim-unconfirmed");
      if ((stored.body.command as { kind?: string }).kind === "buy-seal") return result("declined", "buy-plan-sealed");
      validateFixedCommandClaim(intent, stored.body);
      return await observe(ports, intent, stored, false);
    }
    const abandon = async (reason: "row-reservation-failed" | "guard-rejected") => {
      // Only this acknowledged winner reaches here; this branch returns without
      // ever calling POST. A restart cannot infer this proof from an absent order.
      const settled = await persistResolution(ports, intent, record!, {
        protocol: "fixed-command-resolution-v1", commandId: claim.command.id,
        claimHash: record!.contentHash, outcome: "not-submitted", fill: null, reason });
      return settled ? result("resolved", reason, false, null, settled)
        : result("unresolved", "not-submitted-receipt-unconfirmed");
    };
    if (claim.sellRow) {
      let reserved: Awaited<ReturnType<FixedCommandPorts["reserveSell"]>>;
      try { reserved = await ports.reserveSell(fixedReserveSellCas(claim.sellRow, claim.command.id)); }
      catch { return await abandon("row-reservation-failed"); }
      const expected = fixedReserveSellCas(claim.sellRow, claim.command.id);
      if (reserved.state !== "applied" || !reserved.row
          || canonicalJson(fixedFencedProjection(reserved.row)) !== canonicalJson(fixedFencedProjection(
            { ...expected.expected, ...expected.update } as FixedFencedRow))) {
        return await abandon("row-reservation-failed");
      }
    }
    let authorized = false;
    try { authorized = await ports.authorizeFresh(structuredClone(intent), structuredClone(claim)); } catch { /* No POST. */ }
    let locallyEnabled=false;
    try {locallyEnabled=ports.canSubmitNow ? ports.canSubmitNow(claim.command.side)===true : true;}catch{/* No POST. */}
    if (!authorized || !locallyEnabled || ports.now() >= Date.parse(claim.expiresAt)) return await abandon("guard-rejected");
    // There is exactly one call site. Never retry this POST, including after
    // timeout, malformed response, cancellation ambiguity or a subsequent 404.
    postAttempted = true;
    let submitted: FixedBrokerOrder;
    try { submitted = await ports.submitOnce(intent.accountId, structuredClone(claim.request)); }
    catch { return await observe(ports, intent, record, true); }
    return await observe(ports, intent, record, true, submitted);
  } catch {
    // Do not expose broker errors or authentication data in protocol/UI results.
    return result("unresolved", "protocol-or-broker-evidence-unavailable", postAttempted);
  }
}
