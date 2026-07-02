-- ============================================================================
-- 60_virtual_trades.sql — durable home for gate-shadow reconstructions (2026-07-01).
--
-- One row per reconstructed BLOCKED entry signal: the virtual-bench fleet's
-- `not_armed` signals (first per channel per day — one-at-a-time semantics) plus
-- the cost_gate / stale_chain blocks. Written by scripts/gate-shadow.ts (service
-- role, nightly via capture-forward) from the still-live option_quotes; read by
-- the §03 LAB panel (anon).
--
-- ⚠ EVERY row is a WOULD-HAVE at mid/ask basis — capital-blind, upper-bound,
-- never tradable evidence on its own (docs/pre-registered-tests-2026-07.md).
-- Tiny table (tens of rows/day); no retention needed on the 0.5GB budget.
-- NEW-TABLE GOTCHA (project convention): RLS policy alone isn't enough — anon
-- AND authenticated need explicit SELECT grants or the dashboard reads empty.
-- ============================================================================

create table if not exists virtual_trades (
  signal_id       uuid primary key,          -- signals.id (upsert key — re-run safe)
  strategist_id   uuid not null,
  slug            text not null,
  occ             text not null,
  signal_at       timestamptz not null,
  blocked         text not null,             -- not_armed (bench) | cost_gate | stale_chain
  entry_px        numeric,                   -- decision ask (rationale, else first quote after the signal)
  exit_reason     text not null default 'no_quotes',  -- would_target | would_stop | would_flatten | no_quotes
  exit_px         numeric,
  pnl_per_contract numeric,                  -- (exit − entry) × 100, mid-basis UPPER BOUND
  tp_pct          numeric,
  stop_pct        numeric,
  n_quotes        int not null default 0,
  inserted_at     timestamptz not null default now()
);
create index if not exists idx_virtual_trades_slug on virtual_trades (slug, signal_at);

alter table virtual_trades enable row level security;
drop policy if exists read_virtual_trades on virtual_trades;
create policy read_virtual_trades on virtual_trades for select using (true);
grant select on virtual_trades to anon, authenticated;
