-- Every strategist must have one explicit append-only research-collection
-- state before the worker can consume it. The original registry migration
-- seeded the then-existing fleet, but later authority-dark research channels
-- could be inserted without a receipt and make the next worker boot fail
-- closed. Seed the two known gaps and make the invariant durable for future
-- strategist inserts. This grants no execution or order authority.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function seve_control.seed_channel_collection_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_collection_state_receipts (
    id, channel_id, channel_slug, state, prior_receipt_id, reason,
    evidence_refs, author_kind, operator_id, preview_hash, effective_at
  ) values (
    gen_random_uuid(), new.id, new.slug, 'active', null,
    'New channel collection bootstrap; execution and order authority remain false.',
    jsonb_build_array('system:new-channel-collection-bootstrap'),
    'system', null,
    'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    pg_catalog.now()
  ) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists strategist_collection_state_bootstrap
  on public.strategists;
create trigger strategist_collection_state_bootstrap
  after insert on public.strategists
  for each row execute function seve_control.seed_channel_collection_state();

insert into public.channel_collection_state_receipts (
  id, channel_id, channel_slug, state, prior_receipt_id, reason,
  evidence_refs, author_kind, operator_id, preview_hash, effective_at
)
select
  gen_random_uuid(), strategist.id, strategist.slug, 'active', null,
  'Repair missing new-channel collection bootstrap while preserving all evidence.',
  jsonb_build_array('incident:2026-09-03:worker-restart-loop'),
  'system', null,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  pg_catalog.now()
from public.strategists as strategist
where strategist.slug in ('fomc-event-follow', 'pm-momentum-follow')
  and not exists (
    select 1
    from public.channel_collection_state_receipts as receipt
    where receipt.channel_id = strategist.id
  );

commit;
