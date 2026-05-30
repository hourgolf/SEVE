-- ============================================================================
--  05_console_write_policies.sql   ·   run AFTER 04_dashboard_read_policies.sql
--  Multi-user write access for the SEVE Console.
--
--  Model: ANY signed-in (authenticated) user may operate the desk — turn knobs
--  (strategist_config) and work the master strip / kill switch (fund_state).
--  The anon (logged-out) key stays READ-ONLY via the 04 policies.
--
--  IMPORTANT: a logged-in user's JWT role is `authenticated`, NOT `anon`, so the
--  anon-only read policies from 04 would stop applying to them. This file ALSO
--  grants `authenticated` SELECT on the six dashboard tables so reads keep
--  working after login.
--
--  Only UPDATE is granted on the two console tables (the rows already exist —
--  no INSERT/DELETE). Bot-written tables (positions/signals/orders/fills) are
--  never writable from the dashboard.
--
--  Safe to re-run: drops + recreates each policy idempotently.
-- ============================================================================

-- ---- 1) authenticated users can READ the same six tables as anon -----------
do $$
declare
  t text;
  read_tables text[] := array[
    'strategists',
    'strategist_config',
    'fund_state',
    'positions',
    'signals',
    'equity_snapshots'
  ];
begin
  foreach t in array read_tables loop
    execute format('grant select on public.%I to authenticated;', t);
    execute format('drop policy if exists %I on public.%I;', 'auth_read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true);',
      'auth_read_' || t, t
    );
  end loop;
end $$;

-- ---- 2) authenticated users can UPDATE the two console tables ---------------
grant update on public.strategist_config to authenticated;
grant update on public.fund_state        to authenticated;

drop policy if exists auth_update_strategist_config on public.strategist_config;
create policy auth_update_strategist_config on public.strategist_config
  for update to authenticated using (true) with check (true);

drop policy if exists auth_update_fund_state on public.fund_state;
create policy auth_update_fund_state on public.fund_state
  for update to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
--  OPTIONAL — restrict writes to an allowlist instead of "any signed-in user".
--  Replace the two update policies above with a check against approved emails:
--
--    using ( (auth.jwt() ->> 'email') in ('you@example.com','partner@example.com') )
--    with check ( (auth.jwt() ->> 'email') in ('you@example.com','partner@example.com') )
--
--  (Reads can stay open to all authenticated users, or be similarly gated.)
-- ============================================================================
