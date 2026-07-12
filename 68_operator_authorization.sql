-- 68: lock every desk mutation to explicitly provisioned SEVE operators.
--
-- PREREQUISITE (admin-only): set raw_app_meta_data.seve_role='operator' on the
-- intended auth.users rows, then have those users sign out/in to refresh JWTs.
-- This migration fails closed if no operator has been provisioned.

begin;

do $$
begin
  if not exists (
    select 1 from auth.users
    where raw_app_meta_data ->> 'seve_role' = 'operator'
  ) then
    raise exception 'No SEVE operator provisioned; set auth.users.raw_app_meta_data.seve_role before applying 68';
  end if;
end $$;

-- This helper was created during early schema setup and must never be remotely
-- callable: it is SECURITY DEFINER and changes RLS state.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

drop policy if exists auth_update_strategist_config on public.strategist_config;
create policy auth_update_strategist_config on public.strategist_config
  for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_insert_strategist_config on public.strategist_config;
create policy auth_insert_strategist_config on public.strategist_config
  for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_delete_strategist_config on public.strategist_config;
create policy auth_delete_strategist_config on public.strategist_config
  for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_update_fund_state on public.fund_state;
create policy auth_update_fund_state on public.fund_state
  for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_insert_strategists on public.strategists;
create policy auth_insert_strategists on public.strategists
  for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_update_strategists on public.strategists;
create policy auth_update_strategists on public.strategists
  for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists auth_delete_strategists on public.strategists;
create policy auth_delete_strategists on public.strategists
  for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

drop policy if exists accounts_auth_write on public.accounts;
create policy accounts_auth_write on public.accounts
  for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
