-- Fixed admission must read the complete custody inventory before its 2s
-- freshness bound. One STABLE statement supplies a consistent snapshot;
-- scalar JSON avoids PostgREST's table-row cap. Never grants order authority.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function public.fixed_entry_admission_snapshot_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $snapshot$
with
observations as materialized (
  select id, trace_id, schema_version, event_kind, event_at, source_bar_at, strategist_id, account_id, channel_slug, opportunity_id, position_id, action, reason, blocked_reason, underlying, occ_symbol, option_side, quote_source, quote_age_ms, bid, ask, mid, delta, underlying_price, requested_qty, client_order_id, broker_order_id, broker_status, filled_qty, fill_price, channel_spec_version_id, release_manifest_id, configuration_epoch_id, payload
  from public.execution_observations
  where reason = 'fixed_entry_protocol:intent'
     or payload->>'fixed_entry_protocol' = 'fixed-entry-intent-v1'
  order by id limit 100001
),
strategists as materialized (
  select id, slug
  from public.strategists
  order by id limit 100001
),
-- Fixed rows retain all settlement/identity fields. Legacy rows below retain
-- all quota inputs; unrelated research features never cross the network.
positions as materialized (
  select id, status, strategist_id, occ_symbol, underlying, expiration, strike, opt_type, qty, avg_entry_price, current_mark, realized_pnl, unrealized_pnl, closed_at, close_reason, opened_at, entry_reason, entry_delta, runner_of, channel_spec_version_id, release_manifest_id, configuration_epoch_id, peak_mark, trough_mark, peak_at, trough_at, entry_features
  from public.positions
  order by id limit 100001
),
counts as (select (select count(*) from observations) as observations,
  (select count(*) from strategists) as strategists, (select count(*) from positions) as positions)
select jsonb_build_object(
  'schema', 'fixed-admission-snapshot-v1',
  'complete', greatest(c.observations, c.strategists, c.positions) <= 100000,
  'counts', to_jsonb(c),
  'observations', case when greatest(c.observations, c.strategists, c.positions) <= 100000
    then (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from observations r) else null end,
  'strategists', case when greatest(c.observations, c.strategists, c.positions) <= 100000
    then (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from strategists r) else null end,
  'positions', case when greatest(c.observations, c.strategists, c.positions) <= 100000
    then (select coalesce(jsonb_agg(case
      when jsonb_typeof(r.entry_features) = 'object' and (
        r.entry_features ? 'fixed_entry_coverage' or
        (jsonb_typeof(r.entry_features->'receipt_bound_entry_policy') = 'object' and (
          r.entry_features->'receipt_bound_entry_policy' ? 'fixedContractAdmission' or
          r.entry_features->'receipt_bound_entry_policy'->>'policyVersion' = 'receipt-bound-entry-policy-v3')))
      then to_jsonb(r)
      else jsonb_build_object('id',r.id,'strategist_id',r.strategist_id,'opened_at',r.opened_at,
        'runner_of',r.runner_of,'qty',r.qty,'avg_entry_price',r.avg_entry_price,
        'entry_features',jsonb_build_object('receipt_bound_entry_policy',
          jsonb_build_object('configuration',jsonb_build_object('channelSlug',
            r.entry_features->'receipt_bound_entry_policy'->'configuration'->'channelSlug'))))
      end order by r.id), '[]'::jsonb) from positions r) else null end
) from counts c;
$snapshot$;
revoke all on function public.fixed_entry_admission_snapshot_v1() from public, anon, authenticated;
grant execute on function public.fixed_entry_admission_snapshot_v1() to service_role;
comment on function public.fixed_entry_admission_snapshot_v1() is
  'Service-only complete fixed-entry admission inventory. One snapshot, no date/roster/status filtering, bounded at 100000 rows per collection; no writes.';
commit;
