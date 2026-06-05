-- ============================================================================
--  18_daily_bars_by_symbol.sql · per-symbol daily rollup (QQQ rollout, step 4)
--
--  market-ingest v3 (step 1) now writes BOTH SPY and QQQ rows into underlying_bars,
--  but the old underlying_bars_daily view grouped ONLY by day — so it silently MIXED
--  the two tickers into one bogus candle (max(high) across SPY+QQQ, summed volume,
--  etc). This recreates the view grouped by (symbol, day) and exposes `symbol`, so the
--  chart's long-range presets (3M / 1Y / Max) can filter to the selected instrument.
--
--  • Still a plain view (security_invoker) → always current, RLS-respecting, no cron.
--  • One UTC day == one trading session for both SPY and QQQ (RTH 14:30–21:00 UTC).
--  • Backward-compatible: SPY reads keep working; the client just adds .eq("symbol", …).
--
--  Run once in the Supabase SQL editor (it CREATE OR REPLACEs the existing view).
-- ============================================================================

create or replace view public.underlying_bars_daily
with (security_invoker = true) as
select
  symbol,
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
group by symbol, date_trunc('day', ts);

-- Expose to the dashboard's anon (and signed-in) reads via PostgREST.
grant select on public.underlying_bars_daily to anon, authenticated;

-- verify (newest 5 trading days per ticker)
-- select * from public.underlying_bars_daily order by ts desc, symbol limit 10;
