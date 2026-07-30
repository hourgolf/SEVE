-- Server-only atomic manager-policy draft creation.
--
-- A manager change must carry its profile identity, deterministic manager
-- version, dashboard label, bank policy, stop, and ratchet in one patch. This
-- migration adds no client grant, approval, activation, runtime, or order path.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.create_channel_manager_policy_proposal_draft(
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
  existing_base_row public.channel_spec_versions%rowtype;
  proposed_row public.channel_spec_versions%rowtype;
  existing_proposal public.channel_change_proposals%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_proposal_id::text, 0)
  );

  select * into existing_proposal
  from public.channel_change_proposals
  where id = p_proposal_id;

  if existing_proposal.id is not null then
    select * into existing_base_row
    from public.channel_spec_versions
    where id = existing_proposal.base_spec_version_id;

    select * into proposed_row
    from public.channel_spec_versions
    where id = existing_proposal.proposed_spec_version_id;

    if existing_base_row.id is null
        or existing_base_row.version_key <> p_base_version_key
        or proposed_row.id is null
        or proposed_row.version_key <> p_proposed_version_key
        or existing_proposal.base_spec_content_hash <> p_base_content_hash
        or existing_proposal.proposed_patch <> p_proposed_patch
        or existing_proposal.reason <> btrim(p_reason)
        or existing_proposal.evidence_refs <> p_evidence_refs
        or existing_proposal.author_kind <> 'operator'
        or existing_proposal.author_id <> p_author_id
        or existing_proposal.change_class <> 'bounded-parameter'
        or existing_proposal.validation_results <> p_validation_results
        or existing_proposal.replay_summary <> p_replay_summary
        or existing_proposal.capacity_collision_impact <> p_capacity_collision_impact
        or existing_proposal.approval_state <> 'draft'
        or existing_proposal.activation_authorized is not false
        or proposed_row.content_hash <> (p_proposed_spec ->> 'contentHash') then
      raise exception using
        errcode = '23505',
        message = 'proposal idempotency conflict';
    end if;

    return query select
      existing_proposal.id,
      proposed_row.id,
      proposed_row.version_key,
      existing_proposal.approval_state,
      existing_proposal.activation_authorized,
      existing_proposal.created_at;
    return;
  end if;

  if p_proposed_version_key <> ('spec:draft:' || p_proposal_id::text) then
    raise exception 'proposed version key must be derived from the proposal id';
  end if;
  if p_created_at < pg_catalog.now() - interval '5 minutes'
      or p_created_at > pg_catalog.now() + interval '1 minute' then
    raise exception 'proposal timestamp is outside the server acceptance window';
  end if;
  if p_author_id is null
      or p_author_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_author_id::uuid::text <> p_author_id then
    raise exception 'operator identity must be a canonical UUID';
  end if;
  if p_reason is null
      or length(btrim(p_reason)) < 8
      or length(btrim(p_reason)) > 2000 then
    raise exception 'proposal reason must contain 8 to 2000 characters';
  end if;
  if p_change_class <> 'bounded-parameter' then
    raise exception 'manager-policy drafts must be bounded-parameter proposals';
  end if;
  if jsonb_typeof(p_proposed_patch) <> 'object'
      or not (p_proposed_patch ?& array[
        'managerProfileId', 'managerVersion', 'exitParameters',
        'takeProfit', 'stopLoss', 'ratchetParameters'
      ])
      or exists (
        select 1
        from jsonb_object_keys(p_proposed_patch) field
        where field not in (
          'managerProfileId', 'managerVersion', 'exitParameters',
          'takeProfit', 'stopLoss', 'ratchetParameters'
        )
      ) then
    raise exception 'manager-policy patch must contain exactly six identity and policy fields';
  end if;
  if p_proposed_patch ->> 'managerProfileId' !~ '^[A-Z0-9][A-Z0-9._/-]{2,99}$'
      or p_proposed_patch ->> 'managerVersion' !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_proposed_patch -> 'exitParameters') <> 'object'
      or jsonb_typeof(p_proposed_patch -> 'takeProfit') <> 'object'
      or jsonb_typeof(p_proposed_patch -> 'stopLoss') <> 'object'
      or jsonb_typeof(p_proposed_patch -> 'ratchetParameters') <> 'object' then
    raise exception 'manager-policy patch contains malformed identity or policy values';
  end if;
  if length(btrim(p_proposed_patch -> 'exitParameters' ->> 'managerLabel')) < 8
      or length(btrim(p_proposed_patch -> 'exitParameters' ->> 'managerLabel')) > 160
      or exists (
        select 1
        from jsonb_object_keys(p_proposed_patch -> 'takeProfit') field
        where field not in ('kind', 'targetPct', 'fraction')
      )
      or not (p_proposed_patch -> 'takeProfit' ?& array[
        'kind', 'targetPct', 'fraction'
      ])
      or p_proposed_patch -> 'takeProfit' ->> 'kind' not in ('ride', 'bank')
      or (
        p_proposed_patch -> 'takeProfit' ->> 'kind' = 'ride'
        and (
          p_proposed_patch -> 'takeProfit' -> 'targetPct' <> 'null'::jsonb
          or (p_proposed_patch -> 'takeProfit' ->> 'fraction')::numeric <> 0
        )
      )
      or (
        p_proposed_patch -> 'takeProfit' ->> 'kind' = 'bank'
        and (
          jsonb_typeof(p_proposed_patch -> 'takeProfit' -> 'targetPct') <> 'number'
          or (p_proposed_patch -> 'takeProfit' ->> 'targetPct')::numeric <= 0
          or (p_proposed_patch -> 'takeProfit' ->> 'fraction')::numeric <> 0.5
        )
      )
      or exists (
        select 1
        from jsonb_object_keys(p_proposed_patch -> 'stopLoss') field
        where field not in ('catastrophePct', 'priceBasis')
      )
      or not (p_proposed_patch -> 'stopLoss' ?& array[
        'catastrophePct', 'priceBasis'
      ])
      or p_proposed_patch -> 'stopLoss' ->> 'priceBasis'
        is distinct from 'executable-option-bid'
      or jsonb_typeof(p_proposed_patch -> 'stopLoss' -> 'catastrophePct')
        <> 'number'
      or (p_proposed_patch -> 'stopLoss' ->> 'catastrophePct')::numeric
        not between 0.000001 and 100
      or exists (
        select 1
        from jsonb_object_keys(p_proposed_patch -> 'ratchetParameters') field
        where field not in (
          'kind', 'engageReturnPct', 'givebackPct',
          'retainGainPct', 'fixedTargetPct'
        )
      )
      or not (p_proposed_patch -> 'ratchetParameters' ?& array[
        'kind', 'engageReturnPct', 'givebackPct',
        'retainGainPct', 'fixedTargetPct'
      ])
      or p_proposed_patch -> 'ratchetParameters' ->> 'kind'
        not in ('none', 'a13', 'fixed-target', 'native-atr')
      or (
        p_proposed_patch -> 'ratchetParameters' ->> 'kind'
          in ('none', 'native-atr')
        and (
          p_proposed_patch -> 'ratchetParameters' -> 'engageReturnPct'
            <> 'null'::jsonb
          or p_proposed_patch -> 'ratchetParameters' -> 'givebackPct'
            <> 'null'::jsonb
          or p_proposed_patch -> 'ratchetParameters' -> 'retainGainPct'
            <> 'null'::jsonb
          or p_proposed_patch -> 'ratchetParameters' -> 'fixedTargetPct'
            <> 'null'::jsonb
        )
      )
      or (
        p_proposed_patch -> 'ratchetParameters' ->> 'kind' = 'fixed-target'
        and (
          jsonb_typeof(
            p_proposed_patch -> 'ratchetParameters' -> 'fixedTargetPct'
          ) <> 'number'
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'fixedTargetPct'
          )::numeric <= 0
          or p_proposed_patch -> 'ratchetParameters' -> 'engageReturnPct'
            <> 'null'::jsonb
          or p_proposed_patch -> 'ratchetParameters' -> 'givebackPct'
            <> 'null'::jsonb
          or p_proposed_patch -> 'ratchetParameters' -> 'retainGainPct'
            <> 'null'::jsonb
        )
      )
      or (
        p_proposed_patch -> 'ratchetParameters' ->> 'kind' = 'a13'
        and (
          jsonb_typeof(
            p_proposed_patch -> 'ratchetParameters' -> 'engageReturnPct'
          ) <> 'number'
          or jsonb_typeof(
            p_proposed_patch -> 'ratchetParameters' -> 'givebackPct'
          ) <> 'number'
          or jsonb_typeof(
            p_proposed_patch -> 'ratchetParameters' -> 'retainGainPct'
          ) <> 'number'
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'engageReturnPct'
          )::numeric <= 0
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'givebackPct'
          )::numeric not between 0.000001 and 99.999999
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'retainGainPct'
          )::numeric not between 0.000001 and 99.999999
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'givebackPct'
          )::numeric + (
            p_proposed_patch -> 'ratchetParameters' ->> 'retainGainPct'
          )::numeric <> 100
          or p_proposed_patch -> 'ratchetParameters' -> 'fixedTargetPct'
            <> 'null'::jsonb
        )
      ) then
    raise exception 'manager-policy patch contains an invalid bounded policy';
  end if;
  if jsonb_typeof(p_evidence_refs) <> 'array'
      or jsonb_array_length(p_evidence_refs) > 32 then
    raise exception 'proposal evidence references are invalid';
  end if;
  if jsonb_typeof(p_validation_results) <> 'array'
      or jsonb_array_length(p_validation_results) = 0
      or exists (
        select 1
        from jsonb_array_elements(p_validation_results) result
        where result ->> 'state' not in ('pass', 'not-run')
      ) then
    raise exception 'draft proposal contains a blocking or malformed validation result';
  end if;
  if jsonb_typeof(p_replay_summary) <> 'object'
      or p_replay_summary ->> 'state' <> 'not-run'
      or jsonb_typeof(p_capacity_collision_impact) <> 'object'
      or p_capacity_collision_impact ->> 'state' <> 'not-run' then
    raise exception 'new draft evidence must begin in the not-run state';
  end if;

  select * into base_row
  from public.channel_spec_versions
  where version_key = p_base_version_key;

  if base_row.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'proposal base specification is missing';
  end if;
  if base_row.content_hash <> p_base_content_hash then
    raise exception using
      errcode = '40001',
      message = 'proposal base hash drifted';
  end if;
  if base_row.status not in ('draft', 'active') then
    raise exception 'proposal base status is not eligible for a draft child';
  end if;

  if jsonb_typeof(p_proposed_spec) <> 'object'
      or not (p_proposed_spec ?& array[
        'schemaVersion', 'id', 'channelId', 'slug', 'strategyIdentity',
        'strategyVersion', 'signalVersion', 'managerProfileId', 'managerVersion',
        'accountId', 'accountRole', 'accountMode', 'symbolScope', 'familyId',
        'cohort', 'priority', 'quantity', 'maxDebitUsd', 'entryParameters',
        'exitParameters', 'takeProfit', 'stopLoss', 'ratchetParameters',
        'reentryPolicy', 'scalePolicy', 'collisionDomain', 'riskLimits',
        'validFrom', 'validUntil', 'createdBy', 'createdAt', 'parentVersionId',
        'contentHash', 'status'
      ])
      or exists (
        select 1
        from jsonb_object_keys(p_proposed_spec) field
        where field not in (
          'schemaVersion', 'id', 'channelId', 'slug', 'strategyIdentity',
          'strategyVersion', 'signalVersion', 'managerProfileId', 'managerVersion',
          'accountId', 'accountRole', 'accountMode', 'symbolScope', 'familyId',
          'cohort', 'priority', 'quantity', 'maxDebitUsd', 'entryParameters',
          'exitParameters', 'takeProfit', 'stopLoss', 'ratchetParameters',
          'reentryPolicy', 'scalePolicy', 'collisionDomain', 'riskLimits',
          'validFrom', 'validUntil', 'createdBy', 'createdAt', 'parentVersionId',
          'contentHash', 'status'
        )
      )
      or (p_proposed_spec ->> 'schemaVersion')::integer is distinct from 1
      or p_proposed_spec ->> 'id' is distinct from p_proposed_version_key
      or p_proposed_spec ->> 'parentVersionId' is distinct from p_base_version_key
      or p_proposed_spec ->> 'channelId' is distinct from base_row.channel_id::text
      or p_proposed_spec ->> 'slug' is distinct from base_row.channel_slug
      or p_proposed_spec ->> 'createdBy' is distinct from ('operator:' || p_author_id)
      or (p_proposed_spec ->> 'createdAt')::timestamptz is distinct from p_created_at
      or (p_proposed_spec ->> 'validFrom')::timestamptz is distinct from p_created_at
      or p_proposed_spec ->> 'status' is distinct from 'draft'
      or p_proposed_spec ->> 'accountMode' is distinct from 'paper'
      or p_proposed_spec ->> 'validUntil' is not null
      or p_proposed_spec ->> 'contentHash' !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'proposed specification violates pinned draft identity';
  end if;

  if p_proposed_spec ->> 'strategyIdentity' is distinct from base_row.strategy_identity
      or p_proposed_spec ->> 'strategyVersion' is distinct from base_row.strategy_version
      or p_proposed_spec ->> 'signalVersion' is distinct from base_row.signal_version
      or p_proposed_spec ->> 'accountId' is distinct from base_row.account_id::text
      or p_proposed_spec ->> 'accountRole' is distinct from base_row.account_role
      or p_proposed_spec -> 'symbolScope' is distinct from base_row.symbol_scope
      or p_proposed_spec ->> 'familyId' is distinct from base_row.family_id
      or p_proposed_spec ->> 'cohort' is distinct from base_row.cohort
      or p_proposed_spec -> 'priority' is distinct from to_jsonb(base_row.priority)
      or p_proposed_spec -> 'quantity' is distinct from to_jsonb(base_row.quantity)
      or p_proposed_spec -> 'maxDebitUsd' is distinct from to_jsonb(base_row.max_debit_usd)
      or p_proposed_spec -> 'entryParameters' is distinct from base_row.entry_parameters
      or (p_proposed_spec -> 'exitParameters') - 'managerLabel'
        is distinct from base_row.exit_parameters - 'managerLabel'
      or p_proposed_spec ->> 'reentryPolicy' is distinct from base_row.reentry_policy
      or p_proposed_spec -> 'scalePolicy' is distinct from base_row.scale_policy
      or p_proposed_spec ->> 'collisionDomain' is distinct from base_row.collision_domain
      or p_proposed_spec -> 'riskLimits' is distinct from base_row.risk_limits then
    raise exception 'manager-policy proposal attempted a non-manager spec change';
  end if;

  if p_proposed_spec ->> 'managerProfileId'
        is distinct from p_proposed_patch ->> 'managerProfileId'
      or p_proposed_spec ->> 'managerVersion'
        is distinct from p_proposed_patch ->> 'managerVersion'
      or p_proposed_spec -> 'exitParameters'
        is distinct from p_proposed_patch -> 'exitParameters'
      or p_proposed_spec -> 'takeProfit'
        is distinct from p_proposed_patch -> 'takeProfit'
      or p_proposed_spec -> 'stopLoss'
        is distinct from p_proposed_patch -> 'stopLoss'
      or p_proposed_spec -> 'ratchetParameters'
        is distinct from p_proposed_patch -> 'ratchetParameters' then
    raise exception 'proposed specification does not match its manager-policy patch';
  end if;

  insert into public.channel_spec_versions (
    version_key, channel_id, channel_slug, strategy_identity, strategy_version,
    signal_version, manager_profile_id, manager_version, account_id,
    account_role, account_mode, symbol_scope, family_id, cohort, priority,
    quantity, max_debit_usd, entry_parameters, exit_parameters, take_profit,
    stop_loss, ratchet_parameters, reentry_policy, scale_policy,
    collision_domain, risk_limits, valid_from, valid_until, created_by,
    created_at, parent_version_id, content_hash, status
  ) values (
    p_proposed_version_key,
    (p_proposed_spec ->> 'channelId')::uuid,
    p_proposed_spec ->> 'slug',
    p_proposed_spec ->> 'strategyIdentity',
    p_proposed_spec ->> 'strategyVersion',
    p_proposed_spec ->> 'signalVersion',
    p_proposed_spec ->> 'managerProfileId',
    p_proposed_spec ->> 'managerVersion',
    (p_proposed_spec ->> 'accountId')::uuid,
    p_proposed_spec ->> 'accountRole',
    p_proposed_spec ->> 'accountMode',
    p_proposed_spec -> 'symbolScope',
    p_proposed_spec ->> 'familyId',
    p_proposed_spec ->> 'cohort',
    (p_proposed_spec ->> 'priority')::integer,
    (p_proposed_spec ->> 'quantity')::integer,
    (p_proposed_spec ->> 'maxDebitUsd')::numeric,
    p_proposed_spec -> 'entryParameters',
    p_proposed_spec -> 'exitParameters',
    p_proposed_spec -> 'takeProfit',
    p_proposed_spec -> 'stopLoss',
    p_proposed_spec -> 'ratchetParameters',
    p_proposed_spec ->> 'reentryPolicy',
    p_proposed_spec -> 'scalePolicy',
    p_proposed_spec ->> 'collisionDomain',
    p_proposed_spec -> 'riskLimits',
    (p_proposed_spec ->> 'validFrom')::timestamptz,
    null,
    p_proposed_spec ->> 'createdBy',
    p_created_at,
    base_row.id,
    p_proposed_spec ->> 'contentHash',
    'draft'
  )
  returning * into proposed_row;

  insert into public.channel_change_proposals (
    id, schema_version, base_spec_version_id, base_spec_content_hash,
    proposed_spec_version_id, proposed_patch, reason, evidence_refs,
    author_kind, author_id, change_class, validation_results, replay_summary,
    capacity_collision_impact, approval_state, requested_activation_boundary,
    activation_authorized, created_at, updated_at
  ) values (
    p_proposal_id, 1, base_row.id, p_base_content_hash,
    proposed_row.id, p_proposed_patch, btrim(p_reason), p_evidence_refs,
    'operator', p_author_id, 'bounded-parameter', p_validation_results,
    p_replay_summary, p_capacity_collision_impact, 'draft',
    'next-safe-entry', false, p_created_at, p_created_at
  )
  returning * into existing_proposal;

  return query select
    existing_proposal.id,
    proposed_row.id,
    proposed_row.version_key,
    existing_proposal.approval_state,
    existing_proposal.activation_authorized,
    existing_proposal.created_at;
end;
$$;

revoke all on function public.create_channel_manager_policy_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_channel_manager_policy_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) to service_role;

comment on function public.create_channel_manager_policy_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) is
  'Service-role-only atomic draft for one immutable manager-policy bundle. Never activation authority.';

commit;
