-- ============================================================================
--  06_realtime.sql   ·   run once in the Supabase SQL editor
--  Enables Supabase Realtime (Postgres change streams) on the tables the
--  dashboard watches, so the UI updates the instant new rows land instead of
--  waiting for the polling fallback.
--
--  Realtime honors Row-Level Security, so the existing SELECT policies
--  (04_dashboard_read_policies.sql) already gate what each client receives —
--  this only adds the tables to the realtime publication.
--
--  Safe + idempotent: skips any table already in the publication.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'underlying_bars',
    'option_quotes',
    'events',
    'positions',
    'signals',
    'equity_snapshots'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;
