-- Qualify collection-receipt columns that collide with RETURNS TABLE output
-- variables. The original function rejected otherwise valid append-only writes
-- at runtime while preview and all execution-authority guards remained intact.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.apply_channel_collection_state_preview(
  p_request_id uuid,
  p_operator_id uuid,
  p_preview_hash text,
  p_changes jsonb,
  p_effective_at timestamptz
)
returns table (
  receipt_id uuid,
  channel_id uuid,
  channel_slug text,
  state text,
  prior_receipt_id uuid,
  effective_at timestamptz,
  preserves_history boolean,
  execution_authority boolean,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  current_receipt public.channel_collection_state_receipts%rowtype;
  strategist public.strategists%rowtype;
  inserted public.channel_collection_state_receipts%rowtype;
  target_state text;
  requested_channel_id uuid;
  requested_prior uuid;
  requested_receipt uuid;
  reason text;
  evidence jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );
  if p_preview_hash !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_changes) <> 'array'
      or jsonb_array_length(p_changes) < 1
      or jsonb_array_length(p_changes) > 68 then
    raise exception 'collection-state preview identity is malformed';
  end if;

  for item in select value from jsonb_array_elements(p_changes)
  loop
    requested_channel_id := (item ->> 'channelId')::uuid;
    requested_prior := (item ->> 'priorReceiptId')::uuid;
    requested_receipt := (item ->> 'receiptId')::uuid;
    target_state := item ->> 'targetState';
    reason := btrim(item ->> 'reason');
    evidence := item -> 'evidenceRefs';

    select strategist_row.* into strategist
    from public.strategists as strategist_row
    where strategist_row.id = requested_channel_id;

    select receipt_row.* into current_receipt
    from public.channel_collection_state_receipts as receipt_row
    where receipt_row.channel_id = requested_channel_id
    order by receipt_row.effective_at desc,
      receipt_row.created_at desc,
      receipt_row.id desc
    limit 1
    for update;

    select existing_row.* into inserted
    from public.channel_collection_state_receipts as existing_row
    where existing_row.id = requested_receipt;

    if inserted.id is not null then
      if inserted.channel_id <> requested_channel_id
          or inserted.prior_receipt_id <> requested_prior
          or inserted.state <> target_state
          or inserted.reason <> reason
          or inserted.evidence_refs <> evidence
          or inserted.operator_id <> p_operator_id
          or inserted.preview_hash <> p_preview_hash
          or inserted.effective_at <> p_effective_at then
        raise exception using errcode = '23505',
          message = 'collection-state idempotency conflict';
      end if;
      return query select
        inserted.id, inserted.channel_id, inserted.channel_slug,
        inserted.state, inserted.prior_receipt_id, inserted.effective_at,
        inserted.preserves_history, inserted.execution_authority,
        inserted.order_authority;
      continue;
    end if;

    if p_effective_at < pg_catalog.now() - interval '30 seconds'
        or p_effective_at > pg_catalog.now() + interval '5 seconds' then
      raise exception 'collection-state preview identity is stale';
    end if;
    if strategist.id is null or current_receipt.id is null
        or current_receipt.id <> requested_prior
        or strategist.slug <> item ->> 'channelSlug'
        or current_receipt.channel_slug <> strategist.slug then
      raise exception using errcode = '40001',
        message = 'collection-state base receipt drifted';
    end if;
    if target_state not in ('active', 'paused', 'archived')
        or target_state = current_receipt.state
        or length(reason) < 8
        or length(reason) > 2000
        or jsonb_typeof(evidence) <> 'array'
        or jsonb_array_length(evidence) > 32 then
      raise exception 'collection-state change is invalid';
    end if;
    if target_state <> 'active' and exists (
      select 1
      from public.release_manifests as manifest
      join public.release_manifest_channels as membership
        on membership.release_manifest_id = manifest.id
      join public.channel_spec_versions as spec
        on spec.id = membership.channel_spec_version_id
      where manifest.status = 'active'
        and spec.channel_id = requested_channel_id
        and coalesce(spec.execution_posture, 'paper') = 'paper'
    ) then
      raise exception 'executing paper channel collection must remain active';
    end if;

    insert into public.channel_collection_state_receipts (
      id, channel_id, channel_slug, state, prior_receipt_id, reason,
      evidence_refs, author_kind, operator_id, preview_hash, effective_at
    ) values (
      requested_receipt, requested_channel_id, strategist.slug, target_state,
      current_receipt.id, reason, evidence, 'operator', p_operator_id,
      p_preview_hash, p_effective_at
    )
    returning * into inserted;

    return query select
      inserted.id, inserted.channel_id, inserted.channel_slug,
      inserted.state, inserted.prior_receipt_id, inserted.effective_at,
      inserted.preserves_history, inserted.execution_authority,
      inserted.order_authority;
  end loop;
end;
$$;

revoke all on function public.apply_channel_collection_state_preview(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_channel_collection_state_preview(
  uuid, uuid, text, jsonb, timestamptz
) to service_role;

commit;
