-- Phase 1D: immutable paper-decision and broker-result evidence.
-- OBSERVE ONLY: this table is never read by decide, sizing, order placement,
-- exit management, or risk. A write failure can lose evidence only.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.execution_observations (
  id                uuid primary key,
  trace_id          uuid not null,
  schema_version    integer not null default 1 check (schema_version = 1),
  event_kind        text not null check (event_kind in ('decision','broker_result')),
  event_at          timestamptz not null,
  source_bar_at     timestamptz not null,
  recorded_at       timestamptz not null default now(),

  strategist_id     uuid not null references public.strategists(id),
  account_id        uuid not null references public.accounts(id),
  source_boot_id    uuid references public.worker_runs(boot_id),
  channel_slug      text not null,
  opportunity_id    text,
  position_id       uuid references public.positions(id),

  action            text not null check (action in ('enter','add','exit','reconcile')),
  reason            text not null,
  blocked_reason    text,
  underlying        text not null,
  occ_symbol        text,
  option_side       text check (option_side is null or option_side in ('call','put')),

  -- The Alpaca chain seam exposes snapshot age but no authoritative per-contract
  -- source timestamp. Preserve the measured age; never derive a fictitious quote_at.
  quote_source      text check (quote_source is null or quote_source = 'alpaca_snapshot'),
  quote_age_ms      integer check (quote_age_ms is null or quote_age_ms >= 0),
  bid               numeric check (bid is null or bid >= 0),
  ask               numeric check (ask is null or ask >= 0),
  mid               numeric check (mid is null or mid >= 0),
  delta             numeric check (delta is null or delta between -1 and 1),
  underlying_price  numeric check (underlying_price is null or underlying_price >= 0),

  requested_qty     integer check (requested_qty is null or requested_qty >= 0),
  client_order_id   text,
  broker_order_id   text,
  broker_status     text,
  filled_qty        integer check (filled_qty is null or filled_qty >= 0),
  fill_price        numeric check (fill_price is null or fill_price >= 0),
  payload           jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),

  check (ask is null or bid is null or ask >= bid),
  check (
    (event_kind = 'decision'
      and client_order_id is null
      and broker_order_id is null
      and broker_status is null
      and filled_qty is null
      and fill_price is null)
    or
    (event_kind = 'broker_result'
      and client_order_id is not null
      and broker_status is not null
      and filled_qty is not null
      and fill_price is not null)
  )
);

comment on table public.execution_observations is
  'Append-only paper decision, quote, order, and fill evidence; non-authoritative for execution.';

create index idx_execution_observations_trace
  on public.execution_observations (trace_id, event_at);
create index idx_execution_observations_opportunity
  on public.execution_observations (opportunity_id, event_at)
  where opportunity_id is not null;
create index idx_execution_observations_channel
  on public.execution_observations (strategist_id, account_id, event_at desc);
create index idx_execution_observations_account
  on public.execution_observations (account_id, event_at desc);
create index idx_execution_observations_boot
  on public.execution_observations (source_boot_id, event_at desc)
  where source_boot_id is not null;
create index idx_execution_observations_position
  on public.execution_observations (position_id, event_at)
  where position_id is not null;
create index idx_execution_observations_broker_order
  on public.execution_observations (broker_order_id)
  where broker_order_id is not null;
create index idx_execution_observations_blocked
  on public.execution_observations (blocked_reason, event_at desc)
  where blocked_reason is not null;

alter table public.execution_observations enable row level security;

-- Data API grants are explicit. Supabase no longer guarantees that new public
-- tables receive default grants, and grants remain separate from RLS.
revoke all on public.execution_observations from public, anon, authenticated, service_role;
grant select, insert on public.execution_observations to service_role;
grant select on public.execution_observations to authenticated;

create policy execution_observations_operator_read
  on public.execution_observations
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
