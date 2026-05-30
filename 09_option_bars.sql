-- ============================================================================
--  09_option_bars.sql   ·   historical option TRADE bars (real price paths).
--  Alpaca serves historical option bars/trades (not bid/ask) on the free plan,
--  so we store real per-minute option OHLC here. The backtest fills at the real
--  price ± a modeled spread — far more trustworthy than fully-modeled BS chains.
--
--  Run this once, then run the backfill:  npm run backfill:options
--  (the script writes with the service-role key; the dashboard reads via anon).
-- ============================================================================

create table if not exists option_bars (
  occ_symbol   text        not null,
  ts           timestamptz not null,           -- bar (minute) timestamp
  expiration   date        not null,
  strike       numeric(10,2) not null,
  opt_type     option_type not null,
  open         numeric(10,4),
  high         numeric(10,4),
  low          numeric(10,4),
  close        numeric(10,4),                   -- last trade in the minute
  volume       bigint,
  trade_count  int,
  primary key (occ_symbol, ts)
);
create index if not exists idx_option_bars_chain
  on option_bars (expiration, strike, opt_type, ts);
create index if not exists idx_option_bars_exp_ts
  on option_bars (expiration, ts);

-- RLS: read-only for the dashboard/engine (anon + authenticated); writes happen
-- with the service-role key (bypasses RLS) from the backfill script.
alter table option_bars enable row level security;
grant select on option_bars to anon, authenticated;

drop policy if exists anon_read_option_bars on option_bars;
create policy anon_read_option_bars on option_bars for select to anon using (true);

drop policy if exists auth_read_option_bars on option_bars;
create policy auth_read_option_bars on option_bars for select to authenticated using (true);
