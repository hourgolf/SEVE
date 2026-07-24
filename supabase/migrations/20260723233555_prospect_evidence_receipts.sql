-- Review-only continuation of the existing Gate 2 evidence schema.
-- This migration makes independent exact dark/VB manager paths durable. It
-- does not authorize a prospect fill, change a root epoch, or expose an order
-- surface. Production application requires a separate operator gate.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.vb_exact_manager_path_receipts (
  id                            uuid primary key,
  schema_version                integer not null check (schema_version = 1),
  candidate_id                  text not null,
  opportunity_id                text not null,
  exact_path_receipt_id         uuid not null,
  session_date_et               date not null,
  channel_slug                  text not null check (length(channel_slug) between 1 and 160),
  channel_version               text not null check (channel_version ~ '^sha256:[0-9a-f]{64}$'),
  configuration_epoch_id        text not null check (configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'),
  candidate_manager_version     text not null check (candidate_manager_version ~ '^sha256:[0-9a-f]{64}$'),
  manager_id                    text not null check (length(manager_id) between 1 and 120),
  manager_policy_version        text not null check (length(manager_policy_version) between 1 and 120),
  source_bar_at                 timestamptz not null,
  decision_observed_at          timestamptz not null,
  entry_ask                     numeric not null check (entry_ask > 0),
  exit_at                       timestamptz not null,
  exit_bid                      numeric not null check (exit_bid > 0),
  exit_reason                   text not null check (length(exit_reason) between 1 and 160),
  return_pct                    numeric not null,
  pnl_per_contract              numeric not null,
  basis                         text not null check (basis = 'databento_entry_ask_to_executable_bid'),
  independent_opportunity       boolean not null check (independent_opportunity),
  replay_version                text not null check (length(replay_version) between 1 and 120),
  created_at                    timestamptz not null default now(),

  check (decision_observed_at >= source_bar_at),
  check (exit_at >= decision_observed_at),
  unique (candidate_id, manager_id, replay_version),
  foreign key (candidate_id, opportunity_id)
    references public.vb_candidate_receipts (id, opportunity_id),
  foreign key (exact_path_receipt_id)
    references public.vb_exact_path_receipts (id)
);

create index idx_vb_exact_manager_paths_session_channel
  on public.vb_exact_manager_path_receipts (session_date_et desc, channel_slug, manager_id);
create index idx_vb_exact_manager_paths_epoch
  on public.vb_exact_manager_path_receipts (configuration_epoch_id, source_bar_at);
create index idx_vb_exact_manager_paths_candidate
  on public.vb_exact_manager_path_receipts (candidate_id);

comment on table public.vb_exact_manager_path_receipts is
  'Append-only exact executable-basis manager research for dark/VB decisions; never an order, promotion, or root-epoch instruction.';

alter table public.vb_exact_manager_path_receipts enable row level security;
revoke all on public.vb_exact_manager_path_receipts from public, anon, authenticated, service_role;
grant select, insert on public.vb_exact_manager_path_receipts to service_role;
grant select on public.vb_exact_manager_path_receipts to authenticated;

create policy vb_exact_manager_paths_operator_read
  on public.vb_exact_manager_path_receipts
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
