-- ============================================================================
--  07_backfill_bars.sql   ·   historical SPY 1-min backfill WITHOUT the CLI.
--  Postgres calls Alpaca via pg_net, then we parse the JSON into underlying_bars.
--
--  IMPORTANT: pg_net only SENDS a request after the transaction that queued it
--  COMMITS, and the response can only be read in a LATER transaction. So this is
--  a TWO-STEP flow: (1) fire the fetches, (2) wait a few seconds, (3) ingest.
--  Don't try to poll in the same statement — it can never see the response.
--
--  You need your Alpaca key + secret (same ones behind market-ingest).
-- ============================================================================

create extension if not exists pg_net;

-- Helper: fire ONE month's request and return its pg_net request id.
create or replace function fire_spy_bars(p_start date, p_end date, p_key text, p_secret text)
returns bigint language sql as $$
  select net.http_get(
    url := format(
      'https://data.alpaca.markets/v2/stocks/SPY/bars'
      || '?timeframe=1Min&start=%s&end=%s&feed=iex&limit=10000&adjustment=raw&sort=asc',
      p_start, p_end
    ),
    headers := jsonb_build_object(
      'APCA-API-KEY-ID', p_key,
      'APCA-API-SECRET-KEY', p_secret,
      'accept', 'application/json'
    ),
    timeout_milliseconds := 30000
  );
$$;

-- Helper: ingest every recent (last 15 min) successful bars response into
-- underlying_bars. Safe to run repeatedly; (symbol, ts) dedupes.
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
      and left(btrim(r.content), 1) = '{'     -- only JSON object bodies
  )
  insert into underlying_bars (symbol, ts, open, high, low, close, volume, vwap)
  select 'SPY',
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
--  STEP 1 — fire the fetches (run this block; it commits, then Alpaca is called):
--
--    select fire_spy_bars('2026-01-02','2026-01-31','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_spy_bars('2026-02-01','2026-02-28','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_spy_bars('2026-03-01','2026-03-31','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_spy_bars('2026-04-01','2026-04-30','PK_YOUR_KEY','YOUR_SECRET');
--    select fire_spy_bars('2026-05-01','2026-05-29','PK_YOUR_KEY','YOUR_SECRET');
--
--  STEP 2 — WAIT ~15 seconds, then ingest:
--
--    select ingest_recent_bars();          -- returns # of new bars inserted
--
--  VERIFY:
--    select min(ts), max(ts), count(*) from underlying_bars;
--
--  Troubleshoot (if ingest returns 0): inspect the raw responses —
--    select id, status_code, left(content, 200) as body, created
--    from net._http_response order by created desc limit 10;
-- ============================================================================
