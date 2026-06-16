-- 37_forensics_reports.sql — the dashboard-readable home for the deterministic
-- forensics the CLI day-report computes (override scorecard + benched would-be-vs-live).
-- The CLI is anon (read-only) and the benched sim needs the engine, so day-report POSTs
-- the computed payload to /api/forensics-report (service-role write); the §03 panel reads
-- this table (anon SELECT). One row per ET date, upserted on each day-report run.
create table if not exists forensics_reports (
  report_date  date primary key,
  payload      jsonb not null,
  generated_at timestamptz not null default now()
);

alter table forensics_reports enable row level security;

-- dashboard read (writes are service-role only → bypass RLS). MUST cover BOTH anon AND
-- authenticated: a signed-in operator reads as `authenticated`, so anon-only = empty panel
-- once signed in (mirrors daily_reports / accounts, which grant both).
drop policy if exists "anon read forensics_reports" on forensics_reports;
drop policy if exists "read forensics_reports" on forensics_reports;
create policy "read forensics_reports" on forensics_reports for select to anon, authenticated using (true);

-- ⚠ this project's default privileges do NOT auto-grant SELECT (the 06-13 accounts-table
-- gotcha) — the policy alone is moot without the explicit grants to BOTH roles.
grant select on forensics_reports to anon, authenticated;
