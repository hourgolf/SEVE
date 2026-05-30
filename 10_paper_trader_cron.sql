-- ============================================================================
--  10_paper_trader_cron.sql   ·   schedule the live paper-trading worker.
--  Calls the `paper-trader` edge function every minute during the US cash
--  session (13:30–20:00 UTC ≈ 9:30a–4:00p ET during EDT). Same pattern as the
--  market-ingest cron. The function self-guards on bars/freshness/halt/mute, so
--  the slightly-early 13:00 start is harmless.
--
--  PREREQUISITE: deploy the function first (Supabase Dashboard → Edge Functions
--  → create `paper-trader` → paste supabase/functions/paper-trader/index.ts →
--  Deploy). The ALPACA secrets are already set from market-ingest.
--
--  Replace <ANON_OR_SERVICE_KEY> below with your project's anon (publishable)
--  key, then run this whole file once.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (re-run safe) drop any previous schedule of the same name
select cron.unschedule('seve-paper-trader')
where exists (select 1 from cron.job where jobname = 'seve-paper-trader');

select cron.schedule(
  'seve-paper-trader',
  '* 13-20 * * 1-5',                       -- every minute, 13–20 UTC, Mon–Fri
  $$
    select net.http_post(
      url     := 'https://xvdfsxwwedltvdktqdac.supabase.co/functions/v1/paper-trader',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer <ANON_OR_SERVICE_KEY>',
                   'Content-Type',  'application/json'),
      body    := '{}'::jsonb
    );
  $$
);

-- ----------------------------------------------------------------------------
--  Going live (after dry-run looks good on the Desk):
--    In the dashboard, set the function secret  DRY_RUN=false  and redeploy.
--    (Until then the worker writes signals/events/equity but places NO orders.)
--
--  Stop it anytime:           select cron.unschedule('seve-paper-trader');
--  Or hit the KILL switch on the Console (sets fund_state.is_halted) — the
--  worker stands down on its next run without unscheduling.
-- ============================================================================
