-- 55_today_readiness.sql — desk_today_gaps(): per-symbol gap for the TODAY readiness strip.
-- Returns the most-recent RTH session per symbol in underlying_bars with its gap (first RTH
-- open vs the prior RTH session's close). LEFT-joined on the prior session so a symbol whose
-- tape just started (no prior session, e.g. IWM the day it's first ingested) still returns —
-- with gap_pct NULL, so the strip shows "pending" not "no tape". Read-only + STABLE.
create or replace function desk_today_gaps()
returns table (
  symbol text,
  session_date date,
  gap_pct numeric,
  prior_close numeric,
  bars_today integer,
  latest_bar timestamptz
)
language sql
stable
as $$
  with b as (
    select ub.symbol, ub.open, ub.close, ub.ts,
      ((ub.ts at time zone 'America/New_York')::time) as ett,
      ((ub.ts at time zone 'America/New_York')::date) as ed
    from underlying_bars ub
    where ub.ts > now() - interval '12 days'
  ),
  rth as (select * from b where ett >= time '09:30' and ett < time '16:00'),
  opens  as (select distinct on (symbol, ed) symbol, ed, open, ts from rth order by symbol, ed, ts asc),
  closes as (select distinct on (symbol, ed) symbol, ed, close     from rth order by symbol, ed, ts desc),
  days as (
    select symbol, ed, row_number() over (partition by symbol order by ed desc) rn
    from (select distinct symbol, ed from rth) x
  )
  select
    o.symbol,
    d1.ed as session_date,
    case when c2.close is not null
      then round(((o.open - c2.close) / nullif(c2.close, 0) * 100)::numeric, 3)
      else null end as gap_pct,
    c2.close as prior_close,
    (select count(*)::int from rth r where r.symbol = o.symbol and r.ed = d1.ed) as bars_today,
    (select max(r.ts)     from rth r where r.symbol = o.symbol and r.ed = d1.ed) as latest_bar
  from days d1
  left join days d2   on d2.symbol = d1.symbol and d2.rn = 2
  join opens o        on o.symbol  = d1.symbol and o.ed = d1.ed
  left join closes c2 on c2.symbol = d1.symbol and c2.ed = d2.ed
  where d1.rn = 1;
$$;

grant execute on function desk_today_gaps() to anon, authenticated;
