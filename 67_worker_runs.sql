-- 67_worker_runs — per-boot lifecycle ledger for crash attribution (external-review P4, 2026-07-11).
-- The stream worker has been crash-restarting (~40 boots/16h, persisting on 07-11a). A dying process
-- can't record its own exit (OOM/SIGKILL bypass every handler), so attribution is done the reliable
-- way: each boot (store.openRun) inserts a row here and closes any prior un-ended run as abrupt.
-- Then the answers fall out of SQL:
--   · crash time      = a run whose last_heartbeat_at is well before the next run's started_at;
--   · OOM fingerprint = memory_rss_mb climbing across a run's heartbeats before an abrupt end;
--   · deploy-overlap  = two runs both un-ended with fresh heartbeats in the same window;
--   · termination_kind = graceful_sigterm | uncaught_exception | fatal_boot | abrupt_or_unknown.
-- The worker writes via the service role; the dashboard reads via anon.

create table if not exists public.worker_runs (
  boot_id             uuid primary key,
  instance_id         text not null,          -- Railway replica/deployment id, else hostname:pid
  version             text not null,          -- WORKER_VERSION at boot
  git_sha             text,                   -- RAILWAY_GIT_COMMIT_SHA if injected
  pid                 integer,
  hostname            text,
  railway_deployment  text,
  started_at          timestamptz not null default now(),
  last_heartbeat_at   timestamptz,            -- freshened every 60s + every trading beat
  last_phase          text,                   -- boot | cycle | sweep | pre-open | shutdown
  memory_rss_mb       numeric,                -- RSS at last heartbeat (OOM watch)
  shutdown_started_at timestamptz,
  ended_at            timestamptz,            -- null = still running (or died abruptly, until next boot)
  termination_kind    text,
  exit_code           integer,
  signal              text,
  last_error          text
);

create index if not exists idx_worker_runs_started on public.worker_runs (started_at desc);
create index if not exists idx_worker_runs_open on public.worker_runs (last_heartbeat_at) where ended_at is null;

alter table public.worker_runs enable row level security;
drop policy if exists worker_runs_read on public.worker_runs;
create policy worker_runs_read on public.worker_runs for select to anon, authenticated using (true);
-- writes are service-role only (RLS-bypass); no anon/auth write policy by design.

-- Handy diagnosis view: recent runs with their uptime and the gap to the prior boot.
-- select boot_id, version, started_at, last_heartbeat_at, ended_at, termination_kind, exit_code,
--        signal, last_phase, memory_rss_mb,
--        (coalesce(ended_at, last_heartbeat_at) - started_at) as lifetime
-- from public.worker_runs order by started_at desc limit 30;
