-- ============================================================================
--  08_probe_option_history.sql   ·   does Alpaca serve us HISTORICAL option
--  data? Run this BEFORE building a full option backfill — it just fires one
--  request and lets us read the raw response, so we learn the access level
--  (free indicative? OPRA subscription required? what shape?) for ~zero effort.
--
--  Two-step (pg_net sends on commit, read in a later txn) — same as 07.
-- ============================================================================

create extension if not exists pg_net;

-- Generic: fire any Alpaca GET with auth headers; returns the request id.
create or replace function fire_alpaca_get(p_url text, p_key text, p_secret text)
returns bigint language sql as $$
  select net.http_get(
    url := p_url,
    headers := jsonb_build_object(
      'APCA-API-KEY-ID', p_key,
      'APCA-API-SECRET-KEY', p_secret,
      'accept', 'application/json'
    ),
    timeout_milliseconds := 30000
  );
$$;

-- ----------------------------------------------------------------------------
--  STEP 1 — fire three probes (replace key/secret). We test, for a known SPY
--  0DTE contract from the captured day (756 call, 2026-05-29):
--    (a) historical option BARS   (trade OHLC)
--    (b) historical option QUOTES (bid/ask — the OPRA-gated one)
--    (c) historical option TRADES
--
--    select fire_alpaca_get(
--      'https://data.alpaca.markets/v1beta1/options/bars?symbols=SPY260529C00756000&timeframe=1Min&start=2026-05-29&end=2026-05-29&limit=100&feed=indicative',
--      'PK_YOUR_KEY','YOUR_SECRET');
--    select fire_alpaca_get(
--      'https://data.alpaca.markets/v1beta1/options/quotes?symbols=SPY260529C00756000&start=2026-05-29&end=2026-05-29&limit=100&feed=indicative',
--      'PK_YOUR_KEY','YOUR_SECRET');
--    select fire_alpaca_get(
--      'https://data.alpaca.markets/v1beta1/options/trades?symbols=SPY260529C00756000&start=2026-05-29&end=2026-05-29&limit=100&feed=indicative',
--      'PK_YOUR_KEY','YOUR_SECRET');
--
--  (If your option_quotes has other symbols, grab one:
--     select distinct occ_symbol from option_quotes limit 10; )
--
--  STEP 2 — WAIT ~10s, then inspect what came back:
--
--    select id, status_code, left(content, 600) as body, created
--    from net._http_response order by created desc limit 5;
--
--  Paste me the status_code + body for each. Then:
--    • 200 with data  → I build the historical option backfill (real fills!).
--    • 403 / "subscription" → historical OPRA needs a paid plan; we pivot to
--      accumulating real chains going-forward via the cron + calibrate the model.
-- ============================================================================
