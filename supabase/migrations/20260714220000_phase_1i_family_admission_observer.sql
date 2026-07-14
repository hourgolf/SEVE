-- Phase 1I: append-only dark family-admission collisions. These rows describe
-- counterfactual one-per-family arms only; no execution code reads this table.

create table public.family_admission_observations (
  id                 uuid primary key,
  schema_version     integer not null check (schema_version = 1),
  policy_version     text not null check (length(policy_version) > 0),
  family_id          text not null check (family_id in ('PB', 'ORB-SPY')),
  source_bar_at      timestamptz not null,
  observed_at        timestamptz not null check (observed_at >= source_bar_at),
  underlying         text not null check (length(underlying) between 1 and 12),
  option_side        text not null check (option_side in ('call', 'put')),
  candidate_count    integer not null check (candidate_count >= 2),
  requested_qty      integer not null check (requested_qty >= candidate_count),
  candidates         jsonb not null check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) = candidate_count),
  admission_arms     jsonb not null check (jsonb_typeof(admission_arms) = 'array' and jsonb_array_length(admission_arms) = candidate_count),
  source_boot_id     uuid not null references public.worker_runs(boot_id),
  created_at         timestamptz not null default now()
);

create index if not exists idx_family_admission_observations_bar
  on public.family_admission_observations (source_bar_at desc, family_id);
create index if not exists idx_family_admission_observations_boot
  on public.family_admission_observations (source_boot_id);

comment on table public.family_admission_observations is
  'Append-only observation of simultaneous accepted PB/ORB entry candidates and every one-survivor counterfactual arm. Never read by execution.';

alter table public.family_admission_observations enable row level security;
revoke all on public.family_admission_observations from public, anon, authenticated, service_role;
grant select, insert on public.family_admission_observations to service_role;
grant select on public.family_admission_observations to authenticated;

create policy family_admission_observations_operator_read
  on public.family_admission_observations for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');
