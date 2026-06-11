-- ============================================================================
--  32_bars_retention.sql · W1 of the ingest wind-down (2026-06-11)
--  APPLIED to the live DB via the Supabase MCP the same evening — this file is
--  the repo record. SUPERSEDES the `seve-retention` job body from 11_retention.
--
--  underlying_bars was the unbounded table (65 MB, ~10-15 MB/month with QQQ).
--  W1: the full 1-min history is archived locally (data/bars-archive/<SYM>/,
--  scripts/export-bars.ts; engine/realsource.ts + the backfill scripts read
--  ARCHIVE-FIRST — golden-verified byte-identical), daily candles are persisted
--  in a tiny table so the chart's 3M/1Y/Max presets keep FULL depth forever,
--  and the 1-min table holds a rolling 60-day window.
--
--  ⚠ Do NOT re-run 07_backfill_bars.sql / 20_backfill_qqq_bars.sql for history
--  after this — they would refill the pruned window. History lives in the
--  archive (re-exportable from Alpaca via scripts/backfill-bars.ts if lost).
-- ============================================================================

-- 1) daily candles, persisted (the underlying_bars_daily view used to compute
--    these from 1-min on the fly — pruning 1-min would have shrunk the chart).
create table if not exists public.daily_bars_hist (
  symbol text not null,
  day    date not null,
  open numeric, high numeric, low numeric, close numeric,
  volume numeric, vwap numeric,
  primary key (symbol, day)
);
alter table public.daily_bars_hist enable row level security;
do $$ begin
  create policy daily_bars_hist_read on public.daily_bars_hist
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
grant select on public.daily_bars_hist to anon, authenticated;

-- 2) one-time backfill from the FULL 1-min history (run BEFORE the prune).
--    Aggregation is byte-identical to the old view (18_daily_bars_by_symbol).
insert into public.daily_bars_hist (symbol, day, open, high, low, close, volume, vwap)
select
  symbol,
  (date_trunc('day', ts))::date,
  (array_agg(open  order by ts asc))[1],
  max(high),
  min(low),
  (array_agg(close order by ts desc))[1],
  sum(volume),
  case when sum(volume) > 0 then sum(vwap * volume) / sum(volume) else avg(vwap) end
from public.underlying_bars
group by symbol, date_trunc('day', ts)
on conflict (symbol, day) do update
  set open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume, vwap = excluded.vwap;

-- 3) the view becomes live-window ∪ history (chart reads are unchanged; days
--    present in the 1-min window come live, older days from the hist table).
drop view if exists public.underlying_bars_daily;
create view public.underlying_bars_daily
with (security_invoker = true) as
with live as (
  select
    symbol,
    date_trunc('day', ts)                    as ts,
    (array_agg(open  order by ts asc))[1]    as open,
    max(high)                                as high,
    min(low)                                 as low,
    (array_agg(close order by ts desc))[1]   as close,
    sum(volume)                              as volume,
    case when sum(volume) > 0 then sum(vwap * volume) / sum(volume) else avg(vwap) end as vwap
  from public.underlying_bars
  group by symbol, date_trunc('day', ts)
)
select * from live
union all
select h.symbol, h.day::timestamptz, h.open, h.high, h.low, h.close, h.volume, h.vwap
from public.daily_bars_hist h
where not exists (select 1 from live l where l.symbol = h.symbol and l.ts = h.day::timestamptz);
grant select on public.underlying_bars_daily to anon, authenticated;

-- 4) retention: nightly upsert of finalized daily candles, then trim the 1-min
--    window. REPLACES the 11_retention job body (same name/schedule + 2 steps).
select cron.unschedule('seve-retention')
where exists (select 1 from cron.job where jobname = 'seve-retention');

select cron.schedule('seve-retention', '17 6 * * *', $$
  delete from option_quotes    where captured_at < now() - interval '7 days';
  delete from events           where created_at  < now() - interval '30 days';
  delete from equity_snapshots where captured_at < now() - interval '90 days';
  insert into daily_bars_hist (symbol, day, open, high, low, close, volume, vwap)
  select symbol, (date_trunc('day', ts))::date,
    (array_agg(open order by ts asc))[1], max(high), min(low),
    (array_agg(close order by ts desc))[1], sum(volume),
    case when sum(volume) > 0 then sum(vwap * volume) / sum(volume) else avg(vwap) end
  from underlying_bars
  group by symbol, date_trunc('day', ts)
  on conflict (symbol, day) do update
    set open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume, vwap = excluded.vwap;
  delete from underlying_bars where ts < now() - interval '60 days';
$$);

-- 5) the initial prune itself (run AFTER the golden verify passed):
--    delete from underlying_bars where ts < now() - interval '60 days';
--    vacuum (full) underlying_bars;  -- reclaims the freed pages
