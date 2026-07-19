-- Convert the SEVE desk from a public read-only monitor with operator controls
-- into a private single-operator application. The service role continues to
-- bypass RLS for workers/publishers; browser reads require the immutable
-- app_metadata.seve_role = operator claim.

-- Remove every legacy anonymous/public dashboard read policy.
drop policy if exists accounts_anon_read on public.accounts;
drop policy if exists daily_bars_hist_read on public.daily_bars_hist;
drop policy if exists anon_read_daily_reports on public.daily_reports;
drop policy if exists auth_read_daily_reports on public.daily_reports;
drop policy if exists anon_read_equity_snapshots on public.equity_snapshots;
drop policy if exists auth_read_equity_snapshots on public.equity_snapshots;
drop policy if exists "dashboard read" on public.events;
drop policy if exists "read forensics_reports" on public.forensics_reports;
drop policy if exists "read foulout_ledger" on public.foulout_ledger;
drop policy if exists anon_read_fund_state on public.fund_state;
drop policy if exists auth_read_fund_state on public.fund_state;
drop policy if exists anon_read_option_bars on public.option_bars;
drop policy if exists auth_read_option_bars on public.option_bars;
drop policy if exists "dashboard read" on public.option_quotes;
drop policy if exists "read override_ledger" on public.override_ledger;
drop policy if exists anon_read_positions on public.positions;
drop policy if exists auth_read_positions on public.positions;
drop policy if exists anon_read_signals on public.signals;
drop policy if exists auth_read_signals on public.signals;
drop policy if exists anon_read_strategist_config on public.strategist_config;
drop policy if exists auth_read_strategist_config on public.strategist_config;
drop policy if exists anon_read_strategists on public.strategists;
drop policy if exists auth_read_strategists on public.strategists;
drop policy if exists "dashboard read" on public.underlying_bars;
drop policy if exists read_virtual_trades on public.virtual_trades;
drop policy if exists anon_read_weekly_reports on public.weekly_reports;
drop policy if exists auth_read_weekly_reports on public.weekly_reports;
drop policy if exists worker_heartbeat_read on public.worker_heartbeat;
drop policy if exists worker_runs_read on public.worker_runs;

-- Remove browser-readable grants from anon/PUBLIC even if RLS is accidentally
-- relaxed later, and retain browser SELECT for authenticated operator sessions.
do $private_desk$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'accounts', 'daily_bars_hist', 'daily_reports', 'equity_snapshots',
    'events', 'forensics_reports', 'foulout_ledger', 'fund_state',
    'option_bars', 'option_quotes', 'override_ledger', 'positions', 'signals',
    'strategist_config', 'strategists', 'underlying_bars', 'virtual_trades',
    'weekly_reports', 'worker_heartbeat', 'worker_runs'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('revoke all on table public.%I from anon', relation_name);
    execute format('revoke all on table public.%I from public', relation_name);
    execute format('grant select on table public.%I to authenticated', relation_name);
    execute format(
      'create policy operator_private_read on public.%I for select to authenticated using (((select auth.jwt()) -> ''app_metadata'' ->> ''seve_role'') = ''operator'')',
      relation_name
    );
  end loop;
end
$private_desk$;

comment on policy operator_private_read on public.accounts is
  'Private SEVE desk: browser reads require app_metadata.seve_role=operator.';
