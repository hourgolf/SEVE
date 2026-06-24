-- ============================================================================
-- 44_trade_forensics.sql — DURABLE per-trade forensics (operator 2026-06-24).
--
-- Today we only persist entry/exit/realized/close_reason/timing on a position row.
-- MFE/peak%/giveback are reconstructed post-hoc from option_quotes (7d prune) and
-- the entry reason lives in a separate table (fuzzy-joined). To build the
-- weeks-to-months dataset for pattern analysis + "teaching edge to edge-less
-- channels", we stamp the full per-trade record ON THE ROW, live:
--
--   peak_mark      — the running MAX option mark over the hold (ratcheted every
--                    cycle + every fast-exit sweep). MFE% = (peak_mark - avg_entry)/avg_entry;
--                    giveback% = (peak_mark - exit)/(peak_mark - avg_entry). Survives the quote prune.
--   entry_reason   — the signal reason that opened it (was only in `signals`, no FK).
--   entry_features — the decision context at entry (gap, er, relVol, atr, minutesToClose,
--                    entryUnderlying, …) as jsonb — the feature side of features→outcome.
--   entry_delta    — ATM delta at fill (the `delta` col exists but was never populated; keep
--                    `delta` as the live greek, add entry_delta as the durable entry snapshot).
--
-- Additive + nullable → every existing row + the live worker untouched until the
-- new worker deploys. Backfill of pre-deploy trades stays a day-report reconstruction.
-- ============================================================================
alter table public.positions
  add column if not exists peak_mark numeric(12,4),
  add column if not exists entry_reason text,
  add column if not exists entry_features jsonb,
  add column if not exists entry_delta numeric(8,4);
