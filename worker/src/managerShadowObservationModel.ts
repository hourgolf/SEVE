// Observation-only adapter from a causal manager exit into the existing Phase
// 1D append-only evidence contract. Identity excludes trigger time/reason so the
// first successfully inserted exit for (position, manager, policy version) wins
// across retries and worker restarts.

import { deterministicEvidenceUuid } from "./planShadowModel.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import type { ChannelConfig, PositionRow } from "./store.js";
import { MANAGER_POLICY_VERSION, type ManagerExit } from "../../engine/managerPolicy.js";

export const SHADOW_MANAGER_COHORT_FROM = "2026-07-13T00:00:00-04:00";

export interface ManagerShadowObservationInput {
  channel: Pick<ChannelConfig, "id" | "slug" | "underlying">;
  position: Pick<PositionRow, "id" | "occ_symbol" | "opt_type" | "qty" | "avg_entry_price" | "opened_at">;
  accountId: string;
  exit: ManagerExit;
  observedAtMs: number;
  quoteAgeMs: number;
  bid: number;
  mid: number | null;
  currentReturnPct: number;
  peakReturnPct: number;
  minutesHeld: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const rounded = (n: number): number => Math.round(n * 10_000) / 10_000;

export function managerShadowTraceId(input: Pick<ManagerShadowObservationInput, "position" | "exit">): string {
  return deterministicEvidenceUuid("seve-manager-shadow-trace-v1", {
    positionId: input.position.id,
    managerId: input.exit.managerId,
    managerPolicyVersion: MANAGER_POLICY_VERSION,
  });
}

export function buildManagerShadowObservation(input: ManagerShadowObservationInput): ExecutionObservationDraft | null {
  const { channel: ch, position: row, exit } = input;
  const observed = new Date(input.observedAtMs), opened = row.opened_at ? new Date(row.opened_at) : null;
  if (!UUID.test(ch.id) || !UUID.test(row.id) || !UUID.test(input.accountId) || !ch.slug || !ch.underlying
      || !row.occ_symbol || !(row.avg_entry_price > 0) || !finite(input.bid) || input.bid < 0
      || !finite(input.currentReturnPct) || !finite(input.peakReturnPct) || !finite(exit.returnPct)
      || Number.isNaN(observed.getTime()) || !opened || Number.isNaN(opened.getTime())
      || opened.getTime() < Date.parse(SHADOW_MANAGER_COHORT_FROM)) return null;
  const traceId = managerShadowTraceId(input);
  return {
    id: deterministicEvidenceUuid("seve-manager-shadow-exit-v1", { traceId }),
    trace_id: traceId,
    schema_version: 1,
    event_kind: "decision",
    event_at: observed.toISOString(),
    source_bar_at: observed.toISOString(),
    strategist_id: ch.id,
    account_id: input.accountId,
    channel_slug: ch.slug,
    opportunity_id: null,
    position_id: row.id,
    // Reuse the table's deliberately narrow action vocabulary. The required
    // observation_only block plus shadowOnly payload make this non-executable.
    action: "exit",
    reason: `${exit.managerId}:${exit.reason}`,
    blocked_reason: "observation_only",
    underlying: ch.underlying,
    occ_symbol: row.occ_symbol,
    option_side: row.opt_type,
    quote_source: "alpaca_snapshot",
    quote_age_ms: finite(input.quoteAgeMs) && input.quoteAgeMs >= 0 ? Math.round(input.quoteAgeMs) : null,
    bid: rounded(input.bid),
    ask: null,
    mid: input.mid != null && finite(input.mid) && input.mid >= 0 ? rounded(input.mid) : null,
    delta: null,
    underlying_price: null,
    requested_qty: null,
    client_order_id: null,
    broker_order_id: null,
    broker_status: null,
    filled_qty: null,
    fill_price: null,
    payload: {
      shadowOnly: true,
      managerId: exit.managerId,
      managerPolicyVersion: MANAGER_POLICY_VERSION,
      trigger: exit.reason,
      counterfactualReturnPct: rounded(exit.returnPct),
      currentReturnPct: rounded(input.currentReturnPct),
      peakReturnPct: rounded(input.peakReturnPct),
      entryBid: rounded(row.avg_entry_price),
      observedBid: rounded(input.bid),
      minutesHeld: input.minutesHeld != null && finite(input.minutesHeld) ? rounded(input.minutesHeld) : null,
      managerState: exit.state,
      cohortFrom: SHADOW_MANAGER_COHORT_FROM,
      evidenceBasis: "executable_bid",
    },
  };
}
