-- Accept both governed activation-receipt families as immutable configuration
-- epoch authority. The original epoch trigger predates roster-bundle activation
-- and therefore rejected otherwise valid position/evidence stamps after a
-- broker fill. Exact release-manifest membership remains mandatory.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
    raise exception '% configuration epoch stamp lacks an exact activation receipt and manifest membership',
      tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function seve_control.enforce_configuration_epoch_reference()
  from public, anon, authenticated;
grant execute on function seve_control.enforce_configuration_epoch_reference()
  to service_role;

commit;
