-- 54_boost.sql — BOOST toggle (replaces the inert SOLO pad).
-- When a channel is boosted, the streaming worker DOUBLES its sizing for the day:
-- RISK budget ×2 + max_contracts ×2 (so it can actually reach 2×) + daily_stop ×2
-- (so a boosted stop-out doesn't halt it early). Additive + safe.
--
-- `soloed` is left in place but DORMANT — nothing sets it true anymore, so the
-- desk's solo-ducking never fires. (Kept to avoid a live-worker deploy race; drop later.)
alter table strategist_config
  add column if not exists boosted boolean not null default false;

-- Auto-clear each trading day so a 2× boost can't silently ride into the next session.
-- Runs weekdays at 21:15 UTC (after the US cash close year-round, incl. DST).
select cron.schedule(
  'seve-clear-boosts',
  '15 21 * * 1-5',
  $$update strategist_config set boosted = false where boosted = true$$
);
