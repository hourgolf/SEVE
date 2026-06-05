-- ============================================================================
--  22_weekly_reports.sql · the weekly-autopsy report store (run once).
--  One row per trading WEEK, written by the `weekly-autopsy` edge function
--  (service-role, bypasses RLS) after Friday's close, and read by the dashboard +
--  analysis through the anon key. Mirrors 15_daily_reports exactly.
--    digest    = Stage-1 deterministic weekly roll-up (per-channel + fund + EXIT
--                EFFICIENCY / "left on the table" — ground truth)
--    narrative = Stage-2 LLM output (weekSummary / channels / keyLearnings / suggestions)
--    markdown  = the rendered human-readable report
--  Keyed by week_end (the last ET trading date of the week). Safe to re-run.
-- ============================================================================

create table if not exists weekly_reports (
  week_end     date primary key,                 -- last ET trading date of the week
  week_start   date not null,
  mode         text not null default 'paper',
  digest       jsonb not null,
  narrative    jsonb,
  markdown     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

grant usage on schema public to anon, authenticated;
grant select on public.weekly_reports to anon, authenticated;
alter table weekly_reports enable row level security;
drop policy if exists anon_read_weekly_reports on public.weekly_reports;
create policy anon_read_weekly_reports on public.weekly_reports for select to anon using (true);
drop policy if exists auth_read_weekly_reports on public.weekly_reports;
create policy auth_read_weekly_reports on public.weekly_reports for select to authenticated using (true);

drop trigger if exists trg_weekly_reports_updated on weekly_reports;
create trigger trg_weekly_reports_updated before update on weekly_reports
  for each row execute function set_updated_at();

-- Verify:  select week_end, mode, jsonb_array_length(narrative->'suggestions') from weekly_reports order by 1 desc;
