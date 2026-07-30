-- PROPOSED / UNAPPLIED: normal bounded channel-proposal activation bridge.
--
-- This is the successor to the one-time baseline-adoption seam. It does not
-- seed a proposal, approve a proposal, activate a manifest, alter a roster, or
-- grant order authority when the migration is installed. It adds three
-- append-only evidence receipts plus service-role-only atomic RPCs:
--
--   validated preview -> candidate-specific worker acknowledgement
--   -> operator-approved next-safe-entry activation receipt.
--
-- The legacy channel_change_proposals.activation_authorized column remains
-- pinned false. Normal authority is represented by an immutable approval row,
-- never by mutating a proposal boolean.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.channel_activation_previews (
  id                           uuid primary key,
  schema_version               integer not null default 1 check (schema_version = 1),
  proposal_id                  uuid not null unique references public.channel_change_proposals(id),
  base_release_manifest_id     uuid not null references public.release_manifests(id),
  candidate_manifest_key       text not null unique check (
                                  candidate_manifest_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
                                ),
  candidate_release_id         text not null unique,
  candidate_manifest_hash      text not null unique check (
                                  candidate_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
                                ),
  configuration_epoch_id       text not null unique check (
                                  configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                                ),
  candidate_manifest           jsonb not null check (
                                  jsonb_typeof(candidate_manifest) = 'object'
                                  and candidate_manifest <> '{}'::jsonb
                                ),
  worker_projection            jsonb not null check (
                                  jsonb_typeof(worker_projection) = 'object'
                                  and worker_projection <> '{}'::jsonb
                                ),
  dashboard_projection         jsonb not null check (
                                  jsonb_typeof(dashboard_projection) = 'object'
                                  and dashboard_projection <> '{}'::jsonb
                                ),
  validation_results           jsonb not null check (
                                  jsonb_typeof(validation_results) = 'array'
                                  and jsonb_array_length(validation_results) > 0
                                ),
  replay_summary               jsonb not null check (
                                  jsonb_typeof(replay_summary) = 'object'
                                ),
  capacity_collision_impact    jsonb not null check (
                                  jsonb_typeof(capacity_collision_impact) = 'object'
                                ),
  capture_continuity           jsonb not null check (
                                  jsonb_typeof(capture_continuity) = 'object'
                                  and capture_continuity <> '{}'::jsonb
                                ),
  prepared_by                  uuid not null,
  prepared_at                  timestamptz not null,
  runtime_mutation             boolean not null default false check (runtime_mutation = false),
  order_authority              boolean not null default false check (order_authority = false),
  created_at                   timestamptz not null default now()
);

create index channel_activation_previews_base_idx
  on public.channel_activation_previews (base_release_manifest_id, prepared_at desc);

create table public.channel_activation_worker_acknowledgements (
  id                           uuid primary key,
  schema_version               integer not null default 1 check (schema_version = 1),
  proposal_id                  uuid not null references public.channel_change_proposals(id),
  preview_id                   uuid not null references public.channel_activation_previews(id),
  candidate_manifest_key       text not null,
  candidate_manifest_hash      text not null check (
                                  candidate_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
                                ),
  configuration_epoch_id       text not null check (
                                  configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                                ),
  worker_compatibility_version text not null,
  worker_release_id            text not null,
  source_boot_id               uuid not null references public.worker_runs(boot_id),
  account_mode                 text not null check (account_mode = 'paper'),
  posture                      text not null check (posture = 'staged-no-order-authority'),
  evidence_ref                 text not null check (length(btrim(evidence_ref)) > 0),
  acknowledged_at              timestamptz not null,
  acknowledgement              jsonb not null check (
                                  jsonb_typeof(acknowledgement) = 'object'
                                  and acknowledgement <> '{}'::jsonb
                                ),
  runtime_mutation             boolean not null default false check (runtime_mutation = false),
  order_authority              boolean not null default false check (order_authority = false),
  created_at                   timestamptz not null default now(),
  unique (proposal_id, source_boot_id)
);

create index channel_activation_worker_ack_preview_idx
  on public.channel_activation_worker_acknowledgements (preview_id, acknowledged_at desc);

create table public.channel_activation_approvals (
  id                           uuid primary key,
  schema_version               integer not null default 1 check (schema_version = 1),
  proposal_id                  uuid not null unique references public.channel_change_proposals(id),
  preview_id                   uuid not null unique references public.channel_activation_previews(id),
  worker_acknowledgement_id    uuid not null unique references public.channel_activation_worker_acknowledgements(id),
  approved_by                  uuid not null,
  approval_evidence_ref        text not null check (length(btrim(approval_evidence_ref)) > 0),
  approved_at                  timestamptz not null,
  activation_boundary          text not null check (activation_boundary = 'next-safe-entry'),
  runtime_mutation_scope       text not null check (
                                  runtime_mutation_scope = 'receipt-bound-new-entry-only'
                                ),
  order_authority              boolean not null default false check (order_authority = false),
  created_at                   timestamptz not null default now()
);

create index channel_activation_approvals_approved_idx
  on public.channel_activation_approvals (approved_at desc);

create or replace function seve_control.reject_channel_activation_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

create or replace function seve_control.enforce_channel_activation_preview_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  base_spec public.channel_spec_versions%rowtype;
  proposed_spec public.channel_spec_versions%rowtype;
  base_manifest public.release_manifests%rowtype;
begin
  select * into proposal
  from public.channel_change_proposals
  where id = new.proposal_id;

  select * into base_spec
  from public.channel_spec_versions
  where id = proposal.base_spec_version_id;

  select * into proposed_spec
  from public.channel_spec_versions
  where id = proposal.proposed_spec_version_id;

  select manifest.* into base_manifest
  from public.release_manifests manifest
  join public.release_manifest_channels membership
    on membership.release_manifest_id = manifest.id
  where manifest.id = new.base_release_manifest_id
    and membership.channel_spec_version_id = base_spec.id;

  if proposal.id is null or base_spec.id is null
      or proposed_spec.id is null or base_manifest.id is null then
    raise exception 'activation preview references missing control-plane rows';
  end if;
  if proposal.approval_state <> 'draft'
      or proposal.activation_authorized is not false
      or base_spec.status <> 'active'
      or proposed_spec.status <> 'draft'
      or proposed_spec.parent_version_id <> base_spec.id
      or base_manifest.status <> 'active' then
    raise exception 'activation preview requires an active base and draft child';
  end if;
  if new.candidate_manifest_key <> ('manifest:candidate:' || proposal.id::text)
      or new.candidate_manifest ->> 'id' <> new.candidate_manifest_key
      or new.candidate_manifest ->> 'releaseId' <> new.candidate_release_id
      or new.candidate_manifest ->> 'contentHash' <> new.candidate_manifest_hash
      or new.candidate_manifest ->> 'parentManifestId' <> base_manifest.manifest_key
      or new.candidate_manifest ->> 'rollbackTargetManifestId' <> base_manifest.manifest_key
      or new.candidate_manifest ->> 'paperLiveAuthority' <> 'paper-only'
      or new.candidate_manifest ->> 'activationBoundary' <> 'next-safe-entry'
      or new.candidate_manifest ->> 'status' <> 'draft' then
    raise exception 'activation preview candidate manifest identity is invalid';
  end if;
  if new.worker_projection ->> 'manifestContentHash' <> new.candidate_manifest_hash
      or new.dashboard_projection ->> 'manifestContentHash' <> new.candidate_manifest_hash
      or new.worker_projection ->> 'releaseId' <> new.candidate_release_id
      or new.dashboard_projection ->> 'releaseId' <> new.candidate_release_id
      or new.worker_projection ->> 'activationAuthorized' <> 'false'
      or new.dashboard_projection ->> 'activationAuthorized' <> 'false' then
    raise exception 'activation preview projections disagree or imply authority';
  end if;
  if jsonb_typeof(new.worker_projection -> 'roots') <> 'array'
      or jsonb_typeof(new.dashboard_projection -> 'roots') <> 'array'
      or new.worker_projection -> 'roots' <> (
        select coalesce(
          jsonb_agg(
            root
              - 'accountName'
              - 'riskBudgetUsd'
              - 'premiumStopPct'
              - 'bankTargetPct'
              - 'runner'
              - 'runnerFraction'
              - 'managerLabel'
              - 'eodEt'
            order by ord
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(
          new.dashboard_projection -> 'roots'
        ) with ordinality as dashboard_roots(root, ord)
      ) then
    raise exception 'activation preview worker and dashboard roots disagree';
  end if;
  if new.candidate_manifest -> 'channelSpecVersionIds' is null
      or new.candidate_manifest -> 'channelSpecContentHashes' is null
      or jsonb_typeof(new.candidate_manifest -> 'channelSpecVersionIds') <> 'array'
      or jsonb_typeof(new.candidate_manifest -> 'channelSpecContentHashes') <> 'array'
      or jsonb_array_length(new.candidate_manifest -> 'channelSpecVersionIds')
        <> jsonb_array_length(new.candidate_manifest -> 'channelSpecContentHashes')
      or new.candidate_manifest -> 'channelSpecVersionIds' <> (
        select coalesce(
          jsonb_agg(root ->> 'channelSpecVersionId' order by ord),
          '[]'::jsonb
        )
        from jsonb_array_elements(
          new.worker_projection -> 'roots'
        ) with ordinality as worker_roots(root, ord)
      )
      or new.candidate_manifest -> 'channelSpecContentHashes' <> (
        select coalesce(
          jsonb_agg(root ->> 'channelSpecContentHash' order by ord),
          '[]'::jsonb
        )
        from jsonb_array_elements(
          new.worker_projection -> 'roots'
        ) with ordinality as worker_roots(root, ord)
      )
      or not (
        new.candidate_manifest -> 'channelSpecVersionIds'
          @> jsonb_build_array(proposed_spec.version_key)
      )
      or not (
        new.candidate_manifest -> 'channelSpecContentHashes'
          @> jsonb_build_array(proposed_spec.content_hash)
      ) then
    raise exception 'activation preview candidate membership is incomplete';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.validation_results) result
    where result ->> 'state' <> 'pass'
  ) then
    raise exception 'activation preview contains a non-passing validation gate';
  end if;
  if new.replay_summary ->> 'state' <> 'sufficient'
      or new.capacity_collision_impact ->> 'state' <> 'pass'
      or new.capture_continuity ->> 'state' <> 'pass' then
    raise exception 'activation preview evidence is incomplete';
  end if;
  if new.capture_continuity -> 'evidenceRefs' is null
      or jsonb_typeof(new.capture_continuity -> 'evidenceRefs') <> 'array'
      or jsonb_array_length(new.capture_continuity -> 'evidenceRefs') < 5 then
    raise exception 'activation preview capture continuity is incomplete';
  end if;
  if new.prepared_at < pg_catalog.now() - interval '5 minutes'
      or new.prepared_at > pg_catalog.now() + interval '1 minute' then
    raise exception 'activation preview timestamp is outside the acceptance window';
  end if;
  if new.runtime_mutation or new.order_authority then
    raise exception 'activation preview cannot mutate runtime or grant order authority';
  end if;
  return new;
end;
$$;

create or replace function seve_control.enforce_channel_activation_worker_ack_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preview public.channel_activation_previews%rowtype;
  run public.worker_runs%rowtype;
begin
  select * into preview
  from public.channel_activation_previews
  where id = new.preview_id;

  select * into run
  from public.worker_runs
  where boot_id = new.source_boot_id;

  if preview.id is null or run.boot_id is null
      or preview.proposal_id <> new.proposal_id then
    raise exception 'worker acknowledgement references missing or mismatched evidence';
  end if;
  if new.candidate_manifest_key <> preview.candidate_manifest_key
      or new.candidate_manifest_hash <> preview.candidate_manifest_hash
      or new.configuration_epoch_id <> preview.configuration_epoch_id
      or new.worker_compatibility_version
        <> preview.worker_projection ->> 'workerCompatibilityVersion' then
    raise exception 'worker acknowledgement disagrees with the reviewed preview';
  end if;
  if new.acknowledgement ->> 'protocolVersion'
        <> 'channel-activation-protocol-v1'
      or new.acknowledgement ->> 'proposalId' <> new.proposal_id::text
      or new.acknowledgement ->> 'manifestId' <> new.candidate_manifest_key
      or new.acknowledgement ->> 'manifestContentHash'
        <> new.candidate_manifest_hash
      or new.acknowledgement ->> 'configurationEpochId'
        <> new.configuration_epoch_id
      or new.acknowledgement ->> 'workerCompatibilityVersion'
        <> new.worker_compatibility_version
      or new.acknowledgement ->> 'workerReleaseId' <> new.worker_release_id
      or new.acknowledgement ->> 'bootId' <> new.source_boot_id::text
      or new.acknowledgement ->> 'accountMode' <> 'paper'
      or new.acknowledgement ->> 'posture' <> 'staged-no-order-authority'
      or (new.acknowledgement ->> 'acknowledgedAt')::timestamptz
        is distinct from new.acknowledged_at
      or new.acknowledgement ->> 'evidenceRef' <> new.evidence_ref then
    raise exception 'worker acknowledgement payload is not exact';
  end if;
  if run.ended_at is not null
      or new.acknowledged_at < pg_catalog.now() - interval '60 seconds'
      or new.acknowledged_at > pg_catalog.now() + interval '5 seconds' then
    raise exception 'worker acknowledgement is stale, future, or not current';
  end if;
  if new.runtime_mutation or new.order_authority then
    raise exception 'worker acknowledgement cannot mutate runtime or grant order authority';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_channel_change_proposal_preview(
  p_preview_id uuid,
  p_proposal_id uuid,
  p_base_manifest_key text,
  p_candidate_manifest jsonb,
  p_configuration_epoch_id text,
  p_worker_projection jsonb,
  p_dashboard_projection jsonb,
  p_validation_results jsonb,
  p_replay_summary jsonb,
  p_capacity_collision_impact jsonb,
  p_capture_continuity jsonb,
  p_prepared_by uuid,
  p_prepared_at timestamptz
)
returns table (
  preview_id uuid,
  proposal_id uuid,
  proposal_state text,
  candidate_manifest_key text,
  candidate_manifest_hash text,
  configuration_epoch_id text,
  runtime_mutation boolean,
  order_authority boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  proposed_spec public.channel_spec_versions%rowtype;
  base_manifest public.release_manifests%rowtype;
  preview public.channel_activation_previews%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_proposal_id::text, 0)
  );

  select * into proposal
  from public.channel_change_proposals
  where id = p_proposal_id
  for update;

  select * into proposed_spec
  from public.channel_spec_versions
  where id = proposal.proposed_spec_version_id
  for update;

  select * into base_manifest
  from public.release_manifests
  where manifest_key = p_base_manifest_key
  for update;

  select * into preview
  from public.channel_activation_previews as preview_by_proposal
  where preview_by_proposal.proposal_id = p_proposal_id;

  if preview.id is not null then
    if base_manifest.id is null
        or preview.id <> p_preview_id
        or preview.base_release_manifest_id <> base_manifest.id
        or preview.candidate_manifest <> p_candidate_manifest
        or preview.configuration_epoch_id <> p_configuration_epoch_id
        or preview.worker_projection <> p_worker_projection
        or preview.dashboard_projection <> p_dashboard_projection
        or preview.validation_results <> p_validation_results
        or preview.replay_summary <> p_replay_summary
        or preview.capacity_collision_impact <> p_capacity_collision_impact
        or preview.capture_continuity <> p_capture_continuity
        or preview.prepared_by <> p_prepared_by
        or preview.prepared_at <> p_prepared_at then
      raise exception using errcode = '23505',
        message = 'activation preview idempotency conflict';
    end if;
    return query select
      preview.id, preview.proposal_id, proposal.approval_state,
      preview.candidate_manifest_key, preview.candidate_manifest_hash,
      preview.configuration_epoch_id, preview.runtime_mutation,
      preview.order_authority;
    return;
  end if;

  if proposal.id is null or proposed_spec.id is null or base_manifest.id is null then
    raise exception using errcode = 'P0002',
      message = 'activation preview base is missing';
  end if;
  if proposal.approval_state <> 'draft'
      or proposed_spec.status <> 'draft'
      or base_manifest.status <> 'active' then
    raise exception 'activation preview lifecycle is not eligible';
  end if;
  if not exists (
    select 1
    from public.release_manifest_channels membership
    where membership.release_manifest_id = base_manifest.id
      and membership.channel_spec_version_id = proposal.base_spec_version_id
  ) then
    raise exception using errcode = '40001',
      message = 'activation preview base manifest drifted';
  end if;

  insert into public.channel_activation_previews (
    id, proposal_id, base_release_manifest_id, candidate_manifest_key,
    candidate_release_id, candidate_manifest_hash, configuration_epoch_id,
    candidate_manifest, worker_projection, dashboard_projection,
    validation_results, replay_summary, capacity_collision_impact,
    capture_continuity, prepared_by, prepared_at, runtime_mutation,
    order_authority
  ) values (
    p_preview_id, proposal.id, base_manifest.id,
    p_candidate_manifest ->> 'id',
    p_candidate_manifest ->> 'releaseId',
    p_candidate_manifest ->> 'contentHash',
    p_configuration_epoch_id, p_candidate_manifest, p_worker_projection,
    p_dashboard_projection, p_validation_results, p_replay_summary,
    p_capacity_collision_impact, p_capture_continuity, p_prepared_by,
    p_prepared_at, false, false
  )
  returning * into preview;

  update public.channel_change_proposals
  set validation_results = p_validation_results,
      replay_summary = p_replay_summary,
      capacity_collision_impact = p_capacity_collision_impact,
      approval_state = 'validated'
  where id = proposal.id;

  update public.channel_spec_versions
  set status = 'validated'
  where id = proposed_spec.id;

  return query select
    preview.id, preview.proposal_id, 'validated'::text,
    preview.candidate_manifest_key, preview.candidate_manifest_hash,
    preview.configuration_epoch_id, preview.runtime_mutation,
    preview.order_authority;
end;
$$;

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
  from public.channel_activation_worker_acknowledgements as acknowledgement_by_worker
  where acknowledgement_by_worker.proposal_id = preview.proposal_id
    and acknowledgement_by_worker.source_boot_id = p_source_boot_id;

  if existing.id is not null then
    if existing.id <> p_acknowledgement_id
        or existing.preview_id <> p_preview_id
        or existing.worker_release_id <> p_worker_release_id
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

create or replace function seve_control.enforce_channel_activation_approval_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  preview public.channel_activation_previews%rowtype;
  acknowledgement public.channel_activation_worker_acknowledgements%rowtype;
begin
  select * into proposal
  from public.channel_change_proposals
  where id = new.proposal_id;

  select * into preview
  from public.channel_activation_previews
  where id = new.preview_id
    and proposal_id = new.proposal_id;

  select * into acknowledgement
  from public.channel_activation_worker_acknowledgements
  where id = new.worker_acknowledgement_id
    and proposal_id = new.proposal_id
    and preview_id = new.preview_id;

  if proposal.id is null or preview.id is null or acknowledgement.id is null then
    raise exception 'activation approval references missing or mismatched evidence';
  end if;
  if proposal.approval_state <> 'validated'
      or proposal.activation_authorized is not false
      or preview.validation_results <> proposal.validation_results
      or preview.replay_summary <> proposal.replay_summary
      or preview.capacity_collision_impact <> proposal.capacity_collision_impact
      or acknowledgement.candidate_manifest_key <> preview.candidate_manifest_key
      or acknowledgement.candidate_manifest_hash <> preview.candidate_manifest_hash
      or acknowledgement.configuration_epoch_id <> preview.configuration_epoch_id then
    raise exception 'activation approval evidence is stale or disagrees';
  end if;
  if acknowledgement.acknowledged_at < pg_catalog.now() - interval '60 seconds'
      or acknowledgement.acknowledged_at > pg_catalog.now() + interval '5 seconds'
      or new.approved_at < pg_catalog.now() - interval '2 hours'
      or new.approved_at > pg_catalog.now() + interval '5 seconds' then
    raise exception 'activation approval or worker acknowledgement is stale or future';
  end if;
  if new.activation_boundary <> 'next-safe-entry'
      or new.runtime_mutation_scope <> 'receipt-bound-new-entry-only'
      or new.order_authority then
    raise exception 'activation approval exceeds the bounded authority';
  end if;
  return new;
end;
$$;

-- Normal proposal activation is authorized by the immutable approval receipt
-- created inside activate_channel_change_proposal(), not by the permanently
-- false legacy boolean on channel_change_proposals.
create or replace function seve_control.enforce_activation_receipt_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  old_spec public.channel_spec_versions%rowtype;
  new_spec public.channel_spec_versions%rowtype;
  manifest public.release_manifests%rowtype;
  approval public.channel_activation_approvals%rowtype;
begin
  select * into proposal from public.channel_change_proposals where id = new.proposal_id;
  select * into old_spec from public.channel_spec_versions where id = new.old_spec_version_id;
  select * into new_spec from public.channel_spec_versions where id = new.new_spec_version_id;
  select * into manifest from public.release_manifests where id = new.release_manifest_id;
  select * into approval from public.channel_activation_approvals
    where proposal_id = new.proposal_id;

  if proposal.id is null or old_spec.id is null or new_spec.id is null
      or manifest.id is null or approval.id is null then
    raise exception 'activation receipt references missing control-plane authority';
  end if;
  if proposal.activation_authorized is not false
      or proposal.approval_state <> 'approved'
      or approval.approved_by::text <> new.approved_by
      or approval.activation_boundary <> 'next-safe-entry'
      or approval.runtime_mutation_scope <> 'receipt-bound-new-entry-only'
      or approval.order_authority then
    raise exception 'activation receipt lacks exact immutable operator authority';
  end if;
  if proposal.base_spec_version_id <> old_spec.id
      or proposal.proposed_spec_version_id <> new_spec.id
      or proposal.base_spec_content_hash <> old_spec.content_hash then
    raise exception 'activation receipt does not match the approved proposal and exact base';
  end if;
  if old_spec.status <> 'active' or new_spec.status <> 'scheduled'
      or new_spec.parent_version_id <> old_spec.id then
    raise exception 'activation receipt requires active old spec and scheduled child spec';
  end if;
  if manifest.status <> 'scheduled' or not exists (
    select 1 from public.release_manifest_channels membership
    where membership.release_manifest_id = manifest.id
      and membership.channel_spec_version_id = new_spec.id
  ) then
    raise exception 'activation receipt requires a scheduled manifest containing the new spec';
  end if;
  if new.old_content_hash <> old_spec.content_hash
      or new.new_content_hash <> new_spec.content_hash
      or new.manifest_content_hash <> manifest.content_hash then
    raise exception 'activation receipt content hashes do not match referenced versions';
  end if;
  if new.validation_results <> proposal.validation_results
      or exists (
        select 1 from jsonb_array_elements(new.validation_results) result
        where result ->> 'state' <> 'pass'
      ) then
    raise exception 'activation receipt validation evidence is not exact and passing';
  end if;
  if new.worker_acknowledgement <> (
      select acknowledgement
      from public.channel_activation_worker_acknowledgements
      where id = approval.worker_acknowledgement_id
    ) then
    raise exception 'activation receipt worker acknowledgement is not exact';
  end if;
  if new.activated_at > pg_catalog.now() + interval '5 seconds'
      or new.activated_at < pg_catalog.now() - interval '5 minutes' then
    raise exception 'activation receipt timestamp is stale or future';
  end if;
  return new;
end;
$$;

create or replace function public.activate_channel_change_proposal(
  p_activation_receipt_id uuid,
  p_approval_id uuid,
  p_proposal_id uuid,
  p_preview_id uuid,
  p_worker_acknowledgement_id uuid,
  p_configuration_epoch_id text,
  p_operator_id uuid,
  p_approval_evidence_ref text,
  p_approved_at timestamptz,
  p_scheduled_for timestamptz,
  p_activated_at timestamptz,
  p_safe_boundary_proof jsonb,
  p_exact_diff jsonb,
  p_validator_versions jsonb
)
returns table (
  activation_receipt_id uuid,
  proposal_id uuid,
  release_manifest_id uuid,
  release_manifest_key text,
  configuration_epoch_id text,
  activated_at timestamptz,
  rollback_target_manifest_key text,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.channel_change_proposals%rowtype;
  preview public.channel_activation_previews%rowtype;
  acknowledgement public.channel_activation_worker_acknowledgements%rowtype;
  old_spec public.channel_spec_versions%rowtype;
  new_spec public.channel_spec_versions%rowtype;
  old_manifest public.release_manifests%rowtype;
  new_manifest public.release_manifests%rowtype;
  approval public.channel_activation_approvals%rowtype;
  receipt public.activation_receipts%rowtype;
  configured_account_ids jsonb;
  member text;
  member_spec public.channel_spec_versions%rowtype;
  ordinal integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_proposal_id::text, 0)
  );

  select * into receipt
  from public.activation_receipts as receipt_by_proposal
  where receipt_by_proposal.proposal_id = p_proposal_id;

  if receipt.id is not null then
    select * into new_manifest
    from public.release_manifests
    where id = receipt.release_manifest_id;
    select * into approval
    from public.channel_activation_approvals as approval_by_proposal
    where approval_by_proposal.proposal_id = p_proposal_id;
    if receipt.id <> p_activation_receipt_id
        or receipt.configuration_epoch_id <> p_configuration_epoch_id
        or receipt.approved_by <> p_operator_id::text
        or receipt.scheduled_for <> p_scheduled_for
        or receipt.activated_at <> p_activated_at
        or receipt.safe_boundary_proof <> p_safe_boundary_proof
        or receipt.exact_diff <> p_exact_diff
        or receipt.validator_versions <> p_validator_versions
        or approval.id is null
        or approval.id <> p_approval_id
        or approval.preview_id <> p_preview_id
        or approval.worker_acknowledgement_id
          <> p_worker_acknowledgement_id
        or approval.approved_by <> p_operator_id
        or approval.approval_evidence_ref <> btrim(p_approval_evidence_ref)
        or approval.approved_at <> p_approved_at then
      raise exception using errcode = '23505',
        message = 'activation idempotency conflict';
    end if;
    return query select
      receipt.id, receipt.proposal_id, receipt.release_manifest_id,
      new_manifest.manifest_key, receipt.configuration_epoch_id,
      receipt.activated_at, receipt.rollback_target_manifest_id, false;
    return;
  end if;

  select * into proposal
  from public.channel_change_proposals
  where id = p_proposal_id
  for update;

  select * into preview
  from public.channel_activation_previews as preview_by_id
  where preview_by_id.id = p_preview_id
    and preview_by_id.proposal_id = p_proposal_id;

  select * into acknowledgement
  from public.channel_activation_worker_acknowledgements
  where id = p_worker_acknowledgement_id
    and preview_id = p_preview_id;

  select * into old_spec
  from public.channel_spec_versions
  where id = proposal.base_spec_version_id
  for update;

  select * into new_spec
  from public.channel_spec_versions
  where id = proposal.proposed_spec_version_id
  for update;

  select * into old_manifest
  from public.release_manifests
  where id = preview.base_release_manifest_id
  for update;

  if proposal.id is null or preview.id is null or acknowledgement.id is null
      or old_spec.id is null or new_spec.id is null or old_manifest.id is null then
    raise exception using errcode = 'P0002',
      message = 'activation evidence is missing';
  end if;
  if proposal.approval_state <> 'validated'
      or proposal.activation_authorized is not false
      or old_spec.status <> 'active'
      or new_spec.status <> 'validated'
      or new_spec.parent_version_id <> old_spec.id
      or old_manifest.status <> 'active'
      or p_configuration_epoch_id <> preview.configuration_epoch_id then
    raise exception using errcode = '40001',
      message = 'activation base or lifecycle drifted';
  end if;
  if acknowledgement.acknowledged_at < p_activated_at - interval '60 seconds'
      or acknowledgement.acknowledged_at > p_activated_at + interval '5 seconds'
      or acknowledgement.candidate_manifest_hash <> preview.candidate_manifest_hash
      or acknowledgement.configuration_epoch_id <> p_configuration_epoch_id
      or acknowledgement.account_mode <> 'paper'
      or acknowledgement.posture <> 'staged-no-order-authority'
      or acknowledgement.runtime_mutation
      or acknowledgement.order_authority then
    raise exception 'activation worker acknowledgement is stale or incompatible';
  end if;
  if p_approval_evidence_ref is null
      or length(btrim(p_approval_evidence_ref)) = 0
      or p_approved_at > p_activated_at
      or p_approved_at < p_activated_at - interval '2 hours'
      or p_scheduled_for > p_activated_at
      or p_activated_at > pg_catalog.now() + interval '5 seconds'
      or p_activated_at < pg_catalog.now() - interval '5 minutes' then
    raise exception 'activation approval or schedule timestamps are invalid';
  end if;
  if jsonb_typeof(p_exact_diff) <> 'object'
      or p_exact_diff = '{}'::jsonb
      or jsonb_typeof(p_validator_versions) <> 'array'
      or not (
        p_validator_versions @> '[
          "channel-control-plane-compiler-v1",
          "channel-activation-protocol-v1"
        ]'::jsonb
      ) then
    raise exception 'activation diff or validator identity is incomplete';
  end if;
  if preview.validation_results <> proposal.validation_results
      or preview.replay_summary <> proposal.replay_summary
      or preview.capacity_collision_impact <> proposal.capacity_collision_impact
      or exists (
        select 1 from jsonb_array_elements(proposal.validation_results) result
        where result ->> 'state' <> 'pass'
      )
      or proposal.replay_summary ->> 'state' <> 'sufficient'
      or proposal.capacity_collision_impact ->> 'state' <> 'pass'
      or preview.capture_continuity ->> 'state' <> 'pass' then
    raise exception 'activation validation or capture evidence drifted';
  end if;

  if p_safe_boundary_proof ->> 'globalFlat' is distinct from 'true'
      or p_safe_boundary_proof ->> 'protocolVersion'
        is distinct from 'channel-activation-protocol-v1'
      or jsonb_typeof(p_safe_boundary_proof -> 'configuredPaperAccountIds') <> 'array'
      or jsonb_array_length(p_safe_boundary_proof -> 'configuredPaperAccountIds') = 0
      or jsonb_typeof(p_safe_boundary_proof -> 'brokerAccounts') <> 'array'
      or p_safe_boundary_proof #>> '{deskOpenPositions,state}' is distinct from 'observed'
      or p_safe_boundary_proof #>> '{deskOpenPositions,count}' is distinct from '0'
      or coalesce(p_safe_boundary_proof #>> '{deskOpenPositions,evidenceRef}', '') = ''
      or coalesce(p_safe_boundary_proof ->> 'observedAt', '') = ''
      or coalesce(p_safe_boundary_proof ->> 'accountInventoryEvidenceRef', '') = '' then
    raise exception 'activation safe-boundary proof is incomplete';
  end if;
  if (p_safe_boundary_proof ->> 'observedAt')::timestamptz
      < p_activated_at - interval '30 seconds'
      or (p_safe_boundary_proof ->> 'observedAt')::timestamptz
        > p_activated_at + interval '5 seconds' then
    raise exception 'activation safe-boundary proof is stale or future';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account
    where account #>> '{openPositions,state}' is distinct from 'observed'
      or account #>> '{openPositions,count}' is distinct from '0'
      or coalesce(account #>> '{openPositions,evidenceRef}', '') = ''
      or account #>> '{openOrders,state}' is distinct from 'observed'
      or account #>> '{openOrders,count}' is distinct from '0'
      or coalesce(account #>> '{openOrders,evidenceRef}', '') = ''
  ) then
    raise exception 'activation broker account is not proven flat and order-free';
  end if;

  select coalesce(jsonb_agg(account.id::text order by account.id::text), '[]'::jsonb)
  into configured_account_ids
  from public.accounts account
  where lower(account.mode) = 'paper';

  if configured_account_ids <> (
      select coalesce(jsonb_agg(account_id order by account_id), '[]'::jsonb)
      from jsonb_array_elements_text(
        p_safe_boundary_proof -> 'configuredPaperAccountIds'
      ) account_id
    )
      or jsonb_array_length(p_safe_boundary_proof -> 'brokerAccounts')
        <> jsonb_array_length(p_safe_boundary_proof -> 'configuredPaperAccountIds')
      or exists (
        (
          select jsonb_array_elements_text(
            p_safe_boundary_proof -> 'configuredPaperAccountIds'
          )
          except
          select account ->> 'accountId'
          from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account
        )
        union all
        (
          select account ->> 'accountId'
          from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account
          except
          select jsonb_array_elements_text(
            p_safe_boundary_proof -> 'configuredPaperAccountIds'
          )
        )
      )
      or exists (select 1 from public.positions where status = 'open') then
    raise exception 'activation did not prove every configured paper account and desk flat';
  end if;

  insert into public.channel_activation_approvals (
    id, proposal_id, preview_id, worker_acknowledgement_id,
    approved_by, approval_evidence_ref, approved_at, activation_boundary,
    runtime_mutation_scope, order_authority
  ) values (
    p_approval_id, proposal.id, preview.id, acknowledgement.id,
    p_operator_id, btrim(p_approval_evidence_ref), p_approved_at,
    'next-safe-entry', 'receipt-bound-new-entry-only', false
  )
  returning * into approval;

  update public.channel_change_proposals
  set approval_state = 'approved'
  where id = proposal.id;

  insert into public.release_manifests (
    manifest_key, release_id, cohort_id, worker_compatibility_version,
    legacy_configuration_hash, paper_live_authority,
    admission_policy_version, collision_policy_version,
    activation_boundary, admission_policies, rollback_target_manifest_id,
    parent_manifest_id, manifest_json, content_hash, created_by, created_at,
    valid_from, valid_until, status
  ) values (
    preview.candidate_manifest_key,
    preview.candidate_release_id,
    preview.candidate_manifest ->> 'cohortId',
    preview.candidate_manifest ->> 'workerCompatibilityVersion',
    preview.candidate_manifest ->> 'legacyConfigurationHash',
    'paper-only',
    preview.candidate_manifest ->> 'admissionPolicyVersion',
    preview.candidate_manifest ->> 'collisionPolicyVersion',
    'next-safe-entry',
    preview.candidate_manifest -> 'admissionPolicies',
    preview.candidate_manifest ->> 'rollbackTargetManifestId',
    old_manifest.id,
    preview.candidate_manifest,
    preview.candidate_manifest_hash,
    preview.candidate_manifest ->> 'createdBy',
    (preview.candidate_manifest ->> 'createdAt')::timestamptz,
    p_activated_at,
    null,
    'draft'
  )
  returning * into new_manifest;

  for member in
    select value
    from jsonb_array_elements_text(
      preview.candidate_manifest -> 'channelSpecVersionIds'
    ) with ordinality as members(value, ord)
    order by ord
  loop
    select * into member_spec
    from public.channel_spec_versions
    where version_key = member;

    if member_spec.id is null then
      raise exception 'activation candidate manifest references a missing spec';
    end if;
    insert into public.release_manifest_channels (
      release_manifest_id, channel_spec_version_id, ordinal
    ) values (
      new_manifest.id, member_spec.id, ordinal
    );
    ordinal := ordinal + 1;
  end loop;

  if ordinal <> jsonb_array_length(
      preview.candidate_manifest -> 'channelSpecContentHashes'
    )
      or exists (
        select 1
        from public.release_manifest_channels membership
        join public.channel_spec_versions spec
          on spec.id = membership.channel_spec_version_id
        where membership.release_manifest_id = new_manifest.id
          and spec.content_hash <> (
            preview.candidate_manifest -> 'channelSpecContentHashes'
          ) ->> membership.ordinal
      ) then
    raise exception 'activation candidate membership hashes disagree';
  end if;

  update public.release_manifests
  set status = 'validated'
  where id = new_manifest.id;

  update public.channel_spec_versions
  set status = 'scheduled'
  where id = new_spec.id;

  update public.release_manifests
  set status = 'scheduled'
  where id = new_manifest.id;

  insert into public.activation_receipts (
    id, configuration_epoch_id, proposal_id, old_spec_version_id,
    new_spec_version_id, release_manifest_id, exact_diff,
    validation_results, validator_versions, approved_by, scheduled_for,
    activated_at, safe_boundary_proof, worker_acknowledgement,
    rollback_target_manifest_id, old_content_hash, new_content_hash,
    manifest_content_hash
  ) values (
    p_activation_receipt_id, p_configuration_epoch_id, proposal.id,
    old_spec.id, new_spec.id, new_manifest.id, p_exact_diff,
    proposal.validation_results, p_validator_versions, p_operator_id::text,
    p_scheduled_for, p_activated_at, p_safe_boundary_proof,
    acknowledgement.acknowledgement, old_manifest.manifest_key,
    old_spec.content_hash, new_spec.content_hash, new_manifest.content_hash
  )
  returning * into receipt;

  update public.channel_spec_versions
  set status = 'superseded',
      valid_until = p_activated_at
  where id = old_spec.id;

  update public.channel_spec_versions
  set status = 'active'
  where id = new_spec.id;

  update public.release_manifests
  set status = 'superseded',
      valid_until = p_activated_at
  where id = old_manifest.id;

  update public.release_manifests
  set status = 'active'
  where id = new_manifest.id;

  return query select
    receipt.id, receipt.proposal_id, receipt.release_manifest_id,
    new_manifest.manifest_key, receipt.configuration_epoch_id,
    receipt.activated_at, receipt.rollback_target_manifest_id, false;
end;
$$;

alter table public.channel_activation_previews enable row level security;
alter table public.channel_activation_worker_acknowledgements enable row level security;
alter table public.channel_activation_approvals enable row level security;

revoke all on public.channel_activation_previews
  from public, anon, authenticated, service_role;
revoke all on public.channel_activation_worker_acknowledgements
  from public, anon, authenticated, service_role;
revoke all on public.channel_activation_approvals
  from public, anon, authenticated, service_role;

grant select, insert on public.channel_activation_previews to service_role;
grant select, insert on public.channel_activation_worker_acknowledgements to service_role;
grant select on public.channel_activation_approvals to service_role;
grant select on public.channel_activation_previews to authenticated;
grant select on public.channel_activation_worker_acknowledgements to authenticated;
grant select on public.channel_activation_approvals to authenticated;

create policy channel_activation_previews_operator_read
  on public.channel_activation_previews
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy channel_activation_worker_ack_operator_read
  on public.channel_activation_worker_acknowledgements
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create policy channel_activation_approvals_operator_read
  on public.channel_activation_approvals
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create trigger channel_activation_previews_insert_guard
  before insert on public.channel_activation_previews
  for each row execute function seve_control.enforce_channel_activation_preview_insert();

create trigger channel_activation_previews_append_only_guard
  before update or delete on public.channel_activation_previews
  for each row execute function seve_control.reject_channel_activation_evidence_mutation();

create trigger channel_activation_worker_ack_insert_guard
  before insert on public.channel_activation_worker_acknowledgements
  for each row execute function seve_control.enforce_channel_activation_worker_ack_insert();

create trigger channel_activation_worker_ack_append_only_guard
  before update or delete on public.channel_activation_worker_acknowledgements
  for each row execute function seve_control.reject_channel_activation_evidence_mutation();

create trigger channel_activation_approvals_append_only_guard
  before update or delete on public.channel_activation_approvals
  for each row execute function seve_control.reject_channel_activation_evidence_mutation();

create trigger channel_activation_approvals_insert_guard
  before insert on public.channel_activation_approvals
  for each row execute function seve_control.enforce_channel_activation_approval_insert();

revoke all on function seve_control.reject_channel_activation_evidence_mutation()
  from public, anon, authenticated;
revoke all on function seve_control.enforce_channel_activation_preview_insert()
  from public, anon, authenticated;
revoke all on function seve_control.enforce_channel_activation_worker_ack_insert()
  from public, anon, authenticated;
revoke all on function seve_control.enforce_channel_activation_approval_insert()
  from public, anon, authenticated;
revoke all on function public.prepare_channel_change_proposal_preview(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.acknowledge_channel_change_proposal_preview(
  uuid, uuid, uuid, text, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.activate_channel_change_proposal(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz,
  timestamptz, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function seve_control.reject_channel_activation_evidence_mutation()
  to service_role;
grant execute on function seve_control.enforce_channel_activation_preview_insert()
  to service_role;
grant execute on function seve_control.enforce_channel_activation_worker_ack_insert()
  to service_role;
grant execute on function seve_control.enforce_channel_activation_approval_insert()
  to service_role;
grant execute on function public.prepare_channel_change_proposal_preview(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  uuid, timestamptz
) to service_role;
grant execute on function public.acknowledge_channel_change_proposal_preview(
  uuid, uuid, uuid, text, timestamptz, text, jsonb
) to service_role;
grant execute on function public.activate_channel_change_proposal(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz,
  timestamptz, jsonb, jsonb, jsonb
) to service_role;

comment on table public.channel_activation_previews is
  'Immutable validated proposal projections. Preview rows are not runtime authority.';
comment on table public.channel_activation_worker_acknowledgements is
  'Immutable current-worker proof that one exact candidate can be staged without order authority.';
comment on table public.channel_activation_approvals is
  'Immutable operator authority for one exact receipt-bound next-safe-entry transition; never order authority.';
comment on function public.prepare_channel_change_proposal_preview(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
  uuid, timestamptz
) is
  'Service-role-only, idempotent validation and immutable preview persistence. No activation.';
comment on function public.acknowledge_channel_change_proposal_preview(
  uuid, uuid, uuid, text, timestamptz, text, jsonb
) is
  'Service-role-only, idempotent candidate acknowledgement by a current worker. No activation or order authority.';
comment on function public.activate_channel_change_proposal(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz,
  timestamptz, jsonb, jsonb, jsonb
) is
  'Service-role-only, atomic normal proposal activation at a fresh all-paper-account flat/order-free boundary.';

commit;
