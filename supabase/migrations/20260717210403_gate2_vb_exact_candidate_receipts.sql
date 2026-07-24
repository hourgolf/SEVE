-- Gate 2 review-only migration: compact receipts for the existing
-- signals -> virtual_trades VB lane and its content-addressed exact T+1 paths.
-- No executor or manager reads these tables. Applying this migration requires
-- an explicit operator review and is intentionally outside this commit.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.vb_candidate_receipts (
  id                       text primary key check (id ~ '^vbcan:[0-9a-f-]{36}$'),
  opportunity_id           text not null unique check (opportunity_id ~ '^vbopp:[0-9a-f-]{36}$'),
  schema_version           integer not null check (schema_version = 1),
  signal_id                uuid not null unique,
  strategist_id            uuid not null,
  account_id               uuid,
  channel_slug             text not null check (length(channel_slug) between 1 and 160),
  channel_version          text not null check (channel_version ~ '^sha256:[0-9a-f]{64}$'),
  configuration_epoch_id   text not null check (configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'),
  source_bar_at            timestamptz not null,
  session_date_et          date not null,
  decision_observed_at     timestamptz not null,
  underlying               text not null check (underlying ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  option_side              text not null check (option_side in ('call', 'put')),
  occ_symbol               text not null check (occ_symbol ~ '^[A-Z]{1,6}[0-9]{6}[CP][0-9]{8}$'),
  -- Live Alpaca ask is provenance only. It has no authoritative provider
  -- clock and is never the exact-path score entry.
  live_observed_ask        numeric check (live_observed_ask is null or live_observed_ask > 0),
  live_ask_feed            text check (live_ask_feed is null or live_ask_feed = 'alpaca_snapshot'),
  live_ask_provider_at     timestamptz,
  live_ask_observed_at     timestamptz,
  live_ask_freshness_ms    integer check (live_ask_freshness_ms is null or live_ask_freshness_ms >= 0),
  live_ask_exact           boolean not null default false check (not live_ask_exact),
  blocked_reason           text not null check (blocked_reason in (
    'not_armed',
    'halted',
    'cost_gate',
    'stale_chain',
    'day1_dark_lifecycle',
    'day1_premium_debit_cap',
    'day1_spy_same_clock_collision',
    'day1_family_open',
    'day1_reentry_disabled',
    'day1_same_occ_open',
    'day1_underlying_concurrency',
    'day1_global_concurrency'
  )),
  virtual_exit_at          timestamptz not null,
  reentry_ordinal          integer not null check (reentry_ordinal > 0),
  exact_path_required      boolean not null default true check (exact_path_required),
  order_path_authorized    boolean not null default false check (not order_path_authorized),
  source_version           text not null check (length(source_version) between 1 and 120),
  created_at               timestamptz not null default now(),

  check (decision_observed_at >= source_bar_at),
  check (virtual_exit_at >= decision_observed_at),
  unique (id, opportunity_id)
);

create index idx_vb_candidate_receipts_session
  on public.vb_candidate_receipts (session_date_et desc, channel_slug, source_bar_at);
create index idx_vb_candidate_receipts_contract
  on public.vb_candidate_receipts (occ_symbol, source_bar_at);
create index idx_vb_candidate_receipts_epoch
  on public.vb_candidate_receipts (configuration_epoch_id, source_bar_at);

comment on table public.vb_candidate_receipts is
  'Append-only canonical receipts extending existing blocked signals and virtual_trades; research-only and never an order instruction.';

alter table public.vb_candidate_receipts enable row level security;
revoke all on public.vb_candidate_receipts from public, anon, authenticated, service_role;
grant select, insert on public.vb_candidate_receipts to service_role;
grant select on public.vb_candidate_receipts to authenticated;

create policy vb_candidate_receipts_operator_read
  on public.vb_candidate_receipts
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create table public.vb_exact_path_receipts (
  id                       uuid primary key,
  schema_version           integer not null check (schema_version = 1),
  candidate_id             text not null unique,
  opportunity_id           text not null unique,
  dataset                  text not null check (dataset = 'OPRA.PILLAR'),
  path_schema              text not null check (path_schema = 'cbbo-1s'),
  object_key               text not null unique check (length(object_key) between 1 and 1024),
  manifest_key             text not null unique check (length(manifest_key) between 1 and 1024),
  content_sha256           text not null unique check (content_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_sha256        text not null check (compressed_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes         bigint not null check (compressed_bytes > 0),
  row_count                integer not null check (row_count > 0),
  first_quote_at           timestamptz not null,
  last_quote_at            timestamptz not null,
  entry_quote_at           timestamptz not null,
  entry_ask                numeric not null check (entry_ask > 0),
  -- v2 records post-boundary lag; v3 records the age of the last CBBO state
  -- published at or before the boundary. The builder version makes the
  -- interpretation explicit. Event-sparse gaps are diagnostic, not proof of
  -- missing provider evidence.
  left_boundary_lag_ms     integer not null check (left_boundary_lag_ms between 0 and 86400000),
  right_boundary_lag_ms    integer not null check (right_boundary_lag_ms between 0 and 86400000),
  max_internal_gap_ms      integer not null check (max_internal_gap_ms between 0 and 86400000),
  checksum_verified        boolean not null check (checksum_verified),
  contract_valid           boolean not null check (contract_valid),
  source                   text not null check (source = 'databento_historical'),
  path_builder_version     text not null check (length(path_builder_version) between 1 and 120),
  completed_at             timestamptz not null,
  created_at               timestamptz not null default now(),

  check (last_quote_at >= entry_quote_at and entry_quote_at >= first_quote_at),
  check (opportunity_id ~ '^vbopp:[0-9a-f-]{36}$'),
  check (object_key like ('%' || compressed_sha256 || '.json.gz')),
  foreign key (candidate_id, opportunity_id)
    references public.vb_candidate_receipts (id, opportunity_id)
);

create index idx_vb_exact_path_receipts_completed
  on public.vb_exact_path_receipts (completed_at desc);

comment on table public.vb_exact_path_receipts is
  'Compact verification receipts for immutable content-addressed VB candidate CBBO-1s paths in R2; never an execution source.';

alter table public.vb_exact_path_receipts enable row level security;
revoke all on public.vb_exact_path_receipts from public, anon, authenticated, service_role;
grant select, insert on public.vb_exact_path_receipts to service_role;
grant select on public.vb_exact_path_receipts to authenticated;

create policy vb_exact_path_receipts_operator_read
  on public.vb_exact_path_receipts
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
