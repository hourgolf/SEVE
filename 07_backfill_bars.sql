-- ============================================================================
--  07_backfill_bars.sql   ·   historical SPY 1-min backfill WITHOUT the CLI.
--  Postgres calls Alpaca directly via pg_net, parses the JSON, and inserts into
--  underlying_bars — so the engine gets real history (with real opening
--  sessions the live capture missed).
--
--  Run the whole file once to create the helper, then call it per ~month chunk
--  (one Alpaca page holds 10,000 bars ≈ a month of RTH 1-min, so keep ranges
--  to a month or less or only the first page is fetched).
--
--  You need your Alpaca API key + secret (the same ones set as the
--  market-ingest function secrets — grab them from your Alpaca dashboard).
--  They are passed as arguments, NOT stored in the function body.
-- ============================================================================

create extension if not exists pg_net;

create or replace function backfill_spy_bars(
  p_start  date,
  p_end    date,
  p_key    text,
  p_secret text
) returns integer
language plpgsql
as $$
declare
  v_req    bigint;
  v_status int;
  v_body   text;
  v_tries  int := 0;
  v_count  int;
begin
  -- 1) fire the async request (one page; keep ranges ≤ ~1 month so bars < 10k)
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
  ) into v_req;

  -- 2) poll for the response (pg_net's worker writes it in the background)
  loop
    perform pg_sleep(2);
    v_tries := v_tries + 1;
    select status_code, content
      into v_status, v_body
      from net._http_response
     where id = v_req;
    exit when v_status is not null or v_tries >= 15;
  end loop;

  if v_status is null then
    raise exception 'backfill_spy_bars: no response yet (request %); re-run', v_req;
  end if;
  if v_status <> 200 then
    raise exception 'backfill_spy_bars: Alpaca HTTP % -> %', v_status, left(coalesce(v_body, ''), 300);
  end if;

  -- 3) parse the bars array and upsert (dedupes with the live cron's rows)
  insert into underlying_bars (symbol, ts, open, high, low, close, volume, vwap)
  select 'SPY',
         (b->>'t')::timestamptz,
         (b->>'o')::numeric,
         (b->>'h')::numeric,
         (b->>'l')::numeric,
         (b->>'c')::numeric,
         (b->>'v')::bigint,
         (b->>'vw')::numeric
  from jsonb_array_elements(coalesce((v_body::jsonb) -> 'bars', '[]'::jsonb)) as b
  on conflict (symbol, ts) do nothing;

  get diagnostics v_count = row_count;
  return v_count;  -- number of NEW bars inserted
end;
$$;

-- ----------------------------------------------------------------------------
--  USAGE — replace the key/secret, then run one line per month:
--
--    select backfill_spy_bars('2026-01-02','2026-01-31','PK_YOUR_KEY','YOUR_SECRET');
--    select backfill_spy_bars('2026-02-01','2026-02-28','PK_YOUR_KEY','YOUR_SECRET');
--    select backfill_spy_bars('2026-03-01','2026-03-31','PK_YOUR_KEY','YOUR_SECRET');
--    select backfill_spy_bars('2026-04-01','2026-04-30','PK_YOUR_KEY','YOUR_SECRET');
--    select backfill_spy_bars('2026-05-01','2026-05-29','PK_YOUR_KEY','YOUR_SECRET');
--
--  Each returns the count of new bars. Re-running is safe (upsert dedupes).
--  Verify:  select min(ts), max(ts), count(*) from underlying_bars;
-- ============================================================================
