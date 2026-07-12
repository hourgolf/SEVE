import { deterministicEvidenceUuid } from "../evidence/identity";

export type PositionOutcomeKind = "position_opened" | "position_remainder_opened" | "position_booked"
  | "reconciliation_unresolved" | "reconciliation_estimated" | "manual_reason_tagged";

export interface PositionOutcomeDraft {
  id: string; schema_version: 1; event_kind: PositionOutcomeKind; event_at: string;
  position_id: string; parent_position_id: string | null; plan_id: string | null;
  opportunity_id: string | null; quantity: number | null; avg_entry_price: number | null;
  exit_price: number | null; realized_pnl: number | null; close_reason: string | null;
  payload: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) ? n : null;

export interface PositionOutcomeInput {
  eventKind: PositionOutcomeKind; eventAtMs: number; positionId: string;
  parentPositionId?: string | null; opportunityId?: string | null; quantity?: number | null;
  avgEntryPrice?: number | null; exitPrice?: number | null; realizedPnl?: number | null;
  closeReason?: string | null; payload?: Record<string, unknown>;
}

export function buildPositionOutcome(input: PositionOutcomeInput): PositionOutcomeDraft | null {
  const at = new Date(input.eventAtMs);
  if (!UUID.test(input.positionId) || Number.isNaN(at.getTime())) return null;
  if (input.parentPositionId && !UUID.test(input.parentPositionId)) return null;
  const opportunityId = input.opportunityId?.startsWith("opp:") ? input.opportunityId : null;
  const quantity = finite(input.quantity), avgEntry = finite(input.avgEntryPrice);
  const exitPrice = finite(input.exitPrice), realized = finite(input.realizedPnl);
  if (quantity != null && (!Number.isInteger(quantity) || quantity < 0)) return null;
  if ((avgEntry != null && avgEntry < 0) || (exitPrice != null && exitPrice < 0)) return null;
  const closeReason = input.closeReason ?? null;
  const identity = { eventKind: input.eventKind, positionId: input.positionId,
    parentPositionId: input.parentPositionId ?? null, quantity, exitPrice, realized, closeReason };
  return {
    id: deterministicEvidenceUuid("seve-position-outcome-v1", identity), schema_version: 1,
    event_kind: input.eventKind, event_at: at.toISOString(), position_id: input.positionId,
    parent_position_id: input.parentPositionId ?? null,
    plan_id: opportunityId ? deterministicEvidenceUuid("seve-position-plan-v1", opportunityId) : null,
    opportunity_id: opportunityId, quantity, avg_entry_price: avgEntry, exit_price: exitPrice,
    realized_pnl: realized, close_reason: closeReason, payload: input.payload ?? {},
  };
}
