-- Phase 1B: durable, versioned evidence foundations.
-- DARK/UNWIRED: this migration does not alter entry, sizing, order, or exit policy.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A deploy overlap is not a crash. The successor boot stamps the prior run once
-- its heartbeat goes stale, preserving both the overlap evidence and truthful
-- termination attribution.
alter table public.worker_runs
  add column if not exists superseded_by_boot_id uuid references public.worker_runs(boot_id),
  add column if not exists classified_at timestamptz;
create index if not exists idx_worker_runs_superseded_by
  on public.worker_runs (superseded_by_boot_id)
  where superseded_by_boot_id is not null;

-- Repair already-recorded deploy overlaps, including rows a later boot labeled
-- abrupt before this classifier existed. A different Railway deployment that
-- starts within five minutes of the predecessor's final beat is a handoff.
with ordered_runs as (
  select boot_id, railway_deployment, last_heartbeat_at,
         lead(boot_id) over (order by started_at) as next_boot_id,
         lead(railway_deployment) over (order by started_at) as next_deployment,
         lead(started_at) over (order by started_at) as next_started_at
  from public.worker_runs
), deploy_handoffs as (
  select boot_id, last_heartbeat_at, next_boot_id
  from ordered_runs
  where railway_deployment is not null
    and next_deployment is not null
    and railway_deployment <> next_deployment
    and last_heartbeat_at is not null
    and next_started_at between last_heartbeat_at - interval '30 seconds'
                            and last_heartbeat_at + interval '5 minutes'
)
update public.worker_runs w
set ended_at = h.last_heartbeat_at,
    termination_kind = 'superseded_deploy',
    superseded_by_boot_id = h.next_boot_id,
    classified_at = now()
from deploy_handoffs h
where w.boot_id = h.boot_id
  and (w.termination_kind is null or w.termination_kind = 'abrupt_or_unknown');

-- Immutable policy identity. policy_json is the sealed manager/risk payload;
-- changing it means inserting a new epoch, never editing old evidence.
create table if not exists public.policy_epochs (
  id                 uuid primary key default gen_random_uuid(),
  strategist_id      uuid not null references public.strategists(id),
  account_id         uuid not null references public.accounts(id),
  channel_slug       text not null,
  channel_version    text not null,
  manager_id         text not null,
  manager_version    text not null,
  mode               text not null check (mode in ('observe','assist','auto')),
  policy_json        jsonb not null check (jsonb_typeof(policy_json) = 'object'),
  created_by_boot_id uuid references public.worker_runs(boot_id),
  created_at         timestamptz not null default now(),
  retired_at         timestamptz,
  check (retired_at is null or retired_at >= created_at)
);
create index if not exists idx_policy_epochs_channel
  on public.policy_epochs (strategist_id, account_id, created_at desc);
create index if not exists idx_policy_epochs_account
  on public.policy_epochs (account_id, created_at desc);
create index if not exists idx_policy_epochs_boot
  on public.policy_epochs (created_by_boot_id)
  where created_by_boot_id is not null;

-- One sealed capital plan per accepted opportunity. The JSON body must match
-- PositionPlanV1; relational identity columns make attribution/querying honest.
create table if not exists public.position_plans (
  id              uuid primary key,
  opportunity_id  text not null unique,
  policy_epoch_id uuid not null references public.policy_epochs(id),
  strategist_id   uuid not null references public.strategists(id),
  account_id      uuid not null references public.accounts(id),
  position_id     uuid unique references public.positions(id),
  schema_version  integer not null default 1 check (schema_version = 1),
  state           text not null default 'planned'
                    check (state in ('planned','active','complete','canceled')),
  plan_json       jsonb not null check (jsonb_typeof(plan_json) = 'object'),
  created_at      timestamptz not null default now(),
  activated_at    timestamptz,
  completed_at    timestamptz,
  check (activated_at is null or activated_at >= created_at),
  check (completed_at is null or completed_at >= created_at)
);
create index if not exists idx_position_plans_channel
  on public.position_plans (strategist_id, account_id, created_at desc);
create index if not exists idx_position_plans_state
  on public.position_plans (state, created_at desc);
create index if not exists idx_position_plans_policy_epoch
  on public.position_plans (policy_epoch_id);
create index if not exists idx_position_plans_account
  on public.position_plans (account_id, created_at desc);

-- Restart-safe state for the existing no-order management counterfactual.
-- The worker upserts after each evaluation and deletes only after both actual and
-- simulated clocks finish and the MGMT event write is queued.
create table if not exists public.shadow_management_state (
  position_id      uuid primary key references public.positions(id) on delete cascade,
  slug             text not null,
  occ_symbol       text not null,
  underlying       text not null,
  managed_state    jsonb not null check (jsonb_typeof(managed_state) = 'object'),
  managed_pnl      numeric not null default 0,
  managed_closed   boolean not null default false,
  last_reason      text,
  actual_pnl       numeric,
  truncated        boolean not null default false,
  source_boot_id   uuid references public.worker_runs(boot_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_shadow_management_underlying
  on public.shadow_management_state (underlying, updated_at desc);
create index if not exists idx_shadow_management_boot
  on public.shadow_management_state (source_boot_id)
  where source_boot_id is not null;

alter table public.policy_epochs enable row level security;
alter table public.position_plans enable row level security;
alter table public.shadow_management_state enable row level security;

-- No public/anon access. The authenticated dashboard may read these only for a
-- provisioned SEVE operator; writes stay service-role-only.
revoke all on public.policy_epochs from public, anon, authenticated;
revoke all on public.position_plans from public, anon, authenticated;
revoke all on public.shadow_management_state from public, anon, authenticated;

grant select, insert, update, delete on public.policy_epochs to service_role;
grant select, insert, update, delete on public.position_plans to service_role;
grant select, insert, update, delete on public.shadow_management_state to service_role;
grant select on public.policy_epochs to authenticated;
grant select on public.position_plans to authenticated;
grant select on public.shadow_management_state to authenticated;

drop policy if exists policy_epochs_operator_read on public.policy_epochs;
create policy policy_epochs_operator_read on public.policy_epochs
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists position_plans_operator_read on public.position_plans;
create policy position_plans_operator_read on public.position_plans
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists shadow_management_operator_read on public.shadow_management_state;
create policy shadow_management_operator_read on public.shadow_management_state
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
