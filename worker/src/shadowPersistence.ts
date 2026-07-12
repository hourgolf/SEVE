import type { ManagedState } from "../../engine/manage";

export interface TrackedShadowState {
  slug: string;
  occ: string;
  sym: string;
  st: ManagedState;
  managedPnl: number;
  managedClosed: boolean;
  lastReason?: string;
  truncated: boolean;
  actualPnl?: number;
}

export interface DurableShadowRow {
  position_id: string;
  slug: string;
  occ_symbol: string;
  underlying: string;
  managed_state: unknown;
  managed_pnl: number;
  managed_closed: boolean;
  last_reason: string | null;
  actual_pnl: number | null;
  truncated: boolean;
  source_boot_id?: string | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function decodeDurableShadow(row: DurableShadowRow): TrackedShadowState | null {
  if (!row.position_id || !row.slug || !row.occ_symbol || !row.underlying || !object(row.managed_state)) return null;
  const s = row.managed_state;
  if ((s.optType !== "call" && s.optType !== "put") || !finite(s.strike) || !finite(s.qty0)
      || !finite(s.remaining) || !finite(s.entryPremium) || !finite(s.R) || !object(s.m)) return null;
  return {
    slug: row.slug,
    occ: row.occ_symbol,
    sym: row.underlying,
    st: s as unknown as ManagedState,
    managedPnl: Number(row.managed_pnl ?? 0),
    managedClosed: !!row.managed_closed,
    lastReason: row.last_reason ?? undefined,
    truncated: !!row.truncated,
    actualPnl: row.actual_pnl == null ? undefined : Number(row.actual_pnl),
  };
}

export function encodeDurableShadow(positionId: string, t: TrackedShadowState, bootId: string): DurableShadowRow {
  return {
    position_id: positionId,
    slug: t.slug,
    occ_symbol: t.occ,
    underlying: t.sym,
    // Snapshot now: queued persistence must not observe a later mutation of the
    // in-memory state paired with earlier P&L/reason fields.
    managed_state: JSON.parse(JSON.stringify(t.st)) as unknown,
    managed_pnl: t.managedPnl,
    managed_closed: t.managedClosed,
    last_reason: t.lastReason ?? null,
    actual_pnl: t.actualPnl ?? null,
    truncated: t.truncated,
    source_boot_id: bootId,
  };
}
