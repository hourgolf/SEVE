-- ============================================================================
--  11_retention.sql   ·   keep the DB lean — purge research data, cap the rest.
--  The free tier is 0.5 GB. The avalanche is backtest data kept permanently:
--    - option_bars: ~1.5M rows of historical option prices (RESEARCH ONLY).
--    - option_quotes: ~28k rows/day from market-ingest, never cleaned up.
--  The live desk only ever reads RECENT data, so we don't keep history here.
-- ============================================================================

-- ── Move 1: reclaim space NOW (frees ~350 MB immediately) ───────────────────
-- option_bars is only needed transiently for backtests. Re-populate on demand
-- with `npm run backfill:options` when you want to re-run research.
truncate table option_bars;

-- ── Move 2: rolling retention so live data never balloons ───────────────────
create extension if not exists pg_cron;

-- one-time catch-up of the existing option_quotes backlog
delete from option_quotes where captured_at < now() - interval '2 days';

-- daily job at 06:17 UTC (off-hours): trim each table to a rolling window
select cron.unschedule('seve-retention')
where exists (select 1 from cron.job where jobname = 'seve-retention');

select cron.schedule('seve-retention', '17 6 * * *', $$
  delete from option_quotes    where captured_at < now() - interval '2 days';
  delete from events           where created_at  < now() - interval '30 days';
  delete from equity_snapshots where captured_at < now() - interval '90 days';
$$);

-- Verify after running:
--   select pg_size_pretty(pg_database_size(current_database()));
--   select pg_size_pretty(pg_total_relation_size('option_quotes'));
--
-- Note: TRUNCATE reclaims space immediately; the daily DELETEs are reclaimed by
-- autovacuum over time. underlying_bars (~20 MB for 2.3 yrs) is cheap — kept for
-- research; prune it too if you ever need the headroom.
-- ============================================================================
