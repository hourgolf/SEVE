-- Append-only executable-shadow evidence ledger.
--
-- This creates no channel, manager, order, position, roster mutation, or
-- execution authority. It deliberately does not reuse `virtual_trades`:
-- exploratory hypothetical paths and chronologically admissible ask/bid
-- shadows answer different questions and must never be pooled silently.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.executable_shadow_runs (
  id                       uuid primary key,
  schema_version           integer not null default 1 check (schema_version = 1),
  engine_version           text not null check (length(btrim(engine_version)) between 3 and 160),
  publisher_version        text not null check (length(btrim(publisher_version)) between 3 and 160),
  generated_at             timestamptz not null,
  session_from_et          date not null,
  session_through_et       date not null,
  modes                    jsonb not null check (
                             jsonb_typeof(modes) = 'array'
                             and jsonb_array_length(modes) between 1 and 2
                           ),
  quote_policy             jsonb not null check (
                             jsonb_typeof(quote_policy) = 'object'
                             and quote_policy <> '{}'::jsonb
                           ),
  account_policies         jsonb not null check (
                             jsonb_typeof(account_policies) = 'array'
                           ),
  input_content_hash       text not null check (input_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_content_hash      text not null check (output_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  opportunity_count        integer not null check (opportunity_count >= 0),
  receipt_count            integer not null check (receipt_count >= 0),
  source_refs              jsonb not null check (
                             jsonb_typeof(source_refs) = 'array'
                             and jsonb_array_length(source_refs) between 1 and 256
                           ),
  production_writes        integer not null default 0 check (production_writes = 0),
  execution_authority      boolean not null default false check (not execution_authority),
  runtime_mutation_authorized boolean not null default false check (not runtime_mutation_authorized),
  order_authority          boolean not null default false check (not order_authority),
  created_at               timestamptz not null default now(),
  check (session_through_et >= session_from_et),
  unique (input_content_hash, output_content_hash)
);

create table public.executable_shadow_receipts (
  id                       uuid primary key,
  schema_version           integer not null default 1 check (schema_version = 1),
  run_id                   uuid not null references public.executable_shadow_runs(id),
  opportunity_id           text not null check (length(btrim(opportunity_id)) between 1 and 240),
  signal_id                uuid not null references public.signals(id),
  strategist_id            uuid not null references public.strategists(id),
  channel_slug             text not null check (channel_slug ~ '^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$'),
  session_date_et          date not null,
  account_id               uuid not null references public.accounts(id),
  underlying               text not null check (length(btrim(underlying)) between 1 and 16),
  occ_symbol               text,
  contract_selection_id    text not null check (length(btrim(contract_selection_id)) between 3 and 160),
  contract_selection_snapshot jsonb not null check (
                             jsonb_typeof(contract_selection_snapshot) = 'object'
                             and contract_selection_snapshot <> '{}'::jsonb
                           ),
  family_id                text,
  collision_domain         text,
  signal_at                timestamptz not null,
  decision_at              timestamptz not null,
  decision_clock           text not null check (length(btrim(decision_clock)) between 3 and 240),
  decision_clock_at        timestamptz not null,
  mode                     text not null check (mode in ('channel_isolated', 'portfolio')),
  disposition              text not null check (disposition in (
                             'filled', 'filled_censored',
                             'blocked_channel_open', 'blocked_entry_cap',
                             'blocked_channel_debit', 'blocked_channel_stop_exposure',
                             'blocked_same_occ', 'blocked_family',
                             'blocked_collision_domain', 'blocked_underlying_capacity',
                             'blocked_account_positions', 'blocked_account_debit',
                             'blocked_account_stop_exposure', 'blocked_account_buying_power',
                             'censored_missing_contract', 'censored_missing_entry_quote',
                             'censored_late_entry_quote', 'censored_stale_entry_quote',
                             'censored_entry_spread', 'censored_entry_size',
                             'censored_missing_exit_quote'
                           )),
  disposition_reason       text not null check (length(btrim(disposition_reason)) between 3 and 1000),
  priority                 integer not null,
  quantity                 integer not null check (quantity > 0),
  max_entries_per_session  integer not null check (max_entries_per_session > 0),
  max_debit_usd            numeric not null check (max_debit_usd >= 0),
  max_stop_exposure_usd    numeric not null check (max_stop_exposure_usd >= 0),
  entry_ordinal            integer check (entry_ordinal is null or entry_ordinal > 0),
  entry_quote_ref          text,
  entry_at                 timestamptz,
  entry_ask                numeric check (entry_ask is null or entry_ask > 0),
  entry_debit_usd          numeric check (entry_debit_usd is null or entry_debit_usd >= 0),
  stop_exposure_usd        numeric check (stop_exposure_usd is null or stop_exposure_usd >= 0),
  exit_quote_ref           text,
  exit_at                  timestamptz,
  exit_bid                 numeric check (exit_bid is null or exit_bid >= 0),
  exit_reason              text check (exit_reason is null or exit_reason in ('target', 'stop', 'ratchet', 'force_exit')),
  result_per_contract_usd  numeric,
  total_result_usd         numeric,
  return_pct               numeric,
  mfe_pct                  numeric,
  mae_pct                  numeric,
  capture_ratio            numeric,
  manager_id               text not null check (length(btrim(manager_id)) between 1 and 160),
  manager_version          text not null check (length(btrim(manager_version)) between 1 and 160),
  manager_snapshot         jsonb not null check (
                             jsonb_typeof(manager_snapshot) = 'object'
                             and manager_snapshot <> '{}'::jsonb
                           ),
  configuration_source     text not null check (
                             configuration_source in ('activated_manifest', 'research_registration')
                           ),
  channel_spec_version_id  uuid references public.channel_spec_versions(id),
  release_manifest_id      uuid references public.release_manifests(id),
  configuration_epoch_id   text check (
                             configuration_epoch_id is null
                             or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                           ),
  research_registration_id uuid references public.research_channel_registrations(id),
  configuration_snapshot   jsonb not null check (
                             jsonb_typeof(configuration_snapshot) = 'object'
                             and configuration_snapshot <> '{}'::jsonb
                           ),
  configuration_content_hash text not null check (
                             configuration_content_hash ~ '^sha256:[0-9a-f]{64}$'
                           ),
  source_refs              jsonb not null check (
                             jsonb_typeof(source_refs) = 'array'
                             and jsonb_array_length(source_refs) between 1 and 128
                           ),
  exploratory_virtual_paths_included boolean not null default false check (not exploratory_virtual_paths_included),
  execution_authority      boolean not null default false check (not execution_authority),
  runtime_mutation_authorized boolean not null default false check (not runtime_mutation_authorized),
  order_authority          boolean not null default false check (not order_authority),
  created_at               timestamptz not null default now(),
  unique (run_id, opportunity_id, mode),
  check (decision_at >= signal_at),
  check (decision_at >= decision_clock_at),
  check (
    (entry_at is null and entry_quote_ref is null and entry_ask is null
      and entry_debit_usd is null and stop_exposure_usd is null and entry_ordinal is null)
    or
    (entry_at is not null and entry_quote_ref is not null and entry_ask is not null
      and entry_debit_usd is not null and stop_exposure_usd is not null and entry_ordinal is not null)
  ),
  check (
    (exit_at is null and exit_quote_ref is null and exit_bid is null and exit_reason is null)
    or
    (exit_at is not null and exit_quote_ref is not null and exit_bid is not null
      and exit_reason is not null and entry_at is not null and exit_at >= entry_at)
  ),
  check (
    (result_per_contract_usd is null and total_result_usd is null and return_pct is null)
    or
    (result_per_contract_usd is not null and total_result_usd is not null
      and return_pct is not null and exit_at is not null)
  ),
  check (
    (configuration_source = 'activated_manifest'
      and channel_spec_version_id is not null
      and release_manifest_id is not null
      and configuration_epoch_id is not null
      and research_registration_id is null)
    or
    (configuration_source = 'research_registration'
      and channel_spec_version_id is null
      and release_manifest_id is null
      and configuration_epoch_id is null
      and research_registration_id is not null)
  )
);

create index executable_shadow_receipts_channel_session_idx
  on public.executable_shadow_receipts (channel_slug, session_date_et desc, mode, disposition);
create index executable_shadow_receipts_run_idx
  on public.executable_shadow_receipts (run_id, mode, channel_slug);
create index executable_shadow_receipts_signal_idx
  on public.executable_shadow_receipts (signal_id, mode);

create or replace function seve_control.enforce_executable_shadow_receipt_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.configuration_source = 'activated_manifest' then
    if not exists (
      select 1
      from public.release_manifest_channels membership
      join public.channel_spec_versions spec
        on spec.id = membership.channel_spec_version_id
      where membership.release_manifest_id = new.release_manifest_id
        and membership.channel_spec_version_id = new.channel_spec_version_id
        and spec.channel_id = new.strategist_id
        and spec.channel_slug = new.channel_slug
        and spec.content_hash = new.configuration_content_hash
    ) then
      raise exception 'executable shadow receipt lacks exact manifest membership';
    end if;
    if not (
      exists (
        select 1 from public.activation_receipts receipt
        where receipt.release_manifest_id = new.release_manifest_id
          and receipt.configuration_epoch_id = new.configuration_epoch_id
      )
      or exists (
        select 1 from public.channel_roster_bundle_activation_receipts receipt
        where receipt.release_manifest_id = new.release_manifest_id
          and receipt.configuration_epoch_id = new.configuration_epoch_id
      )
    ) then
      raise exception 'executable shadow receipt lacks exact activation authority provenance';
    end if;
  elsif new.configuration_source = 'research_registration' then
    if not exists (
      select 1
      from public.research_channel_registrations registration
      where registration.id = new.research_registration_id
        and registration.channel_id = new.strategist_id
        and registration.channel_slug = new.channel_slug
        and registration.content_hash = new.configuration_content_hash
        and registration.state = 'paper-eligible'
        and registration.candidate_spec is not null
    ) then
      raise exception 'executable shadow receipt disagrees with its research registration';
    end if;
  end if;
  return new;
end;
$$;

create or replace function seve_control.reject_executable_shadow_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

create trigger executable_shadow_runs_append_only
  before update or delete on public.executable_shadow_runs
  for each row execute function seve_control.reject_executable_shadow_mutation();

create trigger executable_shadow_receipts_10_validate
  before insert on public.executable_shadow_receipts
  for each row execute function seve_control.enforce_executable_shadow_receipt_provenance();

create trigger executable_shadow_receipts_append_only
  before update or delete on public.executable_shadow_receipts
  for each row execute function seve_control.reject_executable_shadow_mutation();

alter table public.executable_shadow_runs enable row level security;
alter table public.executable_shadow_receipts enable row level security;

revoke all on public.executable_shadow_runs from public, anon, authenticated;
revoke all on public.executable_shadow_receipts from public, anon, authenticated;
grant select, insert on public.executable_shadow_runs to service_role;
grant select, insert on public.executable_shadow_receipts to service_role;
grant select on public.executable_shadow_runs to authenticated;
grant select on public.executable_shadow_receipts to authenticated;

create policy executable_shadow_runs_operator_read on public.executable_shadow_runs
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy executable_shadow_receipts_operator_read on public.executable_shadow_receipts
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

revoke all on function seve_control.enforce_executable_shadow_receipt_provenance()
  from public, anon, authenticated;
revoke all on function seve_control.reject_executable_shadow_mutation()
  from public, anon, authenticated;
grant execute on function seve_control.enforce_executable_shadow_receipt_provenance()
  to service_role;
grant execute on function seve_control.reject_executable_shadow_mutation()
  to service_role;

comment on table public.executable_shadow_runs is
  'Append-only run envelope for chronological ask-entry/bid-exit evidence; never an execution instruction.';
comment on table public.executable_shadow_receipts is
  'One immutable admission/scoring receipt per opportunity and mode. Exploratory virtual paths are explicitly excluded.';
comment on column public.executable_shadow_receipts.configuration_source is
  'Exact activated-manifest provenance or an immutable observe-only research registration; mutable strategist state is not authority.';

commit;
