-- ============================================================================
--  02_market_data.sql   ·   run AFTER trading-desk-schema.sql
--  Where the real tape lands: SPY minute bars + near-ATM 0DTE/1DTE option
--  snapshots. This is the substrate the analysts read; it holds no trades.
-- ============================================================================

-- SPY (or any underlying) 1-minute bars — the price tape.
create table underlying_bars (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null default 'SPY',
  ts          timestamptz not null,          -- the bar's own timestamp
  open        numeric(12,4),
  high        numeric(12,4),
  low         numeric(12,4),
  close       numeric(12,4),
  volume      bigint,
  vwap        numeric(12,4),
  captured_at timestamptz not null default now(),
  unique (symbol, ts)                          -- dedupe re-polls of the same bar
);
create index idx_bars_symbol_ts on underlying_bars (symbol, ts desc);

-- Option-chain snapshots: one row per contract per poll. Over a day this
-- becomes the time series of how each near-the-money contract's price and
-- greeks moved — the raw material for every signal you'll later test.
create table option_quotes (
  id               uuid primary key default gen_random_uuid(),
  occ_symbol       text not null,             -- e.g. SPY260529C00756000
  underlying       text not null default 'SPY',
  expiration       date not null,
  strike           numeric(10,2) not null,
  opt_type         option_type not null,
  underlying_price numeric(12,4),             -- SPY spot at capture time
  bid              numeric(10,4),
  ask              numeric(10,4),
  mid              numeric(10,4) generated always as ((bid + ask) / 2) stored,
  last             numeric(10,4),
  bid_size         int,
  ask_size         int,
  iv               numeric(8,4),
  delta numeric(8,4), gamma numeric(8,4), theta numeric(8,4), vega numeric(8,4), rho numeric(8,4),
  captured_at      timestamptz not null default now()
);
create index idx_oq_symbol_time on option_quotes (occ_symbol, captured_at desc);
create index idx_oq_chain       on option_quotes (underlying, expiration, captured_at desc);

alter table underlying_bars enable row level security;
alter table option_quotes   enable row level security;


-- ============================================================================
--  SCHEDULE  ·  pg_cron + pg_net  (same pattern as the Hour Golf access codes)
--  Fill in <PROJECT_REF> and a key, then run. Runs every minute during the
--  US cash session. Note: cron runs in UTC — 13:30–20:00 UTC ≈ 9:30a–4:00p ET
--  during EDT. The hour range below slightly over-covers the open/close; tighten
--  if you like, and shift by an hour when the US flips off daylight time.
-- ============================================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'market-ingest-1m',
--   '* 13-20 * * 1-5',                       -- every minute, hours 13–20 UTC, Mon–Fri
--   $$
--     select net.http_post(
--       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/market-ingest',
--       headers := jsonb_build_object(
--                    'Authorization', 'Bearer <SUPABASE_ANON_OR_SERVICE_KEY>',
--                    'Content-Type',  'application/json'),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
--
-- -- to stop it later:  select cron.unschedule('market-ingest-1m');
