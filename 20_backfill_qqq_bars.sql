-- ============================================================================
--  20_backfill_qqq_bars.sql · historical minute backfill for ANY ticker (QQQ).
--  Supersedes 07_backfill_bars.sql's SPY-only helpers: `fire_bars` takes the
--  symbol as a param, and `ingest_recent_bars` now reads the ticker FROM each
--  Alpaca response (its top-level "symbol" field) instead of hardcoding 'SPY' —
--  so the same ingest handles SPY and QQQ responses in one pass.
--
--  pg_net is async: the request is only SENT after the queuing txn COMMITs, and
--  the body is readable only in a LATER txn. So: (1) fire, (2) wait ~15s, (3) ingest.
--  You need your Alpaca key + secret (the same creds behind market-ingest).
--
--  Run in the Supabase SQL editor.
-- ============================================================================

create extension if not exists pg_net;

-- Fire ONE window's request for ANY symbol; returns its pg_net request id.
create or replace function fire_bars(p_symbol text, p_start date, p_end date, p_key text, p_secret text)
returns bigint language sql as $$
  select net.http_get(
    url := format(
      'https://data.alpaca.markets/v2/stocks/%s/bars'
      || '?timeframe=1Min&start=%s&end=%s&feed=iex&limit=10000&adjustment=raw&sort=asc',
      p_symbol, p_start, p_end
    ),
    headers := jsonb_build_object(
      'APCA-API-KEY-ID', p_key,
      'APCA-API-SECRET-KEY', p_secret,
      'accept', 'application/json'
    ),
    timeout_milliseconds := 30000
  );
$$;

-- Ingest every recent (last 15 min) successful bars response into underlying_bars,
-- tagging each with the ticker the RESPONSE reports (so SPY + QQQ fires both land
-- correctly). Safe to run repeatedly; (symbol, ts) dedupes.
create or replace function ingest_recent_bars()
returns integer language plpgsql as $$
declare v_count int;
begin
  with resp as (
    select (r.content)::jsonb as j
    from net._http_response r
    where r.status_code = 200
      and r.created > now() - interval '15 minutes'
      and r.content is not null
      and left(btrim(r.content), 1) = '{'      -- only JSON object bodies
  )
  insert into underlying_bars (symbol, ts, open, high, low, close, volume, vwap)
  select coalesce(resp.j ->> 'symbol', 'SPY'),
         (b->>'t')::timestamptz, (b->>'o')::numeric, (b->>'h')::numeric,
         (b->>'l')::numeric, (b->>'c')::numeric, (b->>'v')::bigint, (b->>'vw')::numeric
  from resp, jsonb_array_elements(coalesce(resp.j -> 'bars', '[]'::jsonb)) as b
  where resp.j ? 'bars'
  on conflict (symbol, ts) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================================
--  HOW TO RUN  (replace PK_YOUR_KEY / YOUR_SECRET with your Alpaca creds)
--
--  STEP 1 — fire the fetches for QQQ, month by month (each commits, then Alpaca is
--  called). Start with a few recent months; extend the range later if storage allows
--  (free tier 0.5 GB — see 11_retention.sql). Example, last ~6 months:
--
--    select fire_bars('QQQ','2026-01-02','2026-01-31','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_bars('QQQ','2026-02-01','2026-02-28','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_bars('QQQ','2026-03-01','2026-03-31','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_bars('QQQ','2026-04-01','2026-04-30','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_bars('QQQ','2026-05-01','2026-05-31','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_bars('QQQ','2026-06-01','2026-06-04','PK_YOUR_KEY','YOUR_SECRET');
--
--  STEP 2 — WAIT ~15 seconds, then ingest (works for whatever tickers you fired):
--
--    select ingest_recent_bars();          -- returns # of new bars inserted
--
--  VERIFY (per ticker):
--    select symbol, min(ts), max(ts), count(*) from underlying_bars group by symbol;
--
--  Troubleshoot (if ingest returns 0): inspect the raw responses —
--    select id, status_code, left(content, 200) as body, created
--    from net._http_response order by created desc limit 10;
-- ============================================================================
