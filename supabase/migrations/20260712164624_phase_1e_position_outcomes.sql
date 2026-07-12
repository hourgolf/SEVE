-- Phase 1E: append-only paper position lineage and booking outcomes.
-- OBSERVE ONLY: never read by execution, sizing, or management.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.position_outcome_events (
  id uuid primary key,
  schema_version integer not null default 1 check (schema_version = 1),
  event_kind text not null check (event_kind in (
    'position_opened','position_remainder_opened','position_booked',
    'reconciliation_unresolved','reconciliation_estimated','manual_reason_tagged'
  )),
  event_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  position_id uuid not null references public.positions(id),
  parent_position_id uuid references public.positions(id),
  -- Deterministic analytical join, deliberately not an FK: plan and outcome
  -- evidence use independent best-effort queues and may arrive in either order.
  plan_id uuid,
  opportunity_id text,
  source_boot_id uuid references public.worker_runs(boot_id),
  quantity integer check (quantity is null or quantity >= 0),
  avg_entry_price numeric check (avg_entry_price is null or avg_entry_price >= 0),
  exit_price numeric check (exit_price is null or exit_price >= 0),
  realized_pnl numeric,
  close_reason text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  check (parent_position_id is null or parent_position_id <> position_id),
  check (
    event_kind not in ('position_booked','reconciliation_estimated')
    or (exit_price is not null and realized_pnl is not null and close_reason is not null)
  )
);

comment on table public.position_outcome_events is
  'Append-only paper position lineage and booking evidence; non-authoritative for execution.';

create index idx_position_outcome_position on public.position_outcome_events(position_id, event_at);
create index idx_position_outcome_parent on public.position_outcome_events(parent_position_id, event_at) where parent_position_id is not null;
create index idx_position_outcome_plan on public.position_outcome_events(plan_id, event_at) where plan_id is not null;
create index idx_position_outcome_opportunity on public.position_outcome_events(opportunity_id, event_at) where opportunity_id is not null;
create index idx_position_outcome_boot on public.position_outcome_events(source_boot_id, event_at) where source_boot_id is not null;
create index idx_position_outcome_kind on public.position_outcome_events(event_kind, event_at desc);

alter table public.position_outcome_events enable row level security;
revoke all on public.position_outcome_events from public, anon, authenticated, service_role;
grant select, insert on public.position_outcome_events to service_role;
grant select on public.position_outcome_events to authenticated;

create policy position_outcome_events_operator_read
  on public.position_outcome_events for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
