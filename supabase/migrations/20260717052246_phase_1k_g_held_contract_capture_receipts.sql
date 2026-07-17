-- Phase 1K-G: compact receipts for immutable held-contract OPRA snapshot
-- segments in R2. This migration is review-only until an independently
-- approved dark-capture rollout. No strategy or executor reads these tables.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.held_contract_capture_receipts (
  id                          uuid primary key,
  schema_version              integer not null check (schema_version = 1),
  capture_version             text not null check (capture_version = 'held-contract-opra-snapshot-v1'),
  object_key                  text not null unique check (length(object_key) between 1 and 1024),
  manifest_key                text not null unique check (length(manifest_key) between 1 and 1024),
  content_sha256              text not null unique check (content_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_sha256           text not null check (compressed_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes            bigint not null check (compressed_bytes > 0),

  -- Evidence identity is intentionally not foreign-keyed. A retained R2
  -- object must remain receiptable even if operational retention later moves
  -- a position or worker-run row.
  position_id                 uuid not null,
  strategist_id               uuid not null,
  account_id                  uuid not null,
  source_boot_id              uuid not null,
  source_version              text not null check (length(source_version) between 1 and 120),
  source_feed                 text not null check (source_feed = 'opra'),
  channel_slug                text not null check (length(channel_slug) between 1 and 160),
  underlying                  text not null check (underlying ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  occ_symbol                  text not null check (occ_symbol ~ '^[A-Z]{1,6}[0-9]{6}[CP][0-9]{8}$'),
  session_date_et             date not null,
  hour_et                     smallint not null check (hour_et between 0 and 23),

  sample_count                integer not null check (sample_count > 0),
  successful_quote_count      integer not null check (successful_quote_count >= 0),
  request_failure_count       integer not null check (request_failure_count >= 0),
  missing_quote_count         integer not null check (missing_quote_count >= 0),
  invalid_quote_count         integer not null check (invalid_quote_count >= 0),
  eligible_count              integer not null check (eligible_count >= 0),
  stale_snapshot_count        integer not null check (stale_snapshot_count >= 0),
  stale_quote_event_count     integer not null check (stale_quote_event_count >= 0),
  first_fetch_at              timestamptz not null,
  last_fetch_at               timestamptz not null,
  provider_min_at             timestamptz,
  provider_max_at             timestamptz,
  gap_count                   integer not null check (gap_count >= 0),
  max_observation_gap_ms      integer check (max_observation_gap_ms is null or max_observation_gap_ms >= 0),
  provider_age_p50_ms         integer check (provider_age_p50_ms is null or provider_age_p50_ms >= 0),
  provider_age_p95_ms         integer check (provider_age_p95_ms is null or provider_age_p95_ms >= 0),
  provider_age_max_ms         integer check (provider_age_max_ms is null or provider_age_max_ms >= 0),
  dropped_samples             integer not null default 0 check (dropped_samples >= 0),
  rejected_oversize           integer not null default 0 check (rejected_oversize >= 0),
  completed_at                timestamptz not null,
  created_at                  timestamptz not null default now(),

  check (last_fetch_at >= first_fetch_at),
  check ((provider_min_at is null and provider_max_at is null)
    or (provider_min_at is not null and provider_max_at is not null and provider_max_at >= provider_min_at)),
  check (successful_quote_count + request_failure_count + missing_quote_count + invalid_quote_count = sample_count),
  check (eligible_count + stale_snapshot_count + stale_quote_event_count = successful_quote_count),
  check (provider_age_p50_ms is null or provider_age_p95_ms is null or provider_age_p50_ms <= provider_age_p95_ms),
  check (provider_age_p95_ms is null or provider_age_max_ms is null or provider_age_p95_ms <= provider_age_max_ms),
  check (rejected_oversize <= dropped_samples)
);

create index idx_held_contract_capture_position
  on public.held_contract_capture_receipts (position_id, first_fetch_at);
create index idx_held_contract_capture_contract
  on public.held_contract_capture_receipts (occ_symbol, first_fetch_at);
create index idx_held_contract_capture_session
  on public.held_contract_capture_receipts (session_date_et desc, channel_slug, hour_et);
create index idx_held_contract_capture_boot
  on public.held_contract_capture_receipts (source_boot_id, first_fetch_at);

comment on table public.held_contract_capture_receipts is
  'Append-only verification receipts for immutable held-contract OPRA evidence in R2; never an execution instruction.';
comment on column public.held_contract_capture_receipts.request_failure_count is
  'Provider request errors plus explicit not-requested capacity shedding; raw samples retain the distinct outcome and failure code.';

alter table public.held_contract_capture_receipts enable row level security;
revoke all on public.held_contract_capture_receipts from public, anon, authenticated, service_role;
grant select, insert on public.held_contract_capture_receipts to service_role;
grant select on public.held_contract_capture_receipts to authenticated;

create policy held_contract_capture_operator_read
  on public.held_contract_capture_receipts
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create table public.held_contract_capture_health (
  id                        uuid primary key,
  source_boot_id            uuid not null,
  observed_at               timestamptz not null,
  severity                  text not null check (severity in ('warning', 'high')),
  code                      text not null check (code in (
    'queue_drop', 'r2_flush_failed', 'receipt_write_failed', 'schema_unavailable'
  )),
  position_id               uuid,
  occ_symbol                text check (occ_symbol is null or occ_symbol ~ '^[A-Z]{1,6}[0-9]{6}[CP][0-9]{8}$'),
  affected_samples          integer not null check (affected_samples >= 0),
  facts                     jsonb not null check (jsonb_typeof(facts) = 'object'),
  created_at                timestamptz not null default now()
);

create index idx_held_contract_capture_health_recent
  on public.held_contract_capture_health (observed_at desc, severity);
create index idx_held_contract_capture_health_boot
  on public.held_contract_capture_health (source_boot_id, observed_at desc);

comment on table public.held_contract_capture_health is
  'Append-only missing-evidence facts for held-contract capture; never executor health or trading authority.';

alter table public.held_contract_capture_health enable row level security;
revoke all on public.held_contract_capture_health from public, anon, authenticated, service_role;
grant select, insert on public.held_contract_capture_health to service_role;
grant select on public.held_contract_capture_health to authenticated;

create policy held_contract_capture_health_operator_read
  on public.held_contract_capture_health
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
