-- ============================================================================
-- 30_executor_cutover.sql — Phase B: per-channel executor coordination
-- (APPLIED to the live DB via the Supabase MCP on 2026-06-10 — kept here for
--  the record; safe to re-run, everything is IF NOT EXISTS / additive.)
--
-- `strategists.executor` decides WHO trades a channel:
--   'cron'   (default) — the Supabase paper-trader edge function (today's path)
--   'stream' — the Railway streaming worker (Phase B), the SOLE order-placer
--              for that channel while its heartbeat is fresh.
--
-- `worker_heartbeat` is the dead-man switch: the streaming worker upserts
-- id='stream' every cycle (~10s) WHILE LIVE. The cron defers to the stream on
-- stream-owned channels only when that beat is < 5 min old; if it goes stale
-- mid-session the cron resumes EXIT-ONLY management (never entries) so a dead
-- Railway box can't strand open 0DTE positions.
--
-- Cutover is per-channel and reversible at any moment:
--   update strategists set executor='stream' where slug='grind-v3';   -- migrate
--   update strategists set executor='cron'   where slug='grind-v3';   -- roll back
-- ============================================================================

alter table strategists
  add column if not exists executor text not null default 'cron'
  check (executor in ('cron','stream'));

create table if not exists worker_heartbeat (
  id      text primary key,          -- 'stream'
  beat_at timestamptz not null default now(),
  note    text                       -- worker version / mode, for the ops panel
);

alter table worker_heartbeat enable row level security;
do $$ begin
  create policy worker_heartbeat_read on worker_heartbeat for select using (true);
exception when duplicate_object then null; end $$;
