-- PROPOSED / UNAPPLIED: channel configuration control-plane foundations.
--
-- This migration is intentionally additive and dark. It does not seed an
-- active manifest, change strategist configuration, authorize an activation,
-- alter an order path, or backfill historical evidence by inference.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists seve_control;
revoke all on schema seve_control from public, anon, authenticated;
grant usage on schema seve_control to service_role;

create table public.channel_spec_versions (
  id                    uuid primary key default gen_random_uuid(),
  schema_version        integer not null default 1 check (schema_version = 1),
  version_key           text not null unique check (
                          version_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
                        ),
  channel_id            uuid not null references public.strategists(id),
  channel_slug          text not null,
  strategy_identity     text not null,
  strategy_version      text not null,
  signal_version        text not null,
  manager_profile_id    text not null,
  manager_version       text not null,
  account_id            uuid not null references public.accounts(id),
  account_role          text not null,
  account_mode          text not null check (account_mode = 'paper'),
  symbol_scope          jsonb not null check (jsonb_typeof(symbol_scope) = 'array'),
  family_id             text not null,
  cohort                text not null check (cohort in ('control', 'lab')),
  priority              integer not null check (priority > 0),
  quantity              integer not null check (quantity > 0),
  max_debit_usd         numeric not null check (max_debit_usd > 0),
  entry_parameters      jsonb not null check (jsonb_typeof(entry_parameters) = 'object'),
  exit_parameters       jsonb not null check (jsonb_typeof(exit_parameters) = 'object'),
  take_profit           jsonb not null check (jsonb_typeof(take_profit) = 'object'),
  stop_loss             jsonb not null check (jsonb_typeof(stop_loss) = 'object'),
  ratchet_parameters    jsonb not null check (jsonb_typeof(ratchet_parameters) = 'object'),
  reentry_policy        text not null check (reentry_policy in ('disabled', 'bounded')),
  scale_policy          jsonb not null check (jsonb_typeof(scale_policy) = 'object'),
  collision_domain      text not null,
  risk_limits           jsonb not null check (jsonb_typeof(risk_limits) = 'object'),
  valid_from            timestamptz not null,
  valid_until           timestamptz,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  parent_version_id     uuid references public.channel_spec_versions(id),
  content_hash          text not null unique check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  status                text not null default 'draft' check (status in (
                          'draft', 'validated', 'scheduled', 'active',
                          'superseded', 'rejected', 'rolled_back'
                        )),
  check (valid_until is null or valid_until >= valid_from),
  unique (channel_id, content_hash)
);

create index channel_spec_versions_channel_created_idx
  on public.channel_spec_versions (channel_id, created_at desc);
create index channel_spec_versions_active_idx
  on public.channel_spec_versions (channel_id, valid_from desc)
  where status = 'active';
create index channel_spec_versions_parent_idx
  on public.channel_spec_versions (parent_version_id)
  where parent_version_id is not null;
create index channel_spec_versions_account_idx
  on public.channel_spec_versions (account_id, created_at desc);

create table public.release_manifests (
  id                            uuid primary key default gen_random_uuid(),
  schema_version                integer not null default 1 check (schema_version = 1),
  manifest_key                  text not null unique check (
                                  manifest_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
                                ),
  release_id                    text not null unique,
  cohort_id                     text not null,
  worker_compatibility_version  text not null,
  legacy_configuration_hash     text check (
                                  legacy_configuration_hash is null
                                  or legacy_configuration_hash ~ '^[0-9a-f]{64}$'
                                ),
  paper_live_authority          text not null check (paper_live_authority = 'paper-only'),
  admission_policy_version      text not null,
  collision_policy_version      text not null,
  activation_boundary           text not null check (activation_boundary = 'next-safe-entry'),
  admission_policies            jsonb not null check (jsonb_typeof(admission_policies) = 'array'),
  rollback_target_manifest_id   text not null,
  parent_manifest_id            uuid references public.release_manifests(id),
  manifest_json                 jsonb not null check (jsonb_typeof(manifest_json) = 'object'),
  content_hash                  text not null unique check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by                    text not null,
  created_at                    timestamptz not null default now(),
  valid_from                    timestamptz,
  valid_until                   timestamptz,
  status                        text not null default 'draft' check (status in (
                                  'draft', 'validated', 'scheduled', 'active',
                                  'superseded', 'rejected', 'rolled_back'
                                )),
  check (valid_until is null or valid_from is not null),
  check (valid_until is null or valid_until >= valid_from)
);

create index release_manifests_status_created_idx
  on public.release_manifests (status, created_at desc);
create index release_manifests_parent_idx
  on public.release_manifests (parent_manifest_id)
  where parent_manifest_id is not null;

create table public.release_manifest_channels (
  release_manifest_id     uuid not null references public.release_manifests(id),
  channel_spec_version_id uuid not null references public.channel_spec_versions(id),
  ordinal                 integer not null check (ordinal >= 0),
  created_at              timestamptz not null default now(),
  primary key (release_manifest_id, channel_spec_version_id),
  unique (release_manifest_id, ordinal)
);

create index release_manifest_channels_spec_idx
  on public.release_manifest_channels (channel_spec_version_id, release_manifest_id);

create table public.channel_change_proposals (
  id                              uuid primary key default gen_random_uuid(),
  schema_version                  integer not null default 1 check (schema_version = 1),
  base_spec_version_id            uuid not null references public.channel_spec_versions(id),
  base_spec_content_hash          text not null check (base_spec_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  proposed_spec_version_id        uuid references public.channel_spec_versions(id),
  proposed_patch                  jsonb not null check (jsonb_typeof(proposed_patch) = 'object'),
  reason                          text not null check (length(btrim(reason)) > 0),
  evidence_refs                   jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  author_kind                     text not null check (author_kind in ('operator', 'sentinel', 'system')),
  author_id                       text not null check (length(btrim(author_id)) > 0),
  change_class                    text not null check (change_class in (
                                    'presentation-only', 'bounded-parameter',
                                    'governed-operational-policy', 'code-strategy-logic'
                                  )),
  validation_results              jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_results) = 'array'),
  replay_summary                  jsonb not null check (jsonb_typeof(replay_summary) = 'object'),
  capacity_collision_impact       jsonb not null check (jsonb_typeof(capacity_collision_impact) = 'object'),
  approval_state                  text not null check (approval_state in (
                                    'draft', 'validated', 'approved', 'rejected', 'canceled'
                                  )),
  requested_activation_boundary   text not null check (requested_activation_boundary = 'next-safe-entry'),
  activation_authorized           boolean not null default false check (activation_authorized = false),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create index channel_change_proposals_base_idx
  on public.channel_change_proposals (base_spec_version_id, created_at desc);
create index channel_change_proposals_state_idx
  on public.channel_change_proposals (approval_state, created_at desc);
create index channel_change_proposals_proposed_idx
  on public.channel_change_proposals (proposed_spec_version_id);

create table public.activation_receipts (
  id                          uuid primary key default gen_random_uuid(),
  schema_version              integer not null default 1 check (schema_version = 1),
  configuration_epoch_id      text not null unique check (configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'),
  proposal_id                 uuid not null unique references public.channel_change_proposals(id),
  old_spec_version_id         uuid not null references public.channel_spec_versions(id),
  new_spec_version_id         uuid not null references public.channel_spec_versions(id),
  release_manifest_id         uuid not null references public.release_manifests(id),
  exact_diff                  jsonb not null check (jsonb_typeof(exact_diff) = 'object'),
  validation_results          jsonb not null check (jsonb_typeof(validation_results) = 'array'),
  validator_versions          jsonb not null check (jsonb_typeof(validator_versions) = 'array'),
  approved_by                 text not null,
  scheduled_for               timestamptz not null,
  activated_at                timestamptz not null,
  safe_boundary_proof         jsonb not null check (jsonb_typeof(safe_boundary_proof) = 'object'),
  worker_acknowledgement      jsonb not null check (jsonb_typeof(worker_acknowledgement) = 'object'),
  rollback_target_manifest_id text not null,
  old_content_hash            text not null check (old_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  new_content_hash            text not null check (new_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  manifest_content_hash       text not null check (manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at                  timestamptz not null default now(),
  check (activated_at >= scheduled_for),
  check (old_spec_version_id <> new_spec_version_id),
  check (jsonb_array_length(validation_results) > 0),
  check (jsonb_array_length(validator_versions) > 0),
  check (safe_boundary_proof <> '{}'::jsonb),
  check (worker_acknowledgement <> '{}'::jsonb),
  check (length(btrim(approved_by)) > 0),
  check (length(btrim(rollback_target_manifest_id)) > 0)
);

create index activation_receipts_manifest_idx
  on public.activation_receipts (release_manifest_id, activated_at desc);
create index activation_receipts_spec_idx
  on public.activation_receipts (new_spec_version_id, activated_at desc);
create index activation_receipts_old_spec_idx
  on public.activation_receipts (old_spec_version_id, activated_at desc);

-- Version rows are immutable in semantic content. Only explicit lifecycle
-- transitions and retirement timestamps may change; any edit creates a new
-- version instead.
create or replace function seve_control.enforce_version_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'draft' then
    raise exception '% must be inserted as draft; lifecycle promotion requires guarded evidence', tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function seve_control.enforce_version_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are append-only', tg_table_name;
  end if;

  if (to_jsonb(new) - 'status' - 'valid_from' - 'valid_until')
      is distinct from (to_jsonb(old) - 'status' - 'valid_from' - 'valid_until') then
    raise exception '% semantic content is immutable; insert a new version', tg_table_name;
  end if;

  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('validated', 'rejected'))
    or (old.status = 'validated' and new.status in ('scheduled', 'rejected'))
    or (old.status = 'scheduled' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status in ('superseded', 'rolled_back'))
  ) then
    raise exception 'invalid % lifecycle transition: % -> %', tg_table_name, old.status, new.status;
  end if;

  if old.status = 'scheduled' and new.status = 'active' then
    if tg_table_name = 'channel_spec_versions' and not exists (
      select 1 from public.activation_receipts receipt
      where receipt.new_spec_version_id = new.id
        and receipt.activated_at <= now()
    ) then
      raise exception 'channel spec activation requires an activation receipt';
    end if;
    if tg_table_name = 'release_manifests' and not exists (
      select 1 from public.activation_receipts receipt
      where receipt.release_manifest_id = new.id
        and receipt.activated_at <= now()
    ) then
      raise exception 'release manifest activation requires an activation receipt';
    end if;
  end if;

  if new.valid_until is distinct from old.valid_until
      and new.status not in ('superseded', 'rolled_back') then
    raise exception '% valid_until requires a terminal active lifecycle state', tg_table_name;
  end if;
  if new.valid_from is distinct from old.valid_from
      and (old.valid_from is not null or new.valid_from is null
           or new.status not in ('scheduled', 'active')) then
    raise exception '% valid_from may be assigned once at scheduling/activation', tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function seve_control.enforce_proposal_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'channel_change_proposals rows are append-only';
  end if;

  if old.approval_state in ('approved', 'rejected', 'canceled') then
    raise exception 'terminal channel_change_proposals rows are append-only';
  end if;

  if (to_jsonb(new) - 'approval_state' - 'validation_results' - 'replay_summary'
      - 'capacity_collision_impact' - 'updated_at')
      is distinct from
     (to_jsonb(old) - 'approval_state' - 'validation_results' - 'replay_summary'
      - 'capacity_collision_impact' - 'updated_at') then
    raise exception 'proposal identity, base, patch, author, and change class are immutable';
  end if;

  if new.approval_state <> old.approval_state and not (
    (old.approval_state = 'draft' and new.approval_state in ('validated', 'rejected', 'canceled'))
    or (old.approval_state = 'validated' and new.approval_state in ('approved', 'rejected', 'canceled'))
  ) then
    raise exception 'invalid proposal lifecycle transition: % -> %', old.approval_state, new.approval_state;
  end if;

  if new.approval_state in ('validated', 'approved') then
    if new.proposed_spec_version_id is null then
      raise exception 'validated proposal requires a proposed spec version';
    end if;
    if jsonb_array_length(new.validation_results) = 0 or exists (
      select 1 from jsonb_array_elements(new.validation_results) result
      where result ->> 'state' <> 'pass'
    ) then
      raise exception 'validated proposal requires all validation gates to pass';
    end if;
    if new.replay_summary ->> 'state' <> 'sufficient' then
      raise exception 'validated proposal requires sufficient exact replay evidence';
    end if;
    if new.capacity_collision_impact ->> 'state' <> 'pass' then
      raise exception 'validated proposal requires passing capacity and collision evidence';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function seve_control.enforce_manifest_membership_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  manifest_status text;
begin
  select status into manifest_status
  from public.release_manifests
  where id = new.release_manifest_id;

  if manifest_status is null then
    raise exception 'manifest membership references a missing release manifest';
  end if;
  if manifest_status <> 'draft' then
    raise exception 'manifest membership may only be inserted while the manifest is draft';
  end if;
  return new;
end;
$$;

create or replace function seve_control.enforce_activation_receipt_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  old_spec public.channel_spec_versions%rowtype;
  new_spec public.channel_spec_versions%rowtype;
  manifest public.release_manifests%rowtype;
begin
  select * into proposal from public.channel_change_proposals where id = new.proposal_id;
  select * into old_spec from public.channel_spec_versions where id = new.old_spec_version_id;
  select * into new_spec from public.channel_spec_versions where id = new.new_spec_version_id;
  select * into manifest from public.release_manifests where id = new.release_manifest_id;

  if proposal.id is null or old_spec.id is null or new_spec.id is null or manifest.id is null then
    raise exception 'activation receipt references missing control-plane rows';
  end if;
  if proposal.activation_authorized is not true then
    raise exception 'activation is not explicitly authorized';
  end if;
  if proposal.approval_state <> 'approved'
      or proposal.base_spec_version_id <> old_spec.id
      or proposal.proposed_spec_version_id <> new_spec.id
      or proposal.base_spec_content_hash <> old_spec.content_hash then
    raise exception 'activation receipt does not match an approved proposal and exact base';
  end if;
  if old_spec.status <> 'active' or new_spec.status <> 'scheduled'
      or new_spec.parent_version_id <> old_spec.id then
    raise exception 'activation receipt requires active old spec and scheduled child spec';
  end if;
  if manifest.status <> 'scheduled' or not exists (
    select 1 from public.release_manifest_channels membership
    where membership.release_manifest_id = manifest.id
      and membership.channel_spec_version_id = new_spec.id
  ) then
    raise exception 'activation receipt requires a scheduled manifest containing the new spec';
  end if;
  if new.old_content_hash <> old_spec.content_hash
      or new.new_content_hash <> new_spec.content_hash
      or new.manifest_content_hash <> manifest.content_hash then
    raise exception 'activation receipt content hashes do not match referenced versions';
  end if;
  if new.validation_results <> proposal.validation_results then
    raise exception 'activation receipt validation results do not match the approved proposal';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.validation_results) result
    where result ->> 'state' <> 'pass'
  ) then
    raise exception 'activation receipt contains a non-passing validation gate';
  end if;
  if new.activated_at > now() + interval '5 minutes' then
    raise exception 'activation receipt cannot claim a materially future activation';
  end if;
  return new;
end;
$$;

create or replace function seve_control.reject_append_only_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

revoke all on function seve_control.enforce_version_lifecycle() from public, anon, authenticated;
revoke all on function seve_control.enforce_version_insert() from public, anon, authenticated;
revoke all on function seve_control.enforce_proposal_lifecycle() from public, anon, authenticated;
revoke all on function seve_control.enforce_manifest_membership_insert() from public, anon, authenticated;
revoke all on function seve_control.enforce_activation_receipt_insert() from public, anon, authenticated;
revoke all on function seve_control.reject_append_only_mutation() from public, anon, authenticated;
grant execute on function seve_control.enforce_version_lifecycle() to service_role;
grant execute on function seve_control.enforce_version_insert() to service_role;
grant execute on function seve_control.enforce_proposal_lifecycle() to service_role;
grant execute on function seve_control.enforce_manifest_membership_insert() to service_role;
grant execute on function seve_control.enforce_activation_receipt_insert() to service_role;
grant execute on function seve_control.reject_append_only_mutation() to service_role;

create trigger channel_spec_versions_insert_guard
  before insert on public.channel_spec_versions
  for each row execute function seve_control.enforce_version_insert();

create trigger release_manifests_insert_guard
  before insert on public.release_manifests
  for each row execute function seve_control.enforce_version_insert();

create trigger channel_spec_versions_lifecycle_guard
  before update or delete on public.channel_spec_versions
  for each row execute function seve_control.enforce_version_lifecycle();

create trigger release_manifests_lifecycle_guard
  before update or delete on public.release_manifests
  for each row execute function seve_control.enforce_version_lifecycle();

create trigger release_manifest_channels_append_only_guard
  before update or delete on public.release_manifest_channels
  for each row execute function seve_control.reject_append_only_mutation();

create trigger release_manifest_channels_insert_guard
  before insert on public.release_manifest_channels
  for each row execute function seve_control.enforce_manifest_membership_insert();

create trigger channel_change_proposals_lifecycle_guard
  before update or delete on public.channel_change_proposals
  for each row execute function seve_control.enforce_proposal_lifecycle();

create trigger activation_receipts_insert_guard
  before insert on public.activation_receipts
  for each row execute function seve_control.enforce_activation_receipt_insert();

create trigger activation_receipts_append_only_guard
  before update or delete on public.activation_receipts
  for each row execute function seve_control.reject_append_only_mutation();

-- New evidence may carry direct relational references after a separately
-- authorized cutover. Historical rows remain null and continue resolving via
-- policy_epochs/position_plans and exact JSON stamps; no backfill is performed.
alter table public.positions
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.position_plans
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.execution_observations
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

create index positions_channel_spec_version_idx
  on public.positions (channel_spec_version_id, opened_at desc)
  where channel_spec_version_id is not null;
create index positions_release_manifest_idx
  on public.positions (release_manifest_id, opened_at desc)
  where release_manifest_id is not null;
create index position_plans_channel_spec_version_idx
  on public.position_plans (channel_spec_version_id, created_at desc)
  where channel_spec_version_id is not null;
create index position_plans_release_manifest_idx
  on public.position_plans (release_manifest_id, created_at desc)
  where release_manifest_id is not null;
create index execution_observations_channel_spec_version_idx
  on public.execution_observations (channel_spec_version_id, event_at desc)
  where channel_spec_version_id is not null;
create index execution_observations_release_manifest_idx
  on public.execution_observations (release_manifest_id, event_at desc)
  where release_manifest_id is not null;

alter table public.channel_spec_versions enable row level security;
alter table public.release_manifests enable row level security;
alter table public.release_manifest_channels enable row level security;
alter table public.channel_change_proposals enable row level security;
alter table public.activation_receipts enable row level security;

revoke all on public.channel_spec_versions from public, anon, authenticated;
revoke all on public.release_manifests from public, anon, authenticated;
revoke all on public.release_manifest_channels from public, anon, authenticated;
revoke all on public.channel_change_proposals from public, anon, authenticated;
revoke all on public.activation_receipts from public, anon, authenticated;

grant select on public.channel_spec_versions to authenticated, service_role;
grant select on public.release_manifests to authenticated, service_role;
grant select on public.release_manifest_channels to authenticated, service_role;
grant select on public.channel_change_proposals to authenticated, service_role;
grant select on public.activation_receipts to authenticated, service_role;

grant insert, update on public.channel_spec_versions to service_role;
grant insert, update on public.release_manifests to service_role;
grant insert on public.release_manifest_channels to service_role;
grant insert, update on public.channel_change_proposals to service_role;
grant insert on public.activation_receipts to service_role;

create policy channel_spec_versions_operator_read on public.channel_spec_versions
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy release_manifests_operator_read on public.release_manifests
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy release_manifest_channels_operator_read on public.release_manifest_channels
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy channel_change_proposals_operator_read on public.channel_change_proposals
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy activation_receipts_operator_read on public.activation_receipts
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

comment on table public.channel_spec_versions is
  'Immutable semantic channel versions. Lifecycle metadata may advance only through guarded transitions.';
comment on table public.release_manifests is
  'Versioned paper-only release manifests. No row is activation authority without a matching activation receipt.';
comment on table public.channel_change_proposals is
  'Auditable proposals. Sentinel may insert evidence-backed drafts but activation_authorized is database-pinned false.';
comment on table public.activation_receipts is
  'Append-only safe-boundary activation proof. This migration creates no receipt and activates nothing.';
comment on column public.positions.configuration_epoch_id is
  'Nullable control-plane epoch for new rows only. Historical nulls must not be inferred from time windows.';

commit;
