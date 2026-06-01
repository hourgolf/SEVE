-- ============================================================================
--  12_daily_bars_view.sql — daily OHLCV rollup of underlying_bars
--
--  Powers the chart's long-range presets (3M / 1Y / Max) so they read ~250–580
--  daily rows instead of 100k+ one-minute bars. Read-only; no worker changes.
--
--  • Regular view (not materialized) → always current, no refresh cron needed.
--  • security_invoker = true → runs as the querying role, so the existing
--    anon SELECT policy on underlying_bars still governs access (no RLS bypass).
--  • Grouped by UTC day; SPY's session (14:30–21:00 UTC) never crosses UTC
--    midnight, so one UTC day == one trading session.
--
--  Run in the Supabase SQL editor.
-- ============================================================================

create or replace view public.underlying_bars_daily
with (security_invoker = true) as
select
  date_trunc('day', ts)                    as ts,
  (array_agg(open  order by ts asc))[1]    as open,
  max(high)                                as high,
  min(low)                                 as low,
  (array_agg(close order by ts desc))[1]   as close,
  sum(volume)                              as volume,
  case
    when sum(volume) > 0 then sum(vwap * volume) / sum(volume)
    else avg(vwap)
  end                                      as vwap
from public.underlying_bars
group by date_trunc('day', ts);

-- Expose to the dashboard's anon (and signed-in) reads via PostgREST.
grant select on public.underlying_bars_daily to anon, authenticated;

-- verify (newest 5 trading days)
-- select * from public.underlying_bars_daily order by ts desc limit 5;
