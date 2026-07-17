-- Phase 1K-F: normalized paper execution-quality receipts.
-- OBSERVATION ONLY: nothing in execution, sizing, risk, or channel policy reads
-- this table. A failed insert can lose evidence only.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.execution_quality_receipts (
  id                              uuid primary key,
  schema_version                  integer not null default 1 check (schema_version = 1),
  receipt_kind                    text not null check (receipt_kind = 'exit_fill'),
  trigger_kind                    text not null check (trigger_kind in (
    'premium_stop','underlying_stop','target','trail','time','safety','operator','other'
  )),
  trigger_at                      timestamptz not null,
  order_submitted_at              timestamptz not null,
  fill_observed_at                timestamptz not null,
  recorded_at                     timestamptz not null default now(),
  submission_to_fill_observed_ms  integer not null check (submission_to_fill_observed_ms >= 0),

  strategist_id                   uuid not null references public.strategists(id),
  account_id                      uuid not null references public.accounts(id),
  position_id                     uuid not null references public.positions(id),
  source_boot_id                  uuid references public.worker_runs(boot_id),
  source_version                  text not null,
  channel_slug                    text not null,
  underlying                      text not null,
  occ_symbol                      text not null,
  option_side                     text not null check (option_side in ('call','put')),
  reason                          text not null,

  client_order_id                 text not null,
  broker_order_id                 text not null,
  broker_status                   text not null,
  requested_qty                   integer not null check (requested_qty > 0),
  filled_qty                      integer not null check (filled_qty > 0 and filled_qty <= requested_qty),
  crossed_qty                     integer check (crossed_qty is null or (crossed_qty >= 0 and crossed_qty <= filled_qty)),

  entry_price                     numeric not null check (entry_price > 0),
  decision_bid                    numeric check (decision_bid is null or decision_bid > 0),
  decision_ask                    numeric check (decision_ask is null or decision_ask > 0),
  decision_spread_pct             numeric check (decision_spread_pct is null or decision_spread_pct >= 0),
  executable_reference_price      numeric check (executable_reference_price is null or executable_reference_price > 0),
  fill_price                      numeric not null check (fill_price > 0),
  trigger_return_pct              numeric,
  realized_return_pct             numeric not null,
  leakage_per_contract            numeric,
  leakage_usd                     numeric,
  leakage_bps                     numeric,

  configured_premium_stop_pct     numeric check (configured_premium_stop_pct is null or configured_premium_stop_pct > 0),
  configured_underlying_stop_pct  numeric check (configured_underlying_stop_pct is null or configured_underlying_stop_pct > 0),
  configured_take_profit_pct      numeric check (configured_take_profit_pct is null or configured_take_profit_pct > 0),
  threshold_overshoot_pp          numeric check (threshold_overshoot_pp is null or threshold_overshoot_pp >= 0),

  quote_source                    text not null check (quote_source = 'alpaca_chain_snapshot'),
  snapshot_age_ms                 integer check (snapshot_age_ms is null or snapshot_age_ms >= 0),
  provider_quote_event_age_ms     integer check (provider_quote_event_age_ms is null or provider_quote_event_age_ms >= 0),
  payload                         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),

  check (order_submitted_at >= trigger_at),
  check (fill_observed_at >= order_submitted_at),
  check (decision_ask is null or decision_bid is null or decision_ask >= decision_bid),
  check (
    (executable_reference_price is null and leakage_per_contract is null and leakage_usd is null and leakage_bps is null)
    or
    (executable_reference_price is not null and leakage_per_contract is not null and leakage_usd is not null and leakage_bps is not null)
  )
);

comment on table public.execution_quality_receipts is
  'Append-only paper exit-fill quality evidence; non-authoritative for execution and strategy policy.';
comment on column public.execution_quality_receipts.fill_observed_at is
  'Local time at which the terminal broker result was observed; not asserted as the broker exchange fill timestamp.';
comment on column public.execution_quality_receipts.provider_quote_event_age_ms is
  'Null when the active chain seam does not expose an authoritative per-contract provider quote timestamp.';
comment on column public.execution_quality_receipts.leakage_usd is
  'Positive is adverse versus the executable decision-side quote; negative is price improvement.';
comment on column public.execution_quality_receipts.threshold_overshoot_pp is
  'Realized fill return beyond the configured premium-stop threshold; trigger_return_pct separately shows policy-observation overshoot.';

create unique index idx_execution_quality_client_order
  on public.execution_quality_receipts (client_order_id, broker_order_id, position_id);
create index idx_execution_quality_position
  on public.execution_quality_receipts (position_id, fill_observed_at);
create index idx_execution_quality_channel
  on public.execution_quality_receipts (strategist_id, account_id, fill_observed_at desc);
create index idx_execution_quality_account
  on public.execution_quality_receipts (account_id, fill_observed_at desc);
create index idx_execution_quality_trigger
  on public.execution_quality_receipts (trigger_kind, fill_observed_at desc);
create index idx_execution_quality_boot
  on public.execution_quality_receipts (source_boot_id, fill_observed_at desc)
  where source_boot_id is not null;

alter table public.execution_quality_receipts enable row level security;

revoke all on public.execution_quality_receipts from public, anon, authenticated, service_role;
grant select, insert on public.execution_quality_receipts to service_role;
grant select on public.execution_quality_receipts to authenticated;

create policy execution_quality_receipts_operator_read
  on public.execution_quality_receipts
  for select
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

commit;
