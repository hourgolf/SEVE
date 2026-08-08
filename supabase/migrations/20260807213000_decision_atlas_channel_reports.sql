-- Nightly, deterministic Decision Atlas briefs for the private SEVE dashboard.
-- The after-close service-role publisher may upsert one immutable-through-date
-- row per channel. Browser sessions can SELECT only when the JWT carries the
-- private operator claim; no browser insert/update/delete grant is created.

create table if not exists public.decision_atlas_channel_reports (
  through_session date not null,
  channel_slug text not null check (channel_slug = lower(channel_slug) and length(channel_slug) between 1 and 100),
  brief_version text not null,
  atlas_version text not null,
  brief jsonb not null,
  brief_sha256 text not null check (brief_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  generated_at timestamptz not null,
  published_at timestamptz not null default now(),
  primary key (through_session, channel_slug),
  check ((brief ->> 'channel') = channel_slug),
  check ((brief ->> 'throughSession')::date = through_session),
  check ((brief -> 'recommendation' ->> 'productionChangeAuthorized') = 'false')
);

create index if not exists decision_atlas_channel_reports_latest
  on public.decision_atlas_channel_reports (through_session desc, channel_slug);

alter table public.decision_atlas_channel_reports enable row level security;
revoke all on table public.decision_atlas_channel_reports from anon, public;
grant select on table public.decision_atlas_channel_reports to authenticated;
grant select, insert, update on table public.decision_atlas_channel_reports to service_role;
drop policy if exists operator_private_read on public.decision_atlas_channel_reports;
create policy operator_private_read on public.decision_atlas_channel_reports
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

comment on table public.decision_atlas_channel_reports is
  'Read-only dashboard projection of deterministic nightly Decision Atlas channel briefs; never execution authority.';
