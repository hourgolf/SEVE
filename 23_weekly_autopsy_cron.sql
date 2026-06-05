-- ============================================================================
--  23_weekly_autopsy_cron.sql · schedule the end-of-WEEK autopsy roll-up.
--  Calls the `weekly-autopsy` edge function after FRIDAY's close — 10 min behind
--  the daily cron so that Friday's own daily_report (the 5th of the week) exists
--  first. Fires at BOTH 20:15 and 21:15 UTC so it lands ~16:15 ET in either DST
--  half. The function self-gates (skips unless it's Friday past 16:05 ET and no
--  report for this week exists yet), so the off-season firing is a harmless no-op
--  and the weekly report is generated exactly ONCE per week.
--
--  PREREQUISITES (do these first):
--   1) run 22_weekly_reports.sql  (creates the weekly_reports table)
--   2) deploy the function: Supabase → Edge Functions → create `weekly-autopsy`
--      → paste supabase/functions/weekly-autopsy/index.ts → Deploy (verify-JWT OFF)
--   3) it reuses the SAME edge secret  ANTHROPIC_API_KEY  as daily-autopsy.
--      Without it the report still generates (deterministic digest + skeleton, no LLM).
--
--  Replace <ANON_OR_SERVICE_KEY> with your project's anon (publishable) key, then
--  run this whole file once.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('seve-weekly-autopsy')
where exists (select 1 from cron.job where jobname = 'seve-weekly-autopsy');

select cron.schedule(
  'seve-weekly-autopsy',
  '15 20,21 * * 5',                        -- 20:15 & 21:15 UTC, FRIDAY only (≈16:15 ET, DST-robust)
  $$
    select net.http_post(
      url     := 'https://xvdfsxwwedltvdktqdac.supabase.co/functions/v1/weekly-autopsy',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer <ANON_OR_SERVICE_KEY>',
                   'Content-Type',  'application/json'),
      body    := '{}'::jsonb
    );
  $$
);

-- ----------------------------------------------------------------------------
--  Manual run / backfill a week (skips the Friday-close gate — weekEnd = the last
--  ET trading date of the week to roll up; pulls the ≤5 daily_reports at/before it):
--    select net.http_post(
--      url := 'https://xvdfsxwwedltvdktqdac.supabase.co/functions/v1/weekly-autopsy',
--      headers := jsonb_build_object('Authorization','Bearer <KEY>','Content-Type','application/json'),
--      body := '{"weekEnd":"2026-06-05"}'::jsonb);
--
--  Read the latest weekly report:
--    select week_start, week_end, markdown from weekly_reports order by week_end desc limit 1;
--
--  Stop it:  select cron.unschedule('seve-weekly-autopsy');
-- ============================================================================
