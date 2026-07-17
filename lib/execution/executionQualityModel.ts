// Phase 1K-F pure execution-quality receipt. This model describes what happened
// between an executable decision quote and a positive paper fill. It has no
// fetches, writes, orders, alerts, or policy authority.

import { deterministicEvidenceUuid } from "../evidence/identity";

export type ExecutionQualityTriggerKind =
  | "premium_stop"
  | "underlying_stop"
  | "target"
  | "trail"
  | "time"
  | "safety"
  | "operator"
  | "other";

export interface ExecutionQualityReceiptDraft {
  id: string;
  schema_version: 1;
  receipt_kind: "exit_fill";
  trigger_kind: ExecutionQualityTriggerKind;
  trigger_at: string;
  order_submitted_at: string;
  fill_observed_at: string;
  submission_to_fill_observed_ms: number;
  strategist_id: string;
  account_id: string;
  position_id: string;
  channel_slug: string;
  underlying: string;
  occ_symbol: string;
  option_side: "call" | "put";
  reason: string;
  client_order_id: string;
  broker_order_id: string;
  broker_status: string;
  requested_qty: number;
  filled_qty: number;
  crossed_qty: number | null;
  entry_price: number;
  decision_bid: number | null;
  decision_ask: number | null;
  decision_spread_pct: number | null;
  executable_reference_price: number | null;
  fill_price: number;
  trigger_return_pct: number | null;
  realized_return_pct: number;
  leakage_per_contract: number | null;
  leakage_usd: number | null;
  leakage_bps: number | null;
  configured_premium_stop_pct: number | null;
  configured_underlying_stop_pct: number | null;
  configured_take_profit_pct: number | null;
  threshold_overshoot_pp: number | null;
  quote_source: "alpaca_chain_snapshot";
  snapshot_age_ms: number | null;
  provider_quote_event_age_ms: number | null;
  source_version: string;
  payload: Record<string, unknown>;
}

export interface ExecutionQualityReceiptInput {
  strategistId: string;
  accountId: string;
  positionId: string;
  channelSlug: string;
  underlying: string;
  occSymbol: string;
  optionSide: "call" | "put";
  reason: string;
  triggerAtMs: number;
  submittedAtMs: number;
  fillObservedAtMs: number;
  clientOrderId: string;
  brokerOrderId: string;
  brokerStatus: string;
  requestedQty: number;
  filledQty: number;
  crossedQty?: number | null;
  entryPrice: number;
  decisionBid?: number | null;
  decisionAsk?: number | null;
  fillPrice: number;
  configuredPremiumStopPct?: number | null;
  configuredUnderlyingStopPct?: number | null;
  configuredTakeProfitPct?: number | null;
  snapshotAgeMs?: number | null;
  providerQuoteEventAgeMs?: number | null;
  sourceVersion: string;
  payload?: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const positiveInteger = (value: unknown): value is number => positive(value) && Number.isInteger(value);
const round = (value: number, places = 4): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const optionalPositive = (value: unknown): number | null => positive(value) ? round(value) : null;
const optionalAge = (value: unknown): number | null => nonnegative(value) ? Math.round(value) : null;

export function executionQualityTriggerKind(reason: string): ExecutionQualityTriggerKind {
  if (reason === "premium_stop" || reason === "stop_premium") return "premium_stop";
  if (reason === "underlying_stop") return "underlying_stop";
  if (reason === "target_premium" || reason === "target_tranche") return "target";
  if (reason === "trail_giveback" || reason === "runner_ratchet") return "trail";
  if (reason === "stall_exit" || /eod|bell/i.test(reason)) return "time";
  if (/halt|event_flatten|reconcile/i.test(reason)) return "safety";
  if (/manual|operator/i.test(reason)) return "operator";
  return "other";
}

function jsonSafe(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, jsonSafe(child)]));
  }
  return String(value);
}

/**
 * Positive leakage is adverse to the desk. Negative leakage is price improvement.
 * The current chain seam has a measured snapshot age but no authoritative
 * per-contract exchange timestamp, so provider_quote_event_age_ms may remain null.
 */
export function buildExecutionQualityReceipt(input: ExecutionQualityReceiptInput): ExecutionQualityReceiptDraft | null {
  if (!UUID.test(input.strategistId) || !UUID.test(input.accountId) || !UUID.test(input.positionId)) return null;
  if (!input.channelSlug || !input.underlying || !input.occSymbol || !input.reason
      || !input.clientOrderId || !input.brokerOrderId || !input.brokerStatus || !input.sourceVersion) return null;
  if (!positive(input.entryPrice) || !positive(input.fillPrice)
      || !positiveInteger(input.requestedQty) || !positiveInteger(input.filledQty)
      || input.filledQty > input.requestedQty) return null;
  if (![input.triggerAtMs, input.submittedAtMs, input.fillObservedAtMs].every(finite)
      || input.submittedAtMs < input.triggerAtMs || input.fillObservedAtMs < input.submittedAtMs) return null;

  const triggerAt = new Date(input.triggerAtMs);
  const submittedAt = new Date(input.submittedAtMs);
  const fillObservedAt = new Date(input.fillObservedAtMs);
  if ([triggerAt, submittedAt, fillObservedAt].some((date) => Number.isNaN(date.getTime()))) return null;

  const bid = positive(input.decisionBid) ? round(input.decisionBid) : null;
  const ask = positive(input.decisionAsk) ? round(input.decisionAsk) : null;
  const validNbbo = bid != null && ask != null && ask >= bid;
  const reference = validNbbo ? bid : null; // long-option exit sells to the bid
  const spreadPct = validNbbo && bid + ask > 0 ? round(((ask - bid) / ((ask + bid) / 2)) * 100) : null;
  const leakagePerContract = reference != null ? round(reference - input.fillPrice) : null;
  const leakageUsd = leakagePerContract != null ? round(leakagePerContract * input.filledQty * 100, 2) : null;
  const leakageBps = leakagePerContract != null && reference != null && reference > 0
    ? round((leakagePerContract / reference) * 10_000, 2)
    : null;
  const triggerReturnPct = reference != null ? round(((reference - input.entryPrice) / input.entryPrice) * 100) : null;
  const realizedReturnPct = round(((input.fillPrice - input.entryPrice) / input.entryPrice) * 100);
  const premiumStop = optionalPositive(input.configuredPremiumStopPct);
  const underlyingStop = optionalPositive(input.configuredUnderlyingStopPct);
  const takeProfit = optionalPositive(input.configuredTakeProfitPct);
  const triggerKind = executionQualityTriggerKind(input.reason);
  const overshoot = triggerKind === "premium_stop" && premiumStop != null
    ? round(Math.max(0, -premiumStop - realizedReturnPct))
    : null;
  const crossedQty = input.crossedQty == null ? null
    : nonnegative(input.crossedQty) && Number.isInteger(input.crossedQty) && input.crossedQty <= input.filledQty
      ? input.crossedQty
      : null;
  const eventKey = {
    positionId: input.positionId,
    clientOrderId: input.clientOrderId,
    brokerOrderId: input.brokerOrderId,
    filledQty: input.filledQty,
    fillPrice: input.fillPrice,
  };

  return {
    id: deterministicEvidenceUuid("seve-execution-quality-v1", eventKey),
    schema_version: 1,
    receipt_kind: "exit_fill",
    trigger_kind: triggerKind,
    trigger_at: triggerAt.toISOString(),
    order_submitted_at: submittedAt.toISOString(),
    fill_observed_at: fillObservedAt.toISOString(),
    submission_to_fill_observed_ms: Math.round(input.fillObservedAtMs - input.submittedAtMs),
    strategist_id: input.strategistId,
    account_id: input.accountId,
    position_id: input.positionId,
    channel_slug: input.channelSlug,
    underlying: input.underlying,
    occ_symbol: input.occSymbol,
    option_side: input.optionSide,
    reason: input.reason,
    client_order_id: input.clientOrderId,
    broker_order_id: input.brokerOrderId,
    broker_status: input.brokerStatus,
    requested_qty: input.requestedQty,
    filled_qty: input.filledQty,
    crossed_qty: crossedQty,
    entry_price: round(input.entryPrice),
    decision_bid: bid,
    decision_ask: ask,
    decision_spread_pct: spreadPct,
    executable_reference_price: reference,
    fill_price: round(input.fillPrice),
    trigger_return_pct: triggerReturnPct,
    realized_return_pct: realizedReturnPct,
    leakage_per_contract: leakagePerContract,
    leakage_usd: leakageUsd,
    leakage_bps: leakageBps,
    configured_premium_stop_pct: premiumStop,
    configured_underlying_stop_pct: underlyingStop,
    configured_take_profit_pct: takeProfit,
    threshold_overshoot_pp: overshoot,
    quote_source: "alpaca_chain_snapshot",
    snapshot_age_ms: optionalAge(input.snapshotAgeMs),
    provider_quote_event_age_ms: optionalAge(input.providerQuoteEventAgeMs),
    source_version: input.sourceVersion,
    payload: (jsonSafe(input.payload ?? {}) ?? {}) as Record<string, unknown>,
  };
}
