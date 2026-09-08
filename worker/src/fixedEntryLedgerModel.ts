/** Pure fixed-MACD recovery model. No broker calls or persistence. An intent
 * records the original policy; neither a restart nor the current roster may
 * reinterpret it. Command claims and row CAS belong to the runtime adapter. */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import type { ReceiptBoundConfigurationWriteStamp } from "./channelConfigurationRuntimeAdapter.js";
import { parseReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";
import { parseFixedEntryExecutionPlan, type FixedEntryExecutionPlan } from "./fixedEntryExecutionPlan.js";

export const FIXED_ENTRY_PROTOCOL = "fixed-entry-intent-v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCALE = 1_000_000_000n;
const DB_PRICE_UNIT = 100_000n; // positions.avg_entry_price is numeric(10,4)
const TERMINAL = new Set(["filled", "canceled", "expired", "rejected"]);
function requireFact(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`fixed_entry:${reason}`);
}
export function fixedLedgerHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export function fixedLedgerId(namespace: string, parts: readonly (string | number)[]): string {
  const h = createHash("sha256").update(canonicalJson([FIXED_ENTRY_PROTOCOL, namespace, ...parts])).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function quantity(value: number, label: string, allowZero = true): void {
  requireFact(Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= 4, label);
}
/** Preserve broker decimal text; reject unsupported precision rather than
 * silently rounding cumulative basis before previously closed P&L is removed. */
function atoms(value: string): bigint {
  requireFact(typeof value === "string" && /^(0|[1-9]\d{0,8})(\.\d{1,9})?$/.test(value), "price_precision_or_format");
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(9, "0"));
}
function price(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return `${value / SCALE}${fraction ? `.${fraction}` : ""}`;
}
function signedPrice(value: bigint): string { return value < 0n ? `-${price(-value)}` : price(value); }
function roundedBasis(cost: bigint, qty: number): bigint {
  const denominator = BigInt(qty) * DB_PRICE_UNIT;
  return ((cost + denominator / 2n) / denominator) * DB_PRICE_UNIT;
}
/** Broker decimal text to schema mark and USD cents. Half cents round away
 * from zero, matching PostgreSQL numeric rounding; never subtract binary floats. */
export function fixedSellEconomics(entryBasis: number, soldQty: number, exitPrice: string): {
  databaseMark: number; realizedPnl: number;
} {
  quantity(soldQty, "sell_economic_quantity", false);
  const entry = atoms(String(entryBasis)), exit = atoms(exitPrice);
  requireFact(entry > 0n && exit > 0n, "sell_economic_price");
  const dollars = (exit - entry) * BigInt(soldQty) * 100n;
  const cent = SCALE / 100n;
  const magnitude = dollars < 0n ? -dollars : dollars;
  const cents = ((magnitude + cent / 2n) / cent) * (dollars < 0n ? -1n : 1n);
  return { databaseMark: Number(price(roundedBasis(exit, 1))), realizedPnl: Number(cents) / 100 };
}
export function fixedFillCost(qty: number, averagePrice: string | null): string {
  quantity(qty, "cumulative_quantity");
  if (qty === 0) { requireFact(averagePrice === null, "zero_fill_price"); return "0"; }
  requireFact(averagePrice !== null, "positive_fill_price");
  const p = atoms(averagePrice); requireFact(p > 0n, "positive_fill_price");
  return price(BigInt(qty) * p);
}
export function compareFixedDecimal(a: string, b: string): number {
  const difference = atoms(a) - atoms(b);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
/** Exact option debit in dollars, without binary multiplication at an account
 * buying-power boundary. Unsupported price precision is rejected explicitly. */
export function fixedOptionDebit(qty: number, optionPrice: string): string {
  quantity(qty, "debit_quantity", false);
  const p = atoms(optionPrice); requireFact(p > 0n, "debit_price");
  return price(p * BigInt(qty) * 100n);
}

export interface FixedEntryIntent {
  protocol: typeof FIXED_ENTRY_PROTOCOL;
  id: string;
  sessionSlotId: string;
  attempt: number;
  predecessorIntentId: string | null;
  predecessorSettlementHash: string | null;
  sessionDateEt: string;
  strategistId: string;
  accountId: string;
  slug: "vb-macd-state";
  underlying: "SPY";
  occ: string;
  optionSide: "call" | "put";
  quantity: 4;
  sourceBarAt: string;
  createdAt: string;
  reason: string;
  opportunityId: string | null;
  writeStamp: ReceiptBoundConfigurationWriteStamp;
  executionPlan: FixedEntryExecutionPlan;
  evidence: Record<string, unknown>;
  contentHash: string;
}
export function buildFixedEntryIntent(input: Omit<FixedEntryIntent,
  "protocol" | "id" | "sessionSlotId" | "contentHash">): FixedEntryIntent {
  requireFact(UUID.test(input.strategistId) && UUID.test(input.accountId), "identity");
  requireFact(input.accountId === "56daa293-e6bc-447d-83ac-2bfafb4d0ac1"
    && input.slug === "vb-macd-state" && input.underlying === "SPY" && input.quantity === 4, "scope");
  requireFact(Number.isSafeInteger(input.attempt) && input.attempt >= 0, "attempt");
  requireFact(input.attempt === 0
    ? input.predecessorIntentId === null && input.predecessorSettlementHash === null
    : UUID.test(input.predecessorIntentId ?? "") && /^sha256:[0-9a-f]{64}$/.test(input.predecessorSettlementHash ?? ""), "intent_predecessor");
  requireFact(/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDateEt), "session_date");
  requireFact(Number.isFinite(Date.parse(input.sourceBarAt)) && Number.isFinite(Date.parse(input.createdAt)), "timestamps");
  const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(input.sourceBarAt));
  const part = (type: string) => et.find(p => p.type === type)?.value;
  requireFact(`${part("year")}-${part("month")}-${part("day")}` === input.sessionDateEt
    && Date.parse(input.createdAt) >= Date.parse(input.sourceBarAt), "source_session");
  const date = input.sessionDateEt.replaceAll("-", "").slice(2);
  requireFact(new RegExp(`^SPY${date}${input.optionSide === "call" ? "C" : "P"}\\d{8}$`).test(input.occ), "contract");
  requireFact(input.optionSide === "call" || input.optionSide === "put", "side");
  const stamp = input.writeStamp;
  const policy = parseReceiptBoundEntryPolicy(stamp.entry_policy);
  requireFact(policy?.policyVersion === "receipt-bound-entry-policy-v3" && policy.fixedContractAdmission, "original_policy");
  requireFact(UUID.test(stamp.channel_spec_version_id) && UUID.test(stamp.release_manifest_id), "database_identity");
  requireFact(canonicalJson(policy.configuration) === canonicalJson(stamp.configuration_identity)
    && stamp.configuration_epoch_id === policy.configuration.configurationEpochId
    && policy.configuration.accountId === input.accountId
    && policy.configuration.channelSlug === input.slug, "policy_identity");
  requireFact(input.reason.length > 0, "entry_reason");
  requireFact(parseFixedEntryExecutionPlan(input.executionPlan), "execution_plan");
  requireFact(Date.parse(input.executionPlan.quote.observedAt) <= Date.parse(input.createdAt), "execution_quote_future");
  const sessionSlotId = fixedLedgerId("session", [input.accountId, input.slug, input.sessionDateEt]);
  const body = { ...copy(input), protocol: FIXED_ENTRY_PROTOCOL,
    // Global predecessor chaining makes a new date/OCC compete for the same
    // next slot. Midnight cannot bypass an unresolved previous command.
    sessionSlotId, id: fixedLedgerId("intent", [input.accountId, input.slug,
      input.predecessorIntentId ?? "genesis"]) };
  return { ...body, contentHash: fixedLedgerHash(body) };
}
export function parseFixedEntryIntent(value: unknown): FixedEntryIntent | null {
  try {
    const candidate = value as FixedEntryIntent;
    const { protocol: _protocol, id: _id, sessionSlotId: _slot, contentHash: _hash, ...input } = candidate;
    const rebuilt = buildFixedEntryIntent(input);
    return canonicalJson(rebuilt) === canonicalJson(candidate) ? rebuilt : null;
  } catch { return null; }
}

export interface FixedOrderCommand {
  kind: "submit";
  id: string;
  intentId: string;
  side: "buy" | "sell";
  sequence: number;
  clientOrderId: string;
  quantity: number;
}
/** IDs deliberately exclude worker, price, row revision, and exit reason.
 * Competing workers claiming the same next command must collide. */
export function fixedOrderCommand(input: {
  intentId: string; side: "buy" | "sell"; sequence: number; quantity: number;
}): FixedOrderCommand {
  requireFact(UUID.test(input.intentId), "command_intent");
  requireFact(input.side === "buy" || input.side === "sell", "command_side");
  requireFact(Number.isSafeInteger(input.sequence) && input.sequence >= 0, "command_sequence");
  quantity(input.quantity, "command_quantity", false);
  const id = fixedLedgerId("command", [input.intentId, input.side, input.sequence]);
  return { kind: "submit", intentId: input.intentId, side: input.side, sequence: input.sequence,
    quantity: input.quantity, id, clientOrderId: `seve-f4-${id}` };
}
export interface FixedBuySeal {
  kind: "buy-seal";
  id: string;
  intentId: string;
  side: "buy";
  sequence: number;
  reason: "exit-required" | "buy-plan-finished";
}
/** A seal competes with the next buy for the SAME UUID. A late worker cannot
 * append a fresh rung after a winning seal, even if its snapshot predates EOD. */
export function fixedBuySeal(input: {
  intentId: string; sequence: number; reason: FixedBuySeal["reason"];
}): FixedBuySeal {
  requireFact(UUID.test(input.intentId) && Number.isSafeInteger(input.sequence)
    && input.sequence >= 0 && ["exit-required", "buy-plan-finished"].includes(input.reason), "buy_seal");
  return { kind: "buy-seal", intentId: input.intentId, side: "buy", sequence: input.sequence,
    reason: input.reason, id: fixedLedgerId("command", [input.intentId, "buy", input.sequence]) };
}
export function validFixedCommandSlot(value: unknown): value is FixedOrderCommand | FixedBuySeal {
  try {
    const c = value as FixedOrderCommand | FixedBuySeal;
    return canonicalJson(c) === canonicalJson(c.kind === "buy-seal" ? fixedBuySeal(c) : fixedOrderCommand(c));
  } catch { return false; }
}
export interface FixedOrderFill {
  commandId: string;
  brokerOrderId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  requestedQty: number;
  filledQty: number;
  averageFillPrice: string | null;
  status: string;
  /** Broker fill timestamp, when supplied. Missing is not an observed fill time. */
  filledAt?: string | null;
}
export interface FixedCoverageRow {
  id: string;
  intentId: string;
  status: "open" | "closed";
  qty: number;
  avgEntryPrice: string;
}
export interface FixedCoveragePlan {
  state: "ready" | "unresolved";
  blockers: string[];
  boughtQty: number;
  soldQty: number;
  netQty: number;
  buyTerminal: boolean;
  sellTerminal: boolean;
  sessionEntryConsumed: boolean;
  cumulativeBuyCost: string;
  closedEntryCost: string;
  remainingEntryCost: string;
  /** Exact rational basis. Adapter must record numerator/divisor and validate
   * database rounding; it must never rewrite a closed row's entry basis. */
  remainingBasis: { numerator: string; divisor: number } | null;
  databaseBasis: string | null;
  basisRoundingResidual: string;
  openRowId: string | null;
  coverageRequired: boolean;
}
export function planFixedEntryCoverage(input: {
  intentId: string;
  commands: readonly FixedOrderCommand[];
  fills: readonly FixedOrderFill[];
  rows: readonly FixedCoverageRow[];
  brokerNetQty: number;
  previousTotals?: { boughtQty: number; soldQty: number; cumulativeBuyCost: string };
}): FixedCoveragePlan {
  requireFact(UUID.test(input.intentId), "coverage_intent");
  quantity(input.brokerNetQty, "broker_net_quantity");
  const blockers: string[] = [];
  const commandMap = new Map(input.commands.map(c => [c.id, c]));
  requireFact(commandMap.size === input.commands.length, "duplicate_command");
  for (const c of input.commands) {
    requireFact(c.intentId === input.intentId
      && canonicalJson(c) === canonicalJson(fixedOrderCommand(c)), "command_identity");
  }
  for (const side of ["buy", "sell"] as const) {
    const seq = input.commands.filter(c => c.side === side).map(c => c.sequence).sort((a, b) => a - b);
    requireFact(seq.every((n, index) => n === index), "command_sequence_gap");
  }
  const fillMap = new Map(input.fills.map(f => [f.commandId, f]));
  requireFact(fillMap.size === input.fills.length
    && new Set(input.fills.map(f => f.brokerOrderId)).size === input.fills.length, "duplicate_fill");
  let boughtQty = 0, soldQty = 0, buyCost = 0n;
  for (const f of input.fills) {
    const c = commandMap.get(f.commandId);
    requireFact(c && f.brokerOrderId && f.clientOrderId === c.clientOrderId
      && f.side === c.side && f.requestedQty === c.quantity, "unattributed_fill");
    quantity(f.filledQty, "fill_quantity");
    requireFact(f.filledQty <= c.quantity, "order_overfill");
    requireFact(f.status !== "filled" || f.filledQty === c.quantity, "filled_status_quantity");
    const p = f.averageFillPrice == null ? 0n : atoms(f.averageFillPrice);
    requireFact(f.filledQty === 0 || p > 0n, "missing_fill_price");
    if (f.side === "buy") { boughtQty += f.filledQty; buyCost += BigInt(f.filledQty) * p; }
    else soldQty += f.filledQty;
  }
  requireFact(boughtQty <= 4 && soldQty <= boughtQty, "intent_overfill_or_oversell");
  if (input.previousTotals) {
    quantity(input.previousTotals.boughtQty, "previous_bought_quantity");
    quantity(input.previousTotals.soldQty, "previous_sold_quantity");
    if (boughtQty < input.previousTotals.boughtQty || soldQty < input.previousTotals.soldQty
        || buyCost < atoms(input.previousTotals.cumulativeBuyCost)) blockers.push("cumulative-fill-regression");
  }
  const terminal = (side: "buy" | "sell") => input.commands.filter(c => c.side === side)
    .every(c => TERMINAL.has(fillMap.get(c.id)?.status ?? "unknown"));
  const buyTerminal = input.commands.some(c => c.side === "buy") && terminal("buy");
  const sellTerminal = terminal("sell");
  if (input.commands.some(c => !fillMap.has(c.id))) blockers.push("unknown-command-outcome");
  if (!sellTerminal) blockers.push("sell-not-terminal");
  const netQty = boughtQty - soldQty;
  if (input.brokerNetQty !== netQty) blockers.push("broker-attribution-mismatch");
  requireFact(new Set(input.rows.map(r => r.id)).size === input.rows.length, "duplicate_row");
  let closedQty = 0, closedCost = 0n;
  const openRows: FixedCoverageRow[] = [];
  for (const row of input.rows) {
    requireFact(UUID.test(row.id) && row.intentId === input.intentId, "row_lineage");
    quantity(row.qty, "row_quantity", false);
    const basis = atoms(row.avgEntryPrice); requireFact(basis > 0n, "row_basis");
    if (row.status === "closed") { closedQty += row.qty; closedCost += BigInt(row.qty) * basis; }
    else { requireFact(row.status === "open", "row_status"); openRows.push(row); }
  }
  if (openRows.length > 1) blockers.push("multiple-open-rows");
  if (closedQty !== soldQty) blockers.push("sell-booking-incomplete");
  const remainingCost = buyCost - closedCost;
  // Closed database rows retain their original four-decimal basis. Account
  // explicitly for its bounded rounding; do not rewrite historical P&L to
  // force exact equality with a higher-precision cumulative broker average.
  const closedRoundingBound = BigInt(closedQty) * DB_PRICE_UNIT / 2n;
  if ((netQty > 0 && remainingCost <= 0n)
      || (netQty === 0 && (remainingCost < -closedRoundingBound || remainingCost > closedRoundingBound))) {
    blockers.push("remaining-basis-inconsistent");
  }
  const databaseBasis = netQty > 0 && remainingCost > 0n ? roundedBasis(remainingCost, netQty) : null;
  const openRow = openRows.length === 1 ? openRows[0] : null;
  if (openRow) {
    // Economic coverage can only grow between sells. Shrinking/rebasing down
    // from a stale broker snapshot would discard already-known contracts/cost.
    const materializedCost = closedCost + atoms(openRow.avgEntryPrice) * BigInt(openRow.qty);
    const roundingBound = BigInt(closedQty + openRow.qty) * DB_PRICE_UNIT / 2n;
    if (netQty < openRow.qty || buyCost + roundingBound < materializedCost) {
      blockers.push("materialized-fill-regression");
    }
  }
  return { state: blockers.length ? "unresolved" : "ready", blockers,
    boughtQty, soldQty, netQty, buyTerminal, sellTerminal,
    sessionEntryConsumed: boughtQty > 0,
    cumulativeBuyCost: price(buyCost), closedEntryCost: price(closedCost),
    remainingEntryCost: remainingCost < 0n ? "invalid" : price(remainingCost),
    remainingBasis: netQty > 0 && remainingCost > 0n ? { numerator: price(remainingCost), divisor: netQty } : null,
    databaseBasis: databaseBasis == null ? null : price(databaseBasis),
    basisRoundingResidual: signedPrice(remainingCost - (databaseBasis ?? 0n) * BigInt(netQty)),
    openRowId: openRow?.id ?? null,
    coverageRequired: netQty !== (openRow?.qty ?? 0)
      || (openRow != null && atoms(openRow.avgEntryPrice) !== databaseBasis) };
}
