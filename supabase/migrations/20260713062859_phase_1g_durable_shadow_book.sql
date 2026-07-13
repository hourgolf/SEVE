-- Phase 1G-A: durable, observation-only state for the portable manager lab.
-- LOCAL/UNWIRED when authored: this migration alone cannot place or modify an
-- order and the worker has no runtime adapter for this table in 1G-A.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.manager_shadow_runs (
  id                       uuid primary key,
  schema_version           integer not null default 1 check (schema_version = 1),
  position_id              uuid not null references public.positions(id),
  strategist_id            uuid not null references public.strategists(id),
  account_id               uuid not null references public.accounts(id),
  source_boot_id           uuid not null references public.worker_runs(boot_id),
  terminal_boot_id         uuid references public.worker_runs(boot_id),

  channel_slug             text not null check (length(channel_slug) > 0),
  occ_symbol               text not null check (length(occ_symbol) > 0),
  underlying               text not null check (length(underlying) > 0),
  option_side              text not null check (option_side in ('call', 'put')),
  manager_id               text not null check (length(manager_id) > 0),
  manager_policy_version   text not null check (length(manager_policy_version) > 0),
  shadow_book_version      text not null check (length(shadow_book_version) > 0),
  cohort_from              timestamptz not null,
  quote_max_age_ms         integer not null check (quote_max_age_ms > 0),
  cutoff_minutes_before_close integer not null check (cutoff_minutes_before_close between 1 and 60),

  entry_price              numeric not null check (entry_price > 0),
  entry_price_basis        text not null check (entry_price_basis in ('broker_fill', 'execution_observation')),
  entry_at                 timestamptz not null,
  original_qty             integer not null check (original_qty > 0),
  minimum_modeled_qty      integer not null default 4 check (minimum_modeled_qty = 4),
  economic_mode            text not null check (economic_mode in ('whole_lot_executable', 'normalized_fractional')),
  allocation               jsonb not null check (jsonb_typeof(allocation) = 'object'),

  status                   text not null default 'active' check (status in ('active', 'terminal', 'censored')),
  manager_state            jsonb not null default '{}'::jsonb check (jsonb_typeof(manager_state) = 'object'),
  peak_return_pct          numeric,
  bank_return_pct          numeric,
  last_bid                 numeric check (last_bid is null or last_bid > 0),
  last_quote_at            timestamptz,
  last_observed_at         timestamptz,
  consecutive_quote_misses integer not null default 0 check (consecutive_quote_misses >= 0),

  actual_close_at          timestamptz,
  actual_close_reason      text,
  actual_realized_pnl      numeric,

  terminal_at              timestamptz,
  terminal_bid             numeric check (terminal_bid is null or terminal_bid > 0),
  terminal_return_pct      numeric,
  terminal_pnl             numeric,
  terminal_trigger         text,
  terminal_quote_age_ms    integer check (terminal_quote_age_ms is null or terminal_quote_age_ms >= 0),

  censored_at              timestamptz,
  censor_code              text,
  censor_fact              text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (position_id, manager_id, manager_policy_version, shadow_book_version),
  check (updated_at >= created_at),
  check (last_quote_at is null or last_quote_at >= entry_at),
  check (last_quote_at is null or last_observed_at is null or last_quote_at <= last_observed_at),
  check (
    (actual_close_at is null and actual_close_reason is null and actual_realized_pnl is null)
    or
    (actual_close_at >= entry_at and length(actual_close_reason) > 0 and actual_realized_pnl is not null)
  ),
  check (economic_mode <> 'whole_lot_executable' or original_qty >= minimum_modeled_qty),
  check (
    (status = 'terminal' and terminal_boot_id is not null)
    or
    (status <> 'terminal' and terminal_boot_id is null)
  ),
  check (
    (status = 'active'
      and terminal_at is null and terminal_bid is null and terminal_return_pct is null
      and terminal_pnl is null and terminal_trigger is null and terminal_quote_age_ms is null
      and censored_at is null and censor_code is null and censor_fact is null)
    or
    (status = 'terminal'
      and terminal_at is not null and terminal_bid is not null and terminal_return_pct is not null
      and terminal_pnl is not null and terminal_trigger is not null and terminal_quote_age_ms is not null
      and terminal_at >= entry_at and last_quote_at = terminal_at and last_bid = terminal_bid
      and last_observed_at is not null
      and censored_at is null and censor_code is null and censor_fact is null)
    or
    (status = 'censored'
      and censored_at >= entry_at and censor_code is not null
      and terminal_at is null and terminal_bid is null and terminal_return_pct is null
      and terminal_pnl is null and terminal_trigger is null and terminal_quote_age_ms is null)
  )
);

-- The unique constraint starts with position_id and covers that foreign-key
-- lookup. Remaining parent joins and read paths use the indexes below.
create index idx_manager_shadow_runs_strategist
  on public.manager_shadow_runs (strategist_id, manager_id, status, created_at desc);
create index idx_manager_shadow_runs_account
  on public.manager_shadow_runs (account_id, status, created_at desc);
create index idx_manager_shadow_runs_source_boot
  on public.manager_shadow_runs (source_boot_id);
create index idx_manager_shadow_runs_terminal_boot
  on public.manager_shadow_runs (terminal_boot_id)
  where terminal_boot_id is not null;
create index idx_manager_shadow_runs_active_occ
  on public.manager_shadow_runs (occ_symbol, last_observed_at)
  where status = 'active';

comment on table public.manager_shadow_runs is
  'Observation-only durable manager-lab state; never an execution instruction.';
comment on column public.manager_shadow_runs.allocation is
  'Stamped integer allocation. BANK20/RUN50 uses bankQty=floor(qty/2), runnerQty=qty-bankQty.';
comment on column public.manager_shadow_runs.economic_mode is
  'Executable rankings require whole_lot_executable; normalized_fractional is research-only.';
comment on column public.manager_shadow_runs.quote_max_age_ms is
  'Injected evidence rule; changing it requires a new shadow_book_version.';

alter table public.manager_shadow_runs enable row level security;

-- Explicit privileges are required because tables in public can be surfaced by
-- the Data API. Anonymous users receive no privilege; writes remain backend-only.
revoke all on public.manager_shadow_runs from public, anon, authenticated;
grant select, insert, update, delete on public.manager_shadow_runs to service_role;
grant select on public.manager_shadow_runs to authenticated;

create policy manager_shadow_runs_operator_read on public.manager_shadow_runs
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
