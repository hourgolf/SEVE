-- Reporting-only history. No positions, execution, channel or runtime policy writes.
create table if not exists public.reporting_publication_versions (
  id bigint generated always as identity primary key,
  report_kind text not null check (report_kind in ('daily', 'weekly')),
  report_date date not null,
  content_hash text not null,
  payload jsonb not null,
  archived_at timestamptz not null default now(),
  unique (report_kind, report_date, content_hash)
);
alter table public.reporting_publication_versions enable row level security;
revoke all on public.reporting_publication_versions from anon, authenticated;
grant select, insert on public.reporting_publication_versions to service_role;
grant usage, select on sequence public.reporting_publication_versions_id_seq to service_role;

create or replace function public.archive_reporting_publication() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text := case when tg_table_name = 'daily_reports' then 'daily' else 'weekly' end;
  date_key text := case when tg_table_name = 'daily_reports' then 'report_date' else 'week_end' end;
  p jsonb;
begin
  if tg_op = 'UPDATE' then
    p := to_jsonb(old);
    insert into public.reporting_publication_versions(report_kind, report_date, content_hash, payload)
      values(kind, (p->>date_key)::date, md5(p::text), p) on conflict do nothing;
  end if;
  p := to_jsonb(new);
  insert into public.reporting_publication_versions(report_kind, report_date, content_hash, payload)
    values(kind, (p->>date_key)::date, md5(p::text), p) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.archive_reporting_publication() from public;
drop trigger if exists preserve_daily_report_versions on public.daily_reports;
create trigger preserve_daily_report_versions after insert or update on public.daily_reports
  for each row execute function public.archive_reporting_publication();
drop trigger if exists preserve_weekly_report_versions on public.weekly_reports;
create trigger preserve_weekly_report_versions after insert or update on public.weekly_reports
  for each row execute function public.archive_reporting_publication();
insert into public.reporting_publication_versions(report_kind, report_date, content_hash, payload)
  select 'daily', report_date, md5(to_jsonb(r)::text), to_jsonb(r) from public.daily_reports r on conflict do nothing;
insert into public.reporting_publication_versions(report_kind, report_date, content_hash, payload)
  select 'weekly', week_end, md5(to_jsonb(r)::text), to_jsonb(r) from public.weekly_reports r on conflict do nothing;
