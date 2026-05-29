-- ============================================================================
--  04_dashboard_read_policies.sql   ·   run AFTER the schema + market data SQL
--  Grants the dashboard's anon (publishable) key READ-ONLY access to the desk
--  tables it needs, the same way the three market tables (option_quotes,
--  underlying_bars, events) are already exposed.
--
--  RLS stays ENABLED on every table — this only adds permissive SELECT policies
--  for the `anon` role. No write access is granted (writes are a later phase
--  that will use authenticated policies). The service-role key is never used by
--  the dashboard.
--
--  Safe to re-run: it drops and recreates each policy idempotently.
-- ============================================================================

grant usage on schema public to anon;

do $$
declare
  t text;
  tables text[] := array[
    'strategists',
    'strategist_config',
    'fund_state',
    'positions',
    'signals',
    'equity_snapshots'
  ];
begin
  foreach t in array tables loop
    execute format('grant select on public.%I to anon;', t);
    execute format('drop policy if exists %I on public.%I;', 'anon_read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to anon using (true);',
      'anon_read_' || t, t
    );
  end loop;
end $$;

-- Verify (optional): each should return without "permission denied".
-- select count(*) from strategist_config;
-- select count(*) from fund_state;
