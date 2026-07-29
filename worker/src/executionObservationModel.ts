// Phase 1D pure evidence model. It turns strategy decisions and broker results
// into immutable, deterministic append-only rows. No fetches, writes, orders, or
// policy mutation live here; the runtime adapter owns best-effort persistence.

import type { ShadowDecision } from "./decide.js";
import type { ChannelConfig } from "./store.js";
import { deterministicEvidenceUuid, observedOpportunityId } from "./planShadowModel.js";
import type {
  ReceiptBoundConfigurationWriteStamp,
} from "./channelConfigurationRuntimeAdapter.js";

export type ExecutionObservationKind = "decision" | "broker_result";

export interface ExecutionObservationDraft {
  id: string;
  trace_id: string;
  schema_version: 1;
  event_kind: ExecutionObservationKind;
  event_at: string;
  source_bar_at: string;
  strategist_id: string;
  account_id: string;
  channel_slug: string;
  opportunity_id: string | null;
  position_id: string | null;
  action: "enter" | "add" | "exit" | "reconcile";
  reason: string;
  blocked_reason: string | null;
  underlying: string;
  occ_symbol: string | null;
  option_side: string | null;
  quote_source: "alpaca_snapshot" | null;
  quote_age_ms: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  underlying_price: number | null;
  requested_qty: number | null;
  client_order_id: string | null;
  broker_order_id: string | null;
  broker_status: string | null;
  filled_qty: number | null;
  fill_price: number | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  payload: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonnegativeOrNull = (value: unknown): number | null => {
  const n = numberOrNull(value);
  return n != null && n >= 0 ? n : null;
};
const deltaOrNull = (value: unknown): number | null => {
  const n = numberOrNull(value);
  return n != null && n >= -1 && n <= 1 ? n : null;
};
const integerOrNull = (value: unknown): number | null => {
  const n = numberOrNull(value);
  return n == null || n < 0 ? null : Math.trunc(n);
};
function jsonSafe(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return String(value);
}

export interface DecisionObservationInput {
  channel: Pick<ChannelConfig, "id" | "slug" | "underlying">;
  decision: ShadowDecision;
  accountId: string;
  decisionAtMs: number;
  observedAtMs: number;
  chainAgeMs: number;
  positionId?: string | null;
  configurationWriteStamp?: Readonly<ReceiptBoundConfigurationWriteStamp> | null;
}

function traceIdentity(input: DecisionObservationInput): Record<string, unknown> {
  const d = input.decision;
  const configurationEpochId =
    input.configurationWriteStamp?.configuration_epoch_id ?? null;
  return {
    strategistId: input.channel.id,
    accountId: input.accountId,
    decisionAtMs: input.decisionAtMs,
    action: d.action,
    occ: d.occ ?? null,
    reason: d.reason,
    ...(configurationEpochId ? { configurationEpochId } : {}),
  };
}

export function executionTraceId(input: DecisionObservationInput): string {
  return deterministicEvidenceUuid("seve-execution-trace-v1", traceIdentity(input));
}

export function buildDecisionObservation(input: DecisionObservationInput): ExecutionObservationDraft | null {
  const { channel: ch, decision: d } = input;
  if (d.action === "hold" || d.action === "skip") return null;
  if (!UUID.test(ch.id) || !UUID.test(input.accountId) || !ch.slug || !ch.underlying || !d.reason) return null;
  const eventAt = new Date(input.observedAtMs), sourceBarAt = new Date(input.decisionAtMs);
  if (Number.isNaN(eventAt.getTime()) || Number.isNaN(sourceBarAt.getTime())) return null;
  const traceId = executionTraceId(input);
  const opportunityId = d.action === "enter" && d.occ && d.direction
    ? observedOpportunityId({
        strategistId: ch.id, accountId: input.accountId, occ: d.occ,
        direction: d.direction, reason: d.reason, decisionAtMs: input.decisionAtMs,
        configurationEpochId:
          input.configurationWriteStamp?.configuration_epoch_id ?? null,
      })
    : null;
  const detail = (jsonSafe(d.detail ?? {}) ?? {}) as Record<string, unknown>;
  const age = Number.isFinite(input.chainAgeMs) && input.chainAgeMs >= 0 ? Math.round(input.chainAgeMs) : null;
  return {
    id: deterministicEvidenceUuid("seve-execution-observation-v1", { traceId, eventKind: "decision" }),
    trace_id: traceId,
    schema_version: 1,
    event_kind: "decision",
    event_at: eventAt.toISOString(),
    source_bar_at: sourceBarAt.toISOString(),
    strategist_id: ch.id,
    account_id: input.accountId,
    channel_slug: ch.slug,
    opportunity_id: opportunityId,
    position_id: input.positionId ?? null,
    action: d.action,
    reason: d.reason,
    blocked_reason: d.blocked ?? null,
    underlying: ch.underlying,
    occ_symbol: d.occ ?? null,
    option_side: d.direction ?? null,
    quote_source: d.occ ? "alpaca_snapshot" : null,
    // Alpaca's snapshot does not expose one authoritative per-contract source
    // timestamp here. Preserve measured snapshot age; do not invent quote_at.
    quote_age_ms: age,
    bid: nonnegativeOrNull(d.detail?.bid),
    ask: nonnegativeOrNull(d.detail?.ask),
    mid: nonnegativeOrNull(d.detail?.mid) ?? (() => {
      const bid = nonnegativeOrNull(d.detail?.bid), ask = nonnegativeOrNull(d.detail?.ask);
      return bid != null && ask != null ? (bid + ask) / 2 : null;
    })(),
    delta: deltaOrNull(d.detail?.delta),
    underlying_price: nonnegativeOrNull(d.detail?.spotClose),
    requested_qty: integerOrNull(d.qty),
    client_order_id: null,
    broker_order_id: null,
    broker_status: null,
    filled_qty: null,
    fill_price: null,
    channel_spec_version_id:
      input.configurationWriteStamp?.channel_spec_version_id ?? null,
    release_manifest_id:
      input.configurationWriteStamp?.release_manifest_id ?? null,
    configuration_epoch_id:
      input.configurationWriteStamp?.configuration_epoch_id ?? null,
    payload: {
      decisionDetail: detail,
      status: d.status,
      ...(input.configurationWriteStamp
        ? {
          configurationIdentity:
            input.configurationWriteStamp.configuration_identity,
        }
        : {}),
    },
  };
}

export interface BrokerObservationInput extends DecisionObservationInput {
  clientOrderId: string;
  brokerOrderId?: string | null;
  brokerStatus: string;
  filledQty: number;
  fillPrice: number;
  positionId?: string | null;
  error?: string | null;
}

export function buildBrokerObservation(input: BrokerObservationInput): ExecutionObservationDraft | null {
  const decision = buildDecisionObservation(input);
  const filledQty = integerOrNull(input.filledQty), fillPrice = nonnegativeOrNull(input.fillPrice);
  if (!decision || !input.clientOrderId || !input.brokerStatus || filledQty == null || fillPrice == null) return null;
  const eventKey = {
    traceId: decision.trace_id,
    eventKind: "broker_result",
    clientOrderId: input.clientOrderId,
    brokerOrderId: input.brokerOrderId ?? null,
  };
  return {
    ...decision,
    id: deterministicEvidenceUuid("seve-execution-observation-v1", eventKey),
    event_kind: "broker_result",
    position_id: input.positionId ?? null,
    client_order_id: input.clientOrderId,
    broker_order_id: input.brokerOrderId ?? null,
    broker_status: input.brokerStatus,
    filled_qty: filledQty,
    fill_price: fillPrice,
    payload: {
      ...decision.payload,
      error: input.error ?? null,
    },
  };
}
