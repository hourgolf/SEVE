-- Paper-only execution posture plus an independent, append-only research
-- collection registry. Installing this migration changes no active manifest,
-- route, economics, order, or current research posture. Existing channels are
-- seeded ACTIVE for collection so enabling the worker reader is a no-op.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.channel_spec_versions
  add column if not exists execution_posture text null
  check (execution_posture in ('paper', 'observe-only'));

comment on column public.channel_spec_versions.execution_posture is
  'Receipt-bound new-entry posture. NULL is the hash-stable legacy alias for paper; never research-collection authority.';

create table if not exists public.channel_collection_state_receipts (
  id                   uuid primary key,
  schema_version       integer not null default 1 check (schema_version = 1),
  channel_id           uuid not null references public.strategists(id),
  channel_slug         text not null check (
                           channel_slug ~ '^[a-z0-9][a-z0-9-]{1,99}$'
                         ),
  state                text not null check (state in ('active', 'paused', 'archived')),
  prior_receipt_id     uuid null references public.channel_collection_state_receipts(id),
  reason               text not null check (
                           length(btrim(reason)) between 8 and 2000
                         ),
  evidence_refs        jsonb not null check (
                           jsonb_typeof(evidence_refs) = 'array'
                           and jsonb_array_length(evidence_refs) <= 32
                         ),
  author_kind          text not null check (author_kind in ('operator', 'system')),
  operator_id          uuid null,
  preview_hash         text not null check (
                           preview_hash ~ '^sha256:[0-9a-f]{64}$'
                         ),
  effective_at         timestamptz not null,
  preserves_history    boolean not null default true check (preserves_history),
  execution_authority  boolean not null default false check (not execution_authority),
  order_authority      boolean not null default false check (not order_authority),
  created_at           timestamptz not null default now(),
  unique (channel_id, effective_at, id),
  check (
    (author_kind = 'operator' and operator_id is not null)
    or (author_kind = 'system' and operator_id is null)
  )
);

create index if not exists channel_collection_state_latest_idx
  on public.channel_collection_state_receipts
  (channel_id, effective_at desc, created_at desc);

create or replace view public.channel_collection_state_current
with (security_invoker = true)
as
select distinct on (receipt.channel_id)
  receipt.channel_id,
  receipt.channel_slug,
  receipt.state,
  receipt.id as receipt_id,
  receipt.prior_receipt_id,
  receipt.reason,
  receipt.evidence_refs,
  receipt.author_kind,
  receipt.operator_id,
  receipt.preview_hash,
  receipt.effective_at,
  receipt.preserves_history,
  receipt.execution_authority,
  receipt.order_authority
from public.channel_collection_state_receipts receipt
order by
  receipt.channel_id,
  receipt.effective_at desc,
  receipt.created_at desc,
  receipt.id desc;

insert into public.channel_collection_state_receipts (
  id, channel_id, channel_slug, state, prior_receipt_id, reason,
  evidence_refs, author_kind, operator_id, preview_hash, effective_at
)
select
  gen_random_uuid(), strategist.id, strategist.slug, 'active', null,
  'Baseline adoption preserves every existing research collection path.',
  jsonb_build_array('migration:20260731050000:baseline-active'),
  'system', null,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  pg_catalog.now()
from public.strategists strategist
where not exists (
  select 1
  from public.channel_collection_state_receipts receipt
  where receipt.channel_id = strategist.id
);

create or replace function seve_control.reject_channel_collection_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'channel collection receipts are append-only';
end;
$$;

drop trigger if exists channel_collection_receipts_append_only
  on public.channel_collection_state_receipts;
create trigger channel_collection_receipts_append_only
  before update or delete on public.channel_collection_state_receipts
  for each row execute function
    seve_control.reject_channel_collection_receipt_mutation();

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

    select * into strategist
    from public.strategists
    where id = requested_channel_id;

    select * into current_receipt
    from public.channel_collection_state_receipts
    where channel_id = requested_channel_id
    order by effective_at desc, created_at desc, id desc
    limit 1
    for update;

    select * into inserted
    from public.channel_collection_state_receipts
    where id = requested_receipt;

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
      from public.release_manifests manifest
      join public.release_manifest_channels membership
        on membership.release_manifest_id = manifest.id
      join public.channel_spec_versions spec
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

alter table public.channel_collection_state_receipts enable row level security;

revoke all on public.channel_collection_state_receipts
  from public, anon, authenticated, service_role;
revoke all on public.channel_collection_state_current
  from public, anon, authenticated, service_role;
grant select on public.channel_collection_state_receipts to authenticated, service_role;
grant select on public.channel_collection_state_current to authenticated, service_role;

drop policy if exists channel_collection_receipts_operator_read
  on public.channel_collection_state_receipts;
create policy channel_collection_receipts_operator_read
  on public.channel_collection_state_receipts
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

revoke all on function public.apply_channel_collection_state_preview(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_channel_collection_state_preview(
  uuid, uuid, text, jsonb, timestamptz
) to service_role;

create or replace function public.create_channel_execution_posture_proposal_draft(
  p_proposal_id uuid,
  p_base_version_key text,
  p_base_content_hash text,
  p_proposed_version_key text,
  p_proposed_spec jsonb,
  p_proposed_patch jsonb,
  p_reason text,
  p_evidence_refs jsonb,
  p_author_id text,
  p_change_class text,
  p_validation_results jsonb,
  p_replay_summary jsonb,
  p_capacity_collision_impact jsonb,
  p_created_at timestamptz
)
returns table (
  proposal_id uuid,
  proposed_spec_id uuid,
  proposed_version_key text,
  approval_state text,
  activation_authorized boolean,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  base_row public.channel_spec_versions%rowtype;
  proposed_row public.channel_spec_versions%rowtype;
  existing_proposal public.channel_change_proposals%rowtype;
  target_posture text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_proposal_id::text, 0)
  );
  select * into existing_proposal
  from public.channel_change_proposals where id = p_proposal_id;
  if existing_proposal.id is not null then
    select * into proposed_row from public.channel_spec_versions
    where id = existing_proposal.proposed_spec_version_id;
    if proposed_row.id is null
        or proposed_row.version_key <> p_proposed_version_key
        or existing_proposal.base_spec_content_hash <> p_base_content_hash
        or existing_proposal.proposed_patch <> p_proposed_patch
        or existing_proposal.reason <> btrim(p_reason)
        or existing_proposal.evidence_refs <> p_evidence_refs
        or existing_proposal.author_id <> p_author_id
        or existing_proposal.change_class <> 'governed-operational-policy'
        or existing_proposal.validation_results <> p_validation_results
        or existing_proposal.replay_summary <> p_replay_summary
        or existing_proposal.capacity_collision_impact
          <> p_capacity_collision_impact
        or proposed_row.content_hash <> p_proposed_spec ->> 'contentHash' then
      raise exception using errcode = '23505',
        message = 'execution-posture proposal idempotency conflict';
    end if;
    return query select
      existing_proposal.id, proposed_row.id, proposed_row.version_key,
      existing_proposal.approval_state,
      existing_proposal.activation_authorized,
      existing_proposal.created_at;
    return;
  end if;

  select * into base_row from public.channel_spec_versions
  where version_key = p_base_version_key for update;
  target_posture := p_proposed_patch ->> 'executionPosture';
  if base_row.id is null then
    raise exception using errcode = 'P0002',
      message = 'execution-posture proposal base is missing';
  end if;
  if base_row.content_hash <> p_base_content_hash then
    raise exception using errcode = '40001',
      message = 'execution-posture proposal base drifted';
  end if;
  if p_proposed_version_key <> ('spec:draft:' || p_proposal_id::text)
      or p_change_class <> 'governed-operational-policy'
      or p_author_id::uuid::text <> p_author_id
      or p_created_at < pg_catalog.now() - interval '5 minutes'
      or p_created_at > pg_catalog.now() + interval '1 minute'
      or jsonb_typeof(p_proposed_patch) <> 'object'
      or (select count(*) from jsonb_object_keys(p_proposed_patch)) <> 1
      or target_posture not in ('paper', 'observe-only')
      or target_posture = coalesce(base_row.execution_posture, 'paper')
      or length(btrim(p_reason)) not between 8 and 2000
      or jsonb_typeof(p_evidence_refs) <> 'array'
      or jsonb_array_length(p_evidence_refs) > 32
      or jsonb_typeof(p_validation_results) <> 'array'
      or exists (
        select 1 from jsonb_array_elements(p_validation_results) result
        where result ->> 'state' not in ('pass', 'not-run')
      )
      or p_replay_summary ->> 'state' <> 'not-run'
      or p_capacity_collision_impact ->> 'state' <> 'pass' then
    raise exception 'execution-posture draft is malformed';
  end if;
  if p_proposed_spec ->> 'id' <> p_proposed_version_key
      or p_proposed_spec ->> 'parentVersionId' <> p_base_version_key
      or p_proposed_spec ->> 'channelId' <> base_row.channel_id::text
      or p_proposed_spec ->> 'slug' <> base_row.channel_slug
      or p_proposed_spec ->> 'executionPosture' <> target_posture
      or p_proposed_spec ->> 'createdBy' <> ('operator:' || p_author_id)
      or (p_proposed_spec ->> 'createdAt')::timestamptz <> p_created_at
      or (p_proposed_spec ->> 'validFrom')::timestamptz <> p_created_at
      or p_proposed_spec ->> 'status' <> 'draft'
      or p_proposed_spec ->> 'contentHash' !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'execution-posture proposed specification identity is invalid';
  end if;
  if (p_proposed_spec - 'id' - 'parentVersionId' - 'createdBy'
        - 'createdAt' - 'validFrom' - 'status' - 'contentHash'
        - 'executionPosture')
      <> (
        jsonb_build_object(
          'schemaVersion', 1,
          'channelId', base_row.channel_id,
          'slug', base_row.channel_slug,
          'strategyIdentity', base_row.strategy_identity,
          'strategyVersion', base_row.strategy_version,
          'signalVersion', base_row.signal_version,
          'managerProfileId', base_row.manager_profile_id,
          'managerVersion', base_row.manager_version,
          'accountId', base_row.account_id,
          'accountRole', base_row.account_role,
          'accountMode', base_row.account_mode,
          'symbolScope', base_row.symbol_scope,
          'familyId', base_row.family_id,
          'cohort', base_row.cohort,
          'priority', base_row.priority,
          'quantity', base_row.quantity,
          'maxDebitUsd', base_row.max_debit_usd,
          'entryParameters', base_row.entry_parameters,
          'exitParameters', base_row.exit_parameters,
          'takeProfit', base_row.take_profit,
          'stopLoss', base_row.stop_loss,
          'ratchetParameters', base_row.ratchet_parameters,
          'reentryPolicy', base_row.reentry_policy,
          'scalePolicy', base_row.scale_policy,
          'collisionDomain', base_row.collision_domain,
          'riskLimits', base_row.risk_limits,
          'validUntil', null
        )
      ) then
    raise exception 'execution-posture draft attempted another change';
  end if;

  insert into public.channel_spec_versions (
    version_key, channel_id, channel_slug, strategy_identity, strategy_version,
    signal_version, manager_profile_id, manager_version, account_id,
    account_role, account_mode, symbol_scope, family_id, cohort, priority,
    quantity, max_debit_usd, entry_parameters, exit_parameters, take_profit,
    stop_loss, ratchet_parameters, reentry_policy, scale_policy,
    collision_domain, risk_limits, execution_posture, valid_from, valid_until,
    created_by, created_at, parent_version_id, content_hash, status
  ) values (
    p_proposed_version_key, base_row.channel_id, base_row.channel_slug,
    base_row.strategy_identity, base_row.strategy_version,
    base_row.signal_version, base_row.manager_profile_id,
    base_row.manager_version, base_row.account_id, base_row.account_role,
    base_row.account_mode, base_row.symbol_scope, base_row.family_id,
    base_row.cohort, base_row.priority, base_row.quantity,
    base_row.max_debit_usd, base_row.entry_parameters,
    base_row.exit_parameters, base_row.take_profit, base_row.stop_loss,
    base_row.ratchet_parameters, base_row.reentry_policy,
    base_row.scale_policy, base_row.collision_domain, base_row.risk_limits,
    target_posture, p_created_at, null, 'operator:' || p_author_id,
    p_created_at, base_row.id, p_proposed_spec ->> 'contentHash', 'draft'
  ) returning * into proposed_row;

  insert into public.channel_change_proposals (
    id, schema_version, base_spec_version_id, base_spec_content_hash,
    proposed_spec_version_id, proposed_patch, reason, evidence_refs,
    author_kind, author_id, change_class, validation_results, replay_summary,
    capacity_collision_impact, approval_state, requested_activation_boundary,
    activation_authorized, created_at, updated_at
  ) values (
    p_proposal_id, 1, base_row.id, p_base_content_hash, proposed_row.id,
    p_proposed_patch, btrim(p_reason), p_evidence_refs, 'operator',
    p_author_id, 'governed-operational-policy', p_validation_results,
    p_replay_summary, p_capacity_collision_impact, 'draft',
    'next-safe-entry', false, p_created_at, p_created_at
  ) returning * into existing_proposal;

  return query select
    existing_proposal.id, proposed_row.id, proposed_row.version_key,
    existing_proposal.approval_state,
    existing_proposal.activation_authorized,
    existing_proposal.created_at;
end;
$$;

-- The three pre-existing draft writers predate execution_posture. Make their
-- INSERTs preserve the base row explicitly so a later TP/SL, size, risk, or
-- re-entry proposal cannot silently turn an observe-only channel back to paper.
do $preserve_execution_posture$
declare
  function_definition text;
  corrected_definition text;
  function_identity regprocedure;
begin
  foreach function_identity in array array[
    'public.create_channel_change_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'public.create_channel_manager_policy_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'public.create_channel_reentry_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(function_identity)
    into function_definition;
    corrected_definition := pg_catalog.replace(
      function_definition,
      'collision_domain, risk_limits, valid_from, valid_until, created_by,',
      'collision_domain, risk_limits, execution_posture, valid_from, valid_until, created_by,'
    );
    corrected_definition := pg_catalog.replace(
      corrected_definition,
      E'p_proposed_spec -> ''riskLimits'',\n    (p_proposed_spec ->> ''validFrom'')::timestamptz,',
      E'p_proposed_spec -> ''riskLimits'',\n    base_row.execution_posture,\n    (p_proposed_spec ->> ''validFrom'')::timestamptz,'
    );
    if corrected_definition = function_definition
        or pg_catalog.strpos(
          corrected_definition,
          'risk_limits, execution_posture, valid_from'
        ) = 0
        or pg_catalog.strpos(
          corrected_definition,
          E'base_row.execution_posture,\n    (p_proposed_spec ->> ''validFrom'')'
        ) = 0 then
      raise exception 'execution-posture preservation did not match %',
        function_identity::text;
    end if;
    execute corrected_definition;
  end loop;
end;
$preserve_execution_posture$;

-- A preview may remain under operator review for longer than the 60-second
-- acknowledgement freshness window. Permit the same current boot to append a
-- fresh immutable acknowledgement; idempotency is by acknowledgement id.
alter table public.channel_activation_worker_acknowledgements
  drop constraint if exists
    channel_activation_worker_acknowledgements_proposal_id_source_boot_id_key;

create or replace function public.acknowledge_channel_change_proposal_preview(
  p_acknowledgement_id uuid,
  p_preview_id uuid,
  p_source_boot_id uuid,
  p_worker_release_id text,
  p_acknowledged_at timestamptz,
  p_evidence_ref text,
  p_acknowledgement jsonb
)
returns table (
  acknowledgement_id uuid,
  proposal_id uuid,
  preview_id uuid,
  acknowledged_at timestamptz,
  runtime_mutation boolean,
  order_authority boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preview public.channel_activation_previews%rowtype;
  existing public.channel_activation_worker_acknowledgements%rowtype;
begin
  select * into preview
  from public.channel_activation_previews
  where id = p_preview_id;

  if preview.id is null then
    raise exception using errcode = 'P0002',
      message = 'activation preview is missing';
  end if;

  select * into existing
  from public.channel_activation_worker_acknowledgements
  where id = p_acknowledgement_id;

  if existing.id is not null then
    if existing.proposal_id <> preview.proposal_id
        or existing.preview_id <> p_preview_id
        or existing.source_boot_id <> p_source_boot_id
        or existing.worker_release_id <> p_worker_release_id
        or existing.acknowledged_at <> p_acknowledged_at
        or existing.evidence_ref <> btrim(p_evidence_ref)
        or existing.acknowledgement <> p_acknowledgement then
      raise exception using errcode = '23505',
        message = 'worker acknowledgement idempotency conflict';
    end if;
    return query select
      existing.id, existing.proposal_id, existing.preview_id,
      existing.acknowledged_at, existing.runtime_mutation,
      existing.order_authority;
    return;
  end if;

  insert into public.channel_activation_worker_acknowledgements (
    id, proposal_id, preview_id, candidate_manifest_key,
    candidate_manifest_hash, configuration_epoch_id,
    worker_compatibility_version, worker_release_id, source_boot_id,
    account_mode, posture, evidence_ref, acknowledged_at,
    acknowledgement, runtime_mutation, order_authority
  ) values (
    p_acknowledgement_id, preview.proposal_id, preview.id,
    preview.candidate_manifest_key, preview.candidate_manifest_hash,
    preview.configuration_epoch_id,
    preview.worker_projection ->> 'workerCompatibilityVersion',
    p_worker_release_id, p_source_boot_id, 'paper',
    'staged-no-order-authority', btrim(p_evidence_ref), p_acknowledged_at,
    p_acknowledgement, false, false
  )
  returning * into existing;

  return query select
    existing.id, existing.proposal_id, existing.preview_id,
    existing.acknowledged_at, existing.runtime_mutation,
    existing.order_authority;
end;
$$;

-- Keep acknowledgements fresh without producing one append-only row every
-- 30 seconds for a proposal left under review. The worker refreshes at two
-- minutes; every approval and atomic activation still re-checks the exact
-- current boot and rejects evidence older than five minutes.
do $ack_freshness$
declare
  function_definition text;
  corrected_definition text;
  function_identity regprocedure;
begin
  foreach function_identity in array array[
    'seve_control.enforce_channel_activation_worker_ack_insert()'::regprocedure,
    'seve_control.enforce_channel_activation_approval_insert()'::regprocedure,
    'public.activate_channel_change_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(function_identity)
    into function_definition;
    corrected_definition := pg_catalog.replace(
      function_definition,
      E'interval ''60 seconds''',
      E'interval ''5 minutes'''
    );
    if corrected_definition = function_definition
        and pg_catalog.strpos(
          function_definition,
          E'interval ''5 minutes'''
        ) = 0 then
      raise exception 'activation acknowledgement freshness correction did not match %',
        function_identity::text;
    end if;
    execute corrected_definition;
  end loop;
end;
$ack_freshness$;

revoke all on function public.create_channel_execution_posture_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_channel_execution_posture_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) to service_role;

commit;
