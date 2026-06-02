-- ============================================================================
--  16_daily_autopsy_cron.sql · schedule the end-of-day autopsy report.
--  Calls the `daily-autopsy` edge function a few minutes after the cash close,
--  Mon–Fri. Fires at BOTH 20:05 and 21:05 UTC so it lands ~16:05 ET in either
--  DST half (20:05 UTC = 16:05 EDT summer; 21:05 UTC = 16:05 EST winter). The
--  function self-gates — it skips if it's before 16:01 ET or a report for today
--  already exists — so the off-season firing is a harmless no-op and the report
--  is generated exactly ONCE per trading day.
--
--  PREREQUISITES (do these first):
--   1) run 15_daily_reports.sql  (creates the daily_reports table)
--   2) deploy the function: Supabase → Edge Functions → create `daily-autopsy`
--      → paste supabase/functions/daily-autopsy/index.ts → Deploy (verify-JWT OFF)
--   3) set the edge secret  ANTHROPIC_API_KEY  (+ optional ANTHROPIC_MODEL).
--      Without it the report still generates with the deterministic digest +
--      skeleton (no LLM narrative).
--
--  Replace <ANON_OR_SERVICE_KEY> with your project's anon (publishable) key, then
--  run this whole file once.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('seve-daily-autopsy')
where exists (select 1 from cron.job where jobname = 'seve-daily-autopsy');

select cron.schedule(
  'seve-daily-autopsy',
  '5 20,21 * * 1-5',                       -- 20:05 & 21:05 UTC, Mon–Fri (≈16:05 ET, DST-robust)
  $$
    select net.http_post(
      url     := 'https://xvdfsxwwedltvdktqdac.supabase.co/functions/v1/daily-autopsy',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer <ANON_OR_SERVICE_KEY>',
                   'Content-Type',  'application/json'),
      body    := '{}'::jsonb
    );
  $$
);

-- ----------------------------------------------------------------------------
--  Manual run / backfill a past day (skips the close-time gate):
--    select net.http_post(
--      url := 'https://xvdfsxwwedltvdktqdac.supabase.co/functions/v1/daily-autopsy',
--      headers := jsonb_build_object('Authorization','Bearer <KEY>','Content-Type','application/json'),
--      body := '{"date":"2026-06-01"}'::jsonb);
--    (add "force":true to regenerate a day that already has a report.)
--
--  Read the latest report:
--    select report_date, markdown from daily_reports order by report_date desc limit 1;
--
--  Stop it:  select cron.unschedule('seve-daily-autopsy');
-- ============================================================================
