// ============================================================================
//  exitGuard — Batch-1 (mission 1b, audit 2026-07-11) PURE guards for the
//  failure-policy fixes, extracted here so runner-selftest.ts covers them
//  hermetically (no env, no Supabase client, no Alpaca creds — the routing.ts /
//  exitRules.ts pattern). index.ts / store.ts attach the impure halves.
//
//  Contains:
//   · makeExitGuard (1b #8) — per-row exit claim set. The fast sweep no longer
//     shares the full-cycle mutex, so a cycle and a sweep CAN both reach an
//     executeExit for the same row in one interleaving; this guard makes the
//     double-exit structurally impossible (belt-and-suspenders on top of
//     execute.ts's deterministic per-row exit coid, which Alpaca dedups).
//   · sweepExitAllowed (1b #9) — the degraded-pass predicate: when the orders
//     snapshot is unavailable, ONLY the mandatory operator/calendar flattens
//     may place sells (bounded by min(held,row) + the deterministic coid);
//     ordinary price-triggered exits need the snapshot and stay suppressed.
//   · mapOpenPositions (1b #5) — the fail-honest open-positions read: a
//     Supabase error THROWS instead of dissolving into [] (the "worker
//     believes itself flat" class: duplicate lost-insert rows, an orphan
//     sweep that reads every held lot as uncovered, a sweep that exits
//     nothing). Callers catch and SKIP the pass — never act on fabricated
//     flat state.
// ============================================================================

import type { PositionRow } from "./store.js";

// ---- 1b #8: per-row exit in-flight claim -----------------------------------
export interface ExitGuard {
  /** Claim the row for an exit. false = an exit for this row is ALREADY in
   *  flight (the other loop) — the caller must skip, not wait. */
  claim(rowId: string): boolean;
  /** Release the claim (call in `finally` — a thrown exit must not wedge the row). */
  release(rowId: string): void;
  /** Rows currently claimed (diagnostics). */
  size(): number;
}

export function makeExitGuard(): ExitGuard {
  const inFlight = new Set<string>();
  return {
    claim(rowId: string): boolean {
      if (inFlight.has(rowId)) return false;
      inFlight.add(rowId);
      return true;
    },
    release(rowId: string): void { inFlight.delete(rowId); },
    size(): number { return inFlight.size; },
  };
}

// ---- 1b #9: degraded-sweep exit policy --------------------------------------
// The mandatory flattens fire at most once per row per pass; executeExit's
// min(held,row) sell-cap + the DETERMINISTIC per-row coid (Alpaca rejects a
// duplicate) bound the damage even with an empty order snapshot. Price exits
// (stops/targets/ratchets/stall) read the snapshot for late-fill recovery and
// working-order idempotency — without it they stay suppressed.
export const MANDATORY_FLATTEN_REASONS: ReadonlySet<string> = new Set([
  "halt_flatten", "eod_hard_flatten", "event_flatten",
]);

/** May this sweep exit place a sell given the orders-snapshot freshness? */
export function sweepExitAllowed(reason: string, ordersFresh: boolean): boolean {
  return ordersFresh || MANDATORY_FLATTEN_REASONS.has(reason);
}

// ---- 1b #5: fail-honest open-positions mapping -------------------------------
/** Shape of a supabase-js select result — structural, so the selftest mocks it. */
export interface RowsReadResult { data: unknown[] | null; error: { message: string } | null }

/** Map an open-positions read to PositionRow[], THROWING on a read error — a DB
 *  failure must never read as "flat book". Pure: store.getOpenPositions wraps
 *  this with the warn + journal so the outage is visible in events. */
export function mapOpenPositions(res: RowsReadResult): PositionRow[] {
  if (res.error) throw new Error(`getOpenPositions: ${res.error.message}`);
  return ((res.data ?? []) as any[]).map((p) => ({
    id: p.id,
    strategist_id: p.strategist_id,
    occ_symbol: p.occ_symbol,
    opt_type: p.opt_type,
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price ?? 0),
    strike: Number(p.strike ?? 0),
    expiration: p.expiration ?? null,
    opened_at: p.opened_at ?? null,
    status: p.status,
    underlying: String(p.underlying ?? ""),
    peak_mark: p.peak_mark != null ? Number(p.peak_mark) : null,
    trough_mark: p.trough_mark != null ? Number(p.trough_mark) : null,
    runner_of: p.runner_of ?? null,
  }));
}
