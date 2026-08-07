-- PROPOSED / UNAPPLIED: forward-only provenance for virtual research paths.
--
-- This migration is additive and performs no backfill. Existing rows remain
-- configuration-unstamped. A future publisher may stamp a new row only from an
-- exact activation receipt + release-manifest membership; mutable strategist
-- state and timestamp proximity are never authority.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.virtual_trades
  add column channel_spec_version_id uuid references public.channel_spec_versions(id),
  add column release_manifest_id uuid references public.release_manifests(id),
  add column configuration_epoch_id text check (
    configuration_epoch_id is null
      or configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
  ),
  add column native_manager_policy_version text check (
    native_manager_policy_version is null
      or length(native_manager_policy_version) between 1 and 160
  ),
  add column research_publisher_version text check (
    research_publisher_version is null
      or length(research_publisher_version) between 1 and 160
  );

alter table public.virtual_trades
  add constraint virtual_trades_configuration_epoch_all_or_none check (
    (channel_spec_version_id is null)
      = (release_manifest_id is null)
    and (release_manifest_id is null)
      = (configuration_epoch_id is null)
  ) not valid;

alter table public.virtual_trades
  validate constraint virtual_trades_configuration_epoch_all_or_none;

create or replace function seve_control.enforce_virtual_trade_provenance()
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
        or new.native_manager_policy_version is distinct from old.native_manager_policy_version
        or new.research_publisher_version is distinct from old.research_publisher_version
      ) then
    raise exception 'virtual_trades provenance is immutable';
  end if;

  if new.channel_spec_version_id is null
      and new.release_manifest_id is null
      and new.configuration_epoch_id is null then
    return new;
  end if;

  if new.channel_spec_version_id is null
      or new.release_manifest_id is null
      or new.configuration_epoch_id is null then
    raise exception 'virtual_trades configuration provenance must be all-or-none';
  end if;

  if not (
    exists (
      select 1
      from public.activation_receipts receipt
      join public.release_manifest_channels membership
        on membership.release_manifest_id = receipt.release_manifest_id
      where receipt.release_manifest_id = new.release_manifest_id
        and receipt.configuration_epoch_id = new.configuration_epoch_id
        and membership.channel_spec_version_id = new.channel_spec_version_id
    )
    or exists (
      select 1
      from public.channel_roster_bundle_activation_receipts receipt
      join public.release_manifest_channels membership
        on membership.release_manifest_id = receipt.release_manifest_id
      where receipt.release_manifest_id = new.release_manifest_id
        and receipt.configuration_epoch_id = new.configuration_epoch_id
        and membership.channel_spec_version_id = new.channel_spec_version_id
    )
  ) then
    raise exception 'virtual_trades provenance lacks an exact activation receipt and manifest membership';
  end if;
  return new;
end;
$$;

create trigger virtual_trades_provenance_10_validate
  before insert or update on public.virtual_trades
  for each row execute function seve_control.enforce_virtual_trade_provenance();

revoke all on function seve_control.enforce_virtual_trade_provenance()
  from public, anon, authenticated;
grant execute on function seve_control.enforce_virtual_trade_provenance()
  to service_role;

comment on column public.virtual_trades.channel_spec_version_id is
  'Forward-only immutable source configuration; null means configuration-unstamped.';
comment on column public.virtual_trades.release_manifest_id is
  'Forward-only immutable source release; null means configuration-unstamped.';
comment on column public.virtual_trades.configuration_epoch_id is
  'Forward-only immutable source epoch; never inferred from timestamps or current settings.';
comment on column public.virtual_trades.native_manager_policy_version is
  'Native exit policy used by the deterministic virtual-path publisher, when source-proven.';
comment on column public.virtual_trades.research_publisher_version is
  'Deterministic research publisher version; null identifies historical legacy rows.';

commit;
