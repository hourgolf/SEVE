-- Phase 1H-B: compact verification receipts for immutable raw SIP objects in R2.
-- Raw trades/quotes never enter Supabase. This table is observation-only and
-- cannot be consumed as an order instruction.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.intraminute_capture_receipts (
  object_key             text primary key check (length(object_key) between 1 and 1024),
  manifest_key           text not null unique check (length(manifest_key) between 1 and 1024),
  schema_version         integer not null check (schema_version = 1),
  observer_version       text not null check (length(observer_version) > 0),
  -- Deliberately not a foreign key: failed worker-run telemetry must not make
  -- an otherwise verified raw capture object impossible to receipt.
  source_boot_id         uuid not null,
  source_feed            text not null check (source_feed = 'sip'),
  symbol                 text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  session_date_et        date not null,
  hour_et                smallint not null check (hour_et between 0 and 23),
  row_count              integer not null check (row_count > 0),
  trade_count            integer not null check (trade_count >= 0),
  quote_count            integer not null check (quote_count >= 0),
  gap_count              integer not null check (gap_count >= 0),
  provider_min_at        timestamptz not null,
  provider_max_at        timestamptz not null,
  checksum_sha256        text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes       bigint not null check (compressed_bytes > 0),
  dropped_events         integer not null default 0 check (dropped_events >= 0),
  rejected_oversize      integer not null default 0 check (rejected_oversize >= 0),
  completed_at           timestamptz not null,
  created_at             timestamptz not null default now(),
  check (provider_max_at >= provider_min_at),
  check (row_count = trade_count + quote_count + gap_count)
);

create index idx_intraminute_capture_receipts_session
  on public.intraminute_capture_receipts (session_date_et desc, symbol, hour_et);
create index idx_intraminute_capture_receipts_boot
  on public.intraminute_capture_receipts (source_boot_id);

comment on table public.intraminute_capture_receipts is
  'Observation-only verification receipts for immutable R2 SIP capture objects; never an execution instruction.';

alter table public.intraminute_capture_receipts enable row level security;
revoke all on public.intraminute_capture_receipts from public, anon, authenticated, service_role;
grant select, insert on public.intraminute_capture_receipts to service_role;
grant select on public.intraminute_capture_receipts to authenticated;

create policy intraminute_capture_operator_read on public.intraminute_capture_receipts
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create table public.intraminute_capture_health (
  id                      uuid primary key,
  source_boot_id          uuid not null,
  observed_at             timestamptz not null,
  severity                text not null check (severity in ('warning', 'high')),
  code                    text not null check (code in ('r2_flush_failed', 'receipt_write_failed')),
  affected_events         integer not null check (affected_events >= 0),
  facts                   jsonb not null check (jsonb_typeof(facts) = 'object'),
  created_at              timestamptz not null default now()
);

create index idx_intraminute_capture_health_recent
  on public.intraminute_capture_health (observed_at desc, severity);
create index idx_intraminute_capture_health_boot
  on public.intraminute_capture_health (source_boot_id);

comment on table public.intraminute_capture_health is
  'Append-only observer failures and missing-evidence facts; never an executor-health or order instruction.';

alter table public.intraminute_capture_health enable row level security;
revoke all on public.intraminute_capture_health from public, anon, authenticated, service_role;
grant select, insert on public.intraminute_capture_health to service_role;
grant select on public.intraminute_capture_health to authenticated;

create policy intraminute_capture_health_operator_read on public.intraminute_capture_health
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
