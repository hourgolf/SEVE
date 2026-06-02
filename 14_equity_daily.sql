-- ============================================================================
--  14_equity_daily.sql   ·   run in the Supabase SQL editor
--
--  Daily fund-NAV rollup for long-range equity curves. One row per ET trading day:
--  that day's LAST (end-of-day) fund net_liquidation. The P&L·Equity panel's
--  Week/Month/All curves read this (a handful of points) instead of pulling
--  per-minute equity_snapshots — cheap and accurate over long windows.
--
--  NOTE: equity_snapshots is retention-capped (11_retention.sql, ~90d), so this
--  view spans at most ~90 days. For TRUE multi-quarter history, promote this to a
--  preserved daily TABLE the retention cron writes into (out of scope here).
--
--  Safe to re-run (create or replace). The panel falls back to per-minute snapshots
--  until this exists, so nothing breaks before/after running it.
-- ============================================================================

create or replace view public.equity_daily
  with (security_invoker = true)   -- respect the anon SELECT policy on equity_snapshots
as
select et_date, nav
from (
  select distinct on ((captured_at at time zone 'America/New_York')::date)
    (captured_at at time zone 'America/New_York')::date as et_date,
    net_liquidation                                     as nav
  from public.equity_snapshots
  where strategist_id is null            -- fund-level snapshots only
  order by (captured_at at time zone 'America/New_York')::date, captured_at desc
) d
order by et_date;

grant select on public.equity_daily to anon, authenticated;
