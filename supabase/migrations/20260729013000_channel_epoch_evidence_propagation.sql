-- PROPOSED / UNAPPLIED: immutable receipt-bound epoch propagation.
--
-- This migration is additive and performs no backfill. Historical nulls remain
-- null and must never be inferred from timestamps or mutable strategist rows.
-- New receipt-bound evidence carries the exact activated manifest, member spec,
-- and configuration epoch. Downstream evidence may inherit only from its
-- immutable position row.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.signals
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.position_outcome_events
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.execution_quality_receipts
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.held_contract_capture_receipts
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.manager_shadow_runs
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  );

alter table public.signals
  add constraint signals_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.positions
  add constraint positions_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.position_plans
  add constraint position_plans_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.execution_observations
  add constraint execution_observations_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.position_outcome_events
  add constraint position_outcome_events_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.execution_quality_receipts
  add constraint execution_quality_receipts_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.held_contract_capture_receipts
  add constraint held_contract_capture_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;
alter table public.manager_shadow_runs
  add constraint manager_shadow_runs_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;

alter table public.signals
  validate constraint signals_configuration_epoch_all_or_none;
alter table public.positions
  validate constraint positions_configuration_epoch_all_or_none;
alter table public.position_plans
  validate constraint position_plans_configuration_epoch_all_or_none;
alter table public.execution_observations
  validate constraint execution_observations_configuration_epoch_all_or_none;
alter table public.position_outcome_events
  validate constraint position_outcome_events_configuration_epoch_all_or_none;
alter table public.execution_quality_receipts
  validate constraint execution_quality_receipts_configuration_epoch_all_or_none;
alter table public.held_contract_capture_receipts
  validate constraint held_contract_capture_configuration_epoch_all_or_none;
alter table public.manager_shadow_runs
  validate constraint manager_shadow_runs_configuration_epoch_all_or_none;

create or replace function seve_control.enforce_configuration_epoch_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
      and (
        new.channel_spec_version_id is distinct from old.channel_spec_version_id
        or new.release_manifest_id is distinct from old.release_manifest_id
        or new.configuration_epoch_id is distinct from old.configuration_epoch_id
      ) then
    raise exception '% configuration epoch stamp is immutable', tg_table_name;
  end if;

  if new.channel_spec_version_id is null
      and new.release_manifest_id is null
      and new.configuration_epoch_id is null then
    return new;
  end if;

  if new.channel_spec_version_id is null
      or new.release_manifest_id is null
      or new.configuration_epoch_id is null then
    raise exception '% configuration epoch stamp must be all-or-none', tg_table_name;
  end if;

  if not exists (
    select 1
    from public.activation_receipts receipt
    join public.release_manifest_channels membership
      on membership.release_manifest_id = receipt.release_manifest_id
    where receipt.release_manifest_id = new.release_manifest_id
      and receipt.configuration_epoch_id = new.configuration_epoch_id
      and membership.channel_spec_version_id = new.channel_spec_version_id
  ) then
    raise exception '% configuration epoch stamp lacks an exact activation receipt and manifest membership',
      tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function seve_control.inherit_configuration_epoch_from_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_position public.positions%rowtype;
begin
  if new.position_id is null then
    return new;
  end if;

  select * into source_position
  from public.positions
  where id = new.position_id;

  if source_position.id is null then
    raise exception '% references a missing position', tg_table_name;
  end if;
  if source_position.channel_spec_version_id is null
      and source_position.release_manifest_id is null
      and source_position.configuration_epoch_id is null then
    if new.channel_spec_version_id is not null
        or new.release_manifest_id is not null
        or new.configuration_epoch_id is not null then
      raise exception '% cannot attach receipt-bound evidence to an unstamped position',
        tg_table_name;
    end if;
    return new;
  end if;

  if new.channel_spec_version_id is null
      and new.release_manifest_id is null
      and new.configuration_epoch_id is null then
    new.channel_spec_version_id := source_position.channel_spec_version_id;
    new.release_manifest_id := source_position.release_manifest_id;
    new.configuration_epoch_id := source_position.configuration_epoch_id;
    return new;
  end if;

  if new.channel_spec_version_id is distinct from source_position.channel_spec_version_id
      or new.release_manifest_id is distinct from source_position.release_manifest_id
      or new.configuration_epoch_id is distinct from source_position.configuration_epoch_id then
    raise exception '% configuration epoch disagrees with immutable position provenance',
      tg_table_name;
  end if;
  return new;
end;
$$;

create trigger positions_configuration_epoch_10_validate
  before insert or update on public.positions
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger position_plans_configuration_epoch_00_inherit
  before insert or update on public.position_plans
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger position_plans_configuration_epoch_10_validate
  before insert or update on public.position_plans
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger execution_observations_configuration_epoch_00_inherit
  before insert on public.execution_observations
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger execution_observations_configuration_epoch_10_validate
  before insert on public.execution_observations
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger signals_configuration_epoch_10_validate
  before insert or update on public.signals
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger position_outcome_events_configuration_epoch_00_inherit
  before insert on public.position_outcome_events
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger position_outcome_events_configuration_epoch_10_validate
  before insert on public.position_outcome_events
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger execution_quality_receipts_configuration_epoch_00_inherit
  before insert on public.execution_quality_receipts
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger execution_quality_receipts_configuration_epoch_10_validate
  before insert on public.execution_quality_receipts
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger held_contract_capture_configuration_epoch_00_inherit
  before insert on public.held_contract_capture_receipts
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger held_contract_capture_configuration_epoch_10_validate
  before insert on public.held_contract_capture_receipts
  for each row execute function seve_control.enforce_configuration_epoch_reference();
create trigger manager_shadow_runs_configuration_epoch_00_inherit
  before insert on public.manager_shadow_runs
  for each row execute function seve_control.inherit_configuration_epoch_from_position();
create trigger manager_shadow_runs_configuration_epoch_10_validate
  before insert or update on public.manager_shadow_runs
  for each row execute function seve_control.enforce_configuration_epoch_reference();

create index signals_configuration_epoch_idx
  on public.signals (configuration_epoch_id, created_at desc)
  where configuration_epoch_id is not null;
create index position_outcomes_configuration_epoch_idx
  on public.position_outcome_events (configuration_epoch_id, event_at desc)
  where configuration_epoch_id is not null;
create index execution_quality_configuration_epoch_idx
  on public.execution_quality_receipts (configuration_epoch_id, trigger_at desc)
  where configuration_epoch_id is not null;
create index held_contract_capture_configuration_epoch_idx
  on public.held_contract_capture_receipts (configuration_epoch_id, first_fetch_at desc)
  where configuration_epoch_id is not null;
create index manager_shadow_runs_configuration_epoch_idx
  on public.manager_shadow_runs (configuration_epoch_id, created_at desc)
  where configuration_epoch_id is not null;

revoke all on function seve_control.enforce_configuration_epoch_reference()
  from public, anon, authenticated;
revoke all on function seve_control.inherit_configuration_epoch_from_position()
  from public, anon, authenticated;
grant execute on function seve_control.enforce_configuration_epoch_reference()
  to service_role;
grant execute on function seve_control.inherit_configuration_epoch_from_position()
  to service_role;

comment on column public.signals.configuration_epoch_id is
  'Nullable only for pre-cutover evidence. New receipt-bound candidates carry the exact activation epoch.';
comment on column public.position_outcome_events.configuration_epoch_id is
  'Inherited only from the immutable position provenance; never from current channel configuration.';
comment on column public.held_contract_capture_receipts.configuration_epoch_id is
  'Inherited only from the immutable position provenance; never inferred by time.';
comment on column public.manager_shadow_runs.configuration_epoch_id is
  'Inherited only from the immutable position provenance; manager observations cannot reinterpret an open position.';

commit;
