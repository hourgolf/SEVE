-- ============================================================================
--  15_daily_reports.sql · the daily-autopsy report store (run once).
--  One row per ET trading day, WRITTEN by the `daily-autopsy` edge function
--  (service-role, bypasses RLS) a few minutes after the close, and READ by the
--  dashboard + analysis through the anon key (same read-only exposure as the
--  other desk tables in 04_*).
--    digest    = Stage-1 deterministic per-channel metrics + flaw flags (ground truth)
--    narrative = Stage-2 LLM output (marketSummary / channels / systemFindings / topActions)
--    markdown  = the rendered human-readable report
--  Safe to re-run.
-- ============================================================================

create table if not exists daily_reports (
  report_date  date primary key,                  -- ET trading date
  mode         text not null default 'paper',
  digest       jsonb not null,
  narrative    jsonb,
  markdown     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- anon (publishable key) read-only — same posture as the other dashboard tables.
grant usage on schema public to anon;
grant select on public.daily_reports to anon;
alter table daily_reports enable row level security;
drop policy if exists anon_read_daily_reports on public.daily_reports;
create policy anon_read_daily_reports on public.daily_reports for select to anon using (true);

-- keep updated_at fresh (set_updated_at() is defined in trading-desk-schema.sql).
drop trigger if exists trg_daily_reports_updated on daily_reports;
create trigger trg_daily_reports_updated before update on daily_reports
  for each row execute function set_updated_at();

-- Verify (optional):  select report_date, mode, jsonb_array_length(narrative->'systemFindings') from daily_reports order by 1 desc;
