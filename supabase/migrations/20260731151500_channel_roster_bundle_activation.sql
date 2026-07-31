-- Atomic paper-only roster-bundle activation evidence and apply transaction.
-- Installing this migration creates no acknowledgement, approval, receipt,
-- manifest, spec, runtime change, route change, position mutation, or order.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.channel_roster_bundle_worker_acknowledgements (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  bundle_id                   uuid not null references public.channel_roster_bundles(id),
  validated_lifecycle_receipt_id uuid not null unique
                                references public.channel_roster_bundle_lifecycle_receipts(id),
  base_manifest_key           text not null,
  base_manifest_content_hash  text not null check (
                                base_manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  candidate_manifest_key      text not null,
  candidate_manifest_content_hash text not null check (
                                candidate_manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  configuration_epoch_id      text not null check (
                                configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                              ),
  worker_compatibility_version text not null,
  worker_runtime_version      text not null,
  source_boot_id              uuid not null,
  posture                     text not null check (
                                posture = 'staged-no-order-authority'
                              ),
  account_mode                text not null check (account_mode = 'paper'),
  acknowledgement             jsonb not null check (
                                jsonb_typeof(acknowledgement) = 'object'
                              ),
  evidence_ref                text not null check (length(btrim(evidence_ref)) between 1 and 500),
  acknowledged_at             timestamptz not null,
  runtime_mutation            boolean not null default false check (not runtime_mutation),
  order_authority             boolean not null default false check (not order_authority),
  created_at                  timestamptz not null default now()
);

create index channel_roster_bundle_ack_bundle_idx
  on public.channel_roster_bundle_worker_acknowledgements
  (bundle_id, acknowledged_at desc, created_at desc);

create table public.channel_roster_bundle_approvals (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  bundle_id                   uuid not null unique references public.channel_roster_bundles(id),
  worker_acknowledgement_id   uuid not null unique
                                references public.channel_roster_bundle_worker_acknowledgements(id),
  approved_by                 uuid not null,
  approval_evidence_ref       text not null check (
                                length(btrim(approval_evidence_ref)) between 1 and 500
                              ),
  approved_at                 timestamptz not null,
  activation_boundary         text not null check (
                                activation_boundary = 'next-safe-entry'
                              ),
  runtime_mutation_scope      text not null check (
                                runtime_mutation_scope = 'receipt-bound-new-entry-only'
                              ),
  order_authority             boolean not null default false check (not order_authority),
  created_at                  timestamptz not null default now()
);

create table public.channel_roster_bundle_activation_receipts (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  bundle_id                   uuid not null unique references public.channel_roster_bundles(id),
  approval_id                 uuid not null unique references public.channel_roster_bundle_approvals(id),
  worker_acknowledgement_id   uuid not null unique
                                references public.channel_roster_bundle_worker_acknowledgements(id),
  configuration_epoch_id      text not null unique check (
                                configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                              ),
  prior_release_manifest_id   uuid not null references public.release_manifests(id),
  release_manifest_id         uuid not null unique references public.release_manifests(id),
  prior_manifest_key          text not null,
  prior_manifest_content_hash text not null check (
                                prior_manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  candidate_manifest_key      text not null,
  candidate_manifest_content_hash text not null check (
                                candidate_manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  rollback_target_manifest_key text not null,
  exact_diffs                 jsonb not null check (
                                jsonb_typeof(exact_diffs) = 'array'
                                and jsonb_array_length(exact_diffs) > 0
                              ),
  capacity_evaluation         jsonb not null check (
                                jsonb_typeof(capacity_evaluation) = 'object'
                                and capacity_evaluation ->> 'state' = 'pass'
                              ),
  safe_boundary_proof         jsonb not null check (
                                jsonb_typeof(safe_boundary_proof) = 'object'
                              ),
  worker_acknowledgement      jsonb not null check (
                                jsonb_typeof(worker_acknowledgement) = 'object'
                              ),
  activated_by                uuid not null,
  activated_at                timestamptz not null,
  activation_scope            text not null check (
                                activation_scope = 'prospective-new-entry-only'
                              ),
  open_position_policy_preservation text not null check (
                                open_position_policy_preservation = 'entry-epoch-immutable'
                              ),
  historical_evidence_mutation boolean not null default false
                                check (not historical_evidence_mutation),
  order_authority             boolean not null default false check (not order_authority),
  created_at                  timestamptz not null default now()
);

create table public.channel_roster_bundle_activation_specs (
  activation_receipt_id       uuid not null
                                references public.channel_roster_bundle_activation_receipts(id),
  channel_id                  uuid not null references public.strategists(id),
  channel_slug                text not null,
  old_spec_version_id         uuid null references public.channel_spec_versions(id),
  new_spec_version_id         uuid not null unique references public.channel_spec_versions(id),
  old_content_hash            text null check (
                                old_content_hash is null
                                or old_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  new_content_hash            text not null check (
                                new_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  created_at                  timestamptz not null default now(),
  primary key (activation_receipt_id, new_spec_version_id),
  check (
    (old_spec_version_id is null and old_content_hash is null)
    or (old_spec_version_id is not null and old_content_hash is not null)
  )
);

create table public.channel_roster_bundle_activation_removals (
  activation_receipt_id       uuid not null
                                references public.channel_roster_bundle_activation_receipts(id),
  channel_id                  uuid not null references public.strategists(id),
  channel_slug                text not null,
  old_spec_version_id         uuid not null unique references public.channel_spec_versions(id),
  old_content_hash            text not null check (
                                old_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  collection_preserved        boolean not null default true check (collection_preserved),
  created_at                  timestamptz not null default now(),
  primary key (activation_receipt_id, old_spec_version_id)
);

alter table public.channel_roster_bundles
  add column rollback_context jsonb null check (
    rollback_context is null or (
      jsonb_typeof(rollback_context) = 'object'
      and rollback_context ->> 'rollbackOfActivationReceiptId' is not null
      and rollback_context ->> 'exactTargetManifestId' is not null
      and rollback_context ->> 'exactTargetManifestContentHash'
        ~ '^sha256:[0-9a-f]{64}$'
    )
  );

create trigger channel_roster_bundle_ack_append_only
before update or delete on public.channel_roster_bundle_worker_acknowledgements
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundle_approvals_append_only
before update or delete on public.channel_roster_bundle_approvals
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundle_activation_receipts_append_only
before update or delete on public.channel_roster_bundle_activation_receipts
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundle_activation_specs_append_only
before update or delete on public.channel_roster_bundle_activation_specs
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundle_activation_removals_append_only
before update or delete on public.channel_roster_bundle_activation_removals
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

-- Exact rollback creates a new immutable version key with the prior semantic
-- hash. Equality is evidence of restoration, not an identity collision.
alter table public.channel_spec_versions
  drop constraint channel_spec_versions_content_hash_key;
alter table public.channel_spec_versions
  drop constraint channel_spec_versions_channel_id_content_hash_key;
create index channel_spec_versions_content_hash_idx
  on public.channel_spec_versions (content_hash);
create index channel_spec_versions_channel_content_hash_idx
  on public.channel_spec_versions (channel_id, content_hash);

create or replace function public.create_channel_roster_rollback_draft(
  p_bundle_id uuid,
  p_initial_receipt_id uuid,
  p_rollback_activation_receipt_id uuid,
  p_base_manifest_key text,
  p_base_manifest_content_hash text,
  p_target_manifest_key text,
  p_target_manifest_content_hash text,
  p_registry_content_hash text,
  p_registry_entries jsonb,
  p_changes jsonb,
  p_candidate_manifest jsonb,
  p_candidate_specs jsonb,
  p_worker_projection jsonb,
  p_dashboard_projection jsonb,
  p_exact_diffs jsonb,
  p_validation_results jsonb,
  p_capacity_evaluation jsonb,
  p_configuration_epoch_id text,
  p_reason text,
  p_evidence_refs jsonb,
  p_operator_id uuid,
  p_created_at timestamptz
)
returns table (
  bundle_id uuid,
  lifecycle_receipt_id uuid,
  state text,
  configuration_epoch_id text,
  runtime_mutation_authorized boolean,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_receipt public.channel_roster_bundle_activation_receipts%rowtype;
  base_manifest public.release_manifests%rowtype;
  target_manifest public.release_manifests%rowtype;
  existing public.channel_roster_bundles%rowtype;
  rollback_value jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bundle_id::text, 0)
  );
  rollback_value := jsonb_build_object(
    'rollbackOfActivationReceiptId', p_rollback_activation_receipt_id,
    'exactTargetManifestId', p_target_manifest_key,
    'exactTargetManifestContentHash', p_target_manifest_content_hash
  );
  select * into existing from public.channel_roster_bundles
  where id = p_bundle_id;
  if existing.id is not null then
    if existing.base_manifest_key <> p_base_manifest_key
        or existing.base_manifest_content_hash <> p_base_manifest_content_hash
        or existing.registry_content_hash <> p_registry_content_hash
        or existing.registry_entries <> p_registry_entries
        or existing.changes <> p_changes
        or existing.candidate_manifest <> p_candidate_manifest
        or existing.candidate_specs <> p_candidate_specs
        or existing.worker_projection <> p_worker_projection
        or existing.dashboard_projection <> p_dashboard_projection
        or existing.exact_diffs <> p_exact_diffs
        or existing.validation_results <> p_validation_results
        or existing.capacity_evaluation <> p_capacity_evaluation
        or existing.configuration_epoch_id <> p_configuration_epoch_id
        or existing.reason <> btrim(p_reason)
        or existing.evidence_refs <> p_evidence_refs
        or existing.operator_id <> p_operator_id
        or existing.created_at <> p_created_at
        or existing.rollback_context <> rollback_value
        or not exists (
          select 1 from public.channel_roster_bundle_lifecycle_receipts lifecycle
          where lifecycle.id = p_initial_receipt_id
            and lifecycle.bundle_id = existing.id
            and lifecycle.prior_receipt_id is null
            and lifecycle.state = 'draft'
        ) then
      raise exception using errcode = '23505', message = 'roster rollback idempotency conflict';
    end if;
    return query select existing.id, p_initial_receipt_id, 'draft'::text,
      existing.configuration_epoch_id, false, false;
    return;
  end if;
  select * into source_receipt
  from public.channel_roster_bundle_activation_receipts receipt
  where receipt.id = p_rollback_activation_receipt_id;
  select * into base_manifest from public.release_manifests
  where manifest_key = p_base_manifest_key for update;
  select * into target_manifest from public.release_manifests
  where manifest_key = p_target_manifest_key;
  if source_receipt.id is null or base_manifest.id is null
      or target_manifest.id is null
      or source_receipt.release_manifest_id <> base_manifest.id
      or source_receipt.prior_release_manifest_id <> target_manifest.id
      or source_receipt.prior_manifest_key <> target_manifest.manifest_key
      or base_manifest.status <> 'active'
      or base_manifest.content_hash <> p_base_manifest_content_hash
      or target_manifest.content_hash <> p_target_manifest_content_hash then
    raise exception using errcode = '40001', message = 'rollback source, active base, or exact target drifted';
  end if;
  if p_created_at < pg_catalog.now() - interval '5 minutes'
      or p_created_at > pg_catalog.now() + interval '1 minute'
      or length(btrim(p_reason)) not between 8 and 2000
      or jsonb_typeof(p_evidence_refs) <> 'array'
      or jsonb_array_length(p_evidence_refs) not between 1 and 64
      or jsonb_typeof(p_changes) <> 'array'
      or jsonb_array_length(p_changes) = 0
      or jsonb_typeof(p_exact_diffs) <> 'array'
      or jsonb_array_length(p_exact_diffs) = 0
      or jsonb_typeof(p_candidate_specs) <> 'array'
      or jsonb_array_length(p_candidate_specs) = 0 then
    raise exception 'rollback request metadata or diff is incomplete';
  end if;
  if p_candidate_manifest ->> 'parentManifestId' <> base_manifest.manifest_key
      or p_candidate_manifest ->> 'rollbackTargetManifestId'
        <> base_manifest.manifest_key
      or p_candidate_manifest ->> 'paperLiveAuthority' <> 'paper-only'
      or p_candidate_manifest ->> 'activationBoundary' <> 'next-safe-entry'
      or p_candidate_manifest ->> 'status' <> 'draft'
      or p_candidate_manifest -> 'admissionPolicies'
        <> target_manifest.admission_policies
      or p_candidate_manifest ->> 'contentHash'
        <> p_worker_projection ->> 'manifestContentHash'
      or p_candidate_manifest ->> 'contentHash'
        <> p_dashboard_projection ->> 'manifestContentHash'
      or p_worker_projection ->> 'activationAuthorized' <> 'false'
      or p_dashboard_projection ->> 'activationAuthorized' <> 'false' then
    raise exception 'rollback manifest or projections are not exact and authority-dark';
  end if;
  if jsonb_array_length(p_candidate_specs) <> (
      select count(*) from public.release_manifest_channels membership
      where membership.release_manifest_id = target_manifest.id
    )
      or exists (
        select 1
        from public.release_manifest_channels target_membership
        join public.channel_spec_versions target_spec
          on target_spec.id = target_membership.channel_spec_version_id
        where target_membership.release_manifest_id = target_manifest.id
          and not exists (
            select 1 from jsonb_array_elements(p_candidate_specs) candidate
            where candidate ->> 'channelId' = target_spec.channel_id::text
              and candidate ->> 'slug' = target_spec.channel_slug
              and candidate ->> 'contentHash' = target_spec.content_hash
              and candidate ->> 'accountMode' = 'paper'
          )
      )
      or p_candidate_manifest -> 'channelSpecVersionIds' <> (
        select jsonb_agg(candidate ->> 'id' order by ordinal)
        from jsonb_array_elements(p_candidate_specs)
          with ordinality as specs(candidate, ordinal)
      )
      or p_candidate_manifest -> 'channelSpecContentHashes' <> (
        select jsonb_agg(candidate ->> 'contentHash' order by ordinal)
        from jsonb_array_elements(p_candidate_specs)
          with ordinality as specs(candidate, ordinal)
      ) then
    raise exception 'rollback candidate does not restore exact target semantics';
  end if;
  if jsonb_typeof(p_validation_results) <> 'array'
      or jsonb_array_length(p_validation_results) = 0
      or exists (
        select 1 from jsonb_array_elements(p_validation_results) result
        where result ->> 'state' <> 'pass'
      )
      or p_capacity_evaluation ->> 'state' <> 'pass'
      or p_capacity_evaluation ->> 'executionAuthority' <> 'false'
      or p_capacity_evaluation ->> 'runtimeMutationAuthorized' <> 'false'
      or p_capacity_evaluation ->> 'orderAuthority' <> 'false' then
    raise exception 'rollback validation or portfolio capacity is not passing';
  end if;
  if jsonb_typeof(p_registry_entries) <> 'array'
      or jsonb_array_length(p_registry_entries) <> (
        select count(*) from public.research_channel_registration_current
      )
      or exists (
        select 1 from jsonb_array_elements(p_registry_entries) supplied
        left join public.research_channel_registration_current registration
          on registration.registration_key = supplied ->> 'registrationKey'
          and registration.content_hash = supplied ->> 'contentHash'
          and registration.state = supplied ->> 'state'
        where registration.id is null
      ) then
    raise exception 'rollback registry snapshot is stale or invalid';
  end if;
  insert into public.channel_roster_bundles (
    id, base_release_manifest_id, base_manifest_key,
    base_manifest_content_hash, registry_content_hash, registry_entries,
    changes, candidate_manifest, candidate_specs, worker_projection,
    dashboard_projection, exact_diffs, validation_results,
    capacity_evaluation, configuration_epoch_id, reason, evidence_refs,
    operator_id, created_at, rollback_context
  ) values (
    p_bundle_id, base_manifest.id, base_manifest.manifest_key,
    base_manifest.content_hash, p_registry_content_hash, p_registry_entries,
    p_changes, p_candidate_manifest, p_candidate_specs, p_worker_projection,
    p_dashboard_projection, p_exact_diffs, p_validation_results,
    p_capacity_evaluation, p_configuration_epoch_id, btrim(p_reason),
    p_evidence_refs, p_operator_id, p_created_at, rollback_value
  );
  insert into public.channel_roster_bundle_lifecycle_receipts (
    id, bundle_id, prior_receipt_id, state, successor_bundle_id,
    reason, evidence_refs, operator_id, effective_at
  ) values (
    p_initial_receipt_id, p_bundle_id, null, 'draft', null,
    btrim(p_reason), p_evidence_refs, p_operator_id, p_created_at
  );
  return query select p_bundle_id, p_initial_receipt_id, 'draft'::text,
    p_configuration_epoch_id, false, false;
end;
$$;

-- Preserve the original lifecycle contract and add only the bundle receipt
-- alternative for scheduled -> active transitions.
create or replace function seve_control.enforce_version_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are append-only', tg_table_name;
  end if;
  if (to_jsonb(new) - 'status' - 'valid_from' - 'valid_until')
      is distinct from (to_jsonb(old) - 'status' - 'valid_from' - 'valid_until') then
    raise exception '% semantic content is immutable; insert a new version', tg_table_name;
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('validated', 'rejected'))
    or (old.status = 'validated' and new.status in ('scheduled', 'rejected'))
    or (old.status = 'scheduled' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status in ('superseded', 'rolled_back'))
  ) then
    raise exception 'invalid % lifecycle transition: % -> %', tg_table_name, old.status, new.status;
  end if;
  if old.status = 'scheduled' and new.status = 'active' then
    if tg_table_name = 'channel_spec_versions' then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('seve:paper-collection-activation', 0)
      );
      if coalesce(new.execution_posture, 'paper') = 'paper'
          and not exists (
            select 1
            from public.channel_collection_state_current collection
            where collection.channel_id = new.channel_id
              and collection.state = 'active'
          ) then
        raise exception 'paper channel activation requires active collection';
      end if;
    end if;
    if tg_table_name = 'channel_spec_versions'
        and not exists (
          select 1 from public.activation_receipts receipt
          where receipt.new_spec_version_id = new.id
            and receipt.activated_at <= pg_catalog.now()
        )
        and not exists (
          select 1
          from public.control_plane_adoption_receipts adoption
          join public.release_manifest_channels membership
            on membership.release_manifest_id = adoption.release_manifest_id
          where membership.channel_spec_version_id = new.id
            and adoption.adopted_at <= pg_catalog.now()
        )
        and not exists (
          select 1
          from public.channel_roster_bundle_activation_specs bundle_spec
          join public.channel_roster_bundle_activation_receipts receipt
            on receipt.id = bundle_spec.activation_receipt_id
          where bundle_spec.new_spec_version_id = new.id
            and receipt.activated_at <= pg_catalog.now()
        ) then
      raise exception 'channel spec activation requires an activation receipt';
    end if;
    if tg_table_name = 'release_manifests'
        and not exists (
          select 1 from public.activation_receipts receipt
          where receipt.release_manifest_id = new.id
            and receipt.activated_at <= pg_catalog.now()
        )
        and not exists (
          select 1 from public.control_plane_adoption_receipts adoption
          where adoption.release_manifest_id = new.id
            and adoption.adopted_at <= pg_catalog.now()
        )
        and not exists (
          select 1 from public.channel_roster_bundle_activation_receipts receipt
          where receipt.release_manifest_id = new.id
            and receipt.activated_at <= pg_catalog.now()
        ) then
      raise exception 'release manifest activation requires an activation receipt';
    end if;
  end if;
  if new.valid_until is distinct from old.valid_until
      and new.status not in ('superseded', 'rolled_back') then
    raise exception '% valid_until requires a terminal active lifecycle state', tg_table_name;
  end if;
  if new.valid_from is distinct from old.valid_from
      and (old.valid_from is not null or new.valid_from is null
           or new.status not in ('scheduled', 'active')) then
    raise exception '% valid_from may be assigned once at scheduling/activation', tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function seve_control.serialize_collection_against_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('seve:paper-collection-activation', 0)
  );
  if new.state <> 'active' and exists (
    select 1
    from public.release_manifests manifest
    join public.release_manifest_channels membership
      on membership.release_manifest_id = manifest.id
    join public.channel_spec_versions spec
      on spec.id = membership.channel_spec_version_id
    where manifest.status = 'active'
      and spec.channel_id = new.channel_id
      and coalesce(spec.execution_posture, 'paper') = 'paper'
  ) then
    raise exception 'executing paper channel collection must remain active';
  end if;
  return new;
end;
$$;

create trigger channel_collection_receipts_activation_serialization
  before insert on public.channel_collection_state_receipts
  for each row execute function
    seve_control.serialize_collection_against_activation();

create or replace function public.acknowledge_channel_roster_bundle(
  p_acknowledgement_id uuid,
  p_validated_lifecycle_receipt_id uuid,
  p_bundle_id uuid,
  p_source_boot_id uuid,
  p_worker_runtime_version text,
  p_acknowledged_at timestamptz,
  p_evidence_ref text,
  p_acknowledgement jsonb
)
returns table (
  acknowledgement_id uuid,
  bundle_id uuid,
  lifecycle_receipt_id uuid,
  state text,
  configuration_epoch_id text,
  runtime_mutation boolean,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bundle public.channel_roster_bundles%rowtype;
  current_receipt public.channel_roster_bundle_lifecycle_receipts%rowtype;
  existing public.channel_roster_bundle_worker_acknowledgements%rowtype;
  effective_lifecycle_receipt_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bundle_id::text, 0)
  );
  select * into existing
  from public.channel_roster_bundle_worker_acknowledgements acknowledgement
  where acknowledgement.id = p_acknowledgement_id;
  if existing.id is not null then
    if existing.bundle_id <> p_bundle_id
        or existing.validated_lifecycle_receipt_id <> p_validated_lifecycle_receipt_id
        or existing.source_boot_id <> p_source_boot_id
        or existing.worker_runtime_version <> btrim(p_worker_runtime_version)
        or existing.acknowledged_at <> p_acknowledged_at
        or existing.evidence_ref <> btrim(p_evidence_ref)
        or existing.acknowledgement <> p_acknowledgement then
      raise exception using errcode = '23505', message = 'roster acknowledgement idempotency conflict';
    end if;
    return query select existing.id, existing.bundle_id,
      existing.validated_lifecycle_receipt_id, 'validated'::text,
      existing.configuration_epoch_id, false, false;
    return;
  end if;
  select * into bundle from public.channel_roster_bundles where id = p_bundle_id;
  select lifecycle.* into current_receipt
  from public.channel_roster_bundle_lifecycle_receipts lifecycle
  where lifecycle.bundle_id = p_bundle_id
  order by lifecycle.effective_at desc, lifecycle.created_at desc, lifecycle.id desc
  limit 1 for update;
  if bundle.id is null or current_receipt.id is null
      or current_receipt.state not in ('draft', 'validated')
      or bundle.candidate_manifest ->> 'contentHash'
        <> p_acknowledgement ->> 'candidateManifestContentHash'
      or bundle.candidate_manifest ->> 'id'
        <> p_acknowledgement ->> 'candidateManifestId'
      or bundle.base_manifest_key <> p_acknowledgement ->> 'baseManifestId'
      or bundle.base_manifest_content_hash
        <> p_acknowledgement ->> 'baseManifestContentHash'
      or bundle.configuration_epoch_id
        <> p_acknowledgement ->> 'configurationEpochId'
      or bundle.candidate_manifest ->> 'workerCompatibilityVersion'
        <> p_acknowledgement ->> 'workerCompatibilityVersion'
      or p_acknowledgement ->> 'bundleId' <> p_bundle_id::text
      or p_acknowledgement ->> 'bootId' <> p_source_boot_id::text
      or p_acknowledgement ->> 'workerRuntimeVersion' <> btrim(p_worker_runtime_version)
      or p_acknowledgement ->> 'posture' <> 'staged-no-order-authority'
      or p_acknowledgement ->> 'accountMode' <> 'paper'
      or p_acknowledgement ->> 'runtimeMutation' <> 'false'
      or p_acknowledgement ->> 'orderAuthority' <> 'false'
      or length(btrim(p_evidence_ref)) not between 1 and 500
      or p_acknowledged_at < pg_catalog.now() - interval '60 seconds'
      or p_acknowledged_at > pg_catalog.now() + interval '5 seconds' then
    raise exception 'roster worker acknowledgement is invalid or drifted';
  end if;
  if current_receipt.state = 'draft' then
    insert into public.channel_roster_bundle_lifecycle_receipts (
      id, bundle_id, prior_receipt_id, state, successor_bundle_id,
      reason, evidence_refs, operator_id, effective_at
    ) values (
      p_validated_lifecycle_receipt_id, p_bundle_id, current_receipt.id,
      'validated', null, 'Worker staged exact roster bundle candidate.',
      jsonb_build_array(btrim(p_evidence_ref)), current_receipt.operator_id,
      p_acknowledged_at
    );
    effective_lifecycle_receipt_id := p_validated_lifecycle_receipt_id;
  else
    if p_validated_lifecycle_receipt_id <> current_receipt.id then
      raise exception 'roster acknowledgement lifecycle receipt drifted';
    end if;
    effective_lifecycle_receipt_id := current_receipt.id;
  end if;
  insert into public.channel_roster_bundle_worker_acknowledgements (
    id, bundle_id, validated_lifecycle_receipt_id, base_manifest_key,
    base_manifest_content_hash, candidate_manifest_key,
    candidate_manifest_content_hash, configuration_epoch_id,
    worker_compatibility_version, worker_runtime_version, source_boot_id,
    posture, account_mode, acknowledgement, evidence_ref, acknowledged_at
  ) values (
    p_acknowledgement_id, bundle.id, effective_lifecycle_receipt_id,
    bundle.base_manifest_key, bundle.base_manifest_content_hash,
    bundle.candidate_manifest ->> 'id',
    bundle.candidate_manifest ->> 'contentHash', bundle.configuration_epoch_id,
    bundle.candidate_manifest ->> 'workerCompatibilityVersion',
    btrim(p_worker_runtime_version), p_source_boot_id,
    'staged-no-order-authority', 'paper', p_acknowledgement,
    btrim(p_evidence_ref), p_acknowledged_at
  );
  return query select p_acknowledgement_id, p_bundle_id,
    effective_lifecycle_receipt_id, 'validated'::text,
    bundle.configuration_epoch_id, false, false;
end;
$$;

create or replace function public.activate_channel_roster_bundle(
  p_activation_receipt_id uuid,
  p_approval_id uuid,
  p_approved_lifecycle_receipt_id uuid,
  p_bundle_id uuid,
  p_worker_acknowledgement_id uuid,
  p_operator_id uuid,
  p_approval_evidence_ref text,
  p_approved_at timestamptz,
  p_activated_at timestamptz,
  p_safe_boundary_proof jsonb
)
returns table (
  activation_receipt_id uuid,
  bundle_id uuid,
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
  bundle public.channel_roster_bundles%rowtype;
  acknowledgement public.channel_roster_bundle_worker_acknowledgements%rowtype;
  current_receipt public.channel_roster_bundle_lifecycle_receipts%rowtype;
  base_manifest public.release_manifests%rowtype;
  new_manifest public.release_manifests%rowtype;
  member_spec public.channel_spec_versions%rowtype;
  parent_spec public.channel_spec_versions%rowtype;
  existing_receipt public.channel_roster_bundle_activation_receipts%rowtype;
  existing_approval public.channel_roster_bundle_approvals%rowtype;
  configured_account_ids jsonb;
  spec jsonb;
  ordinal integer := 0;
  parent_from_rollback boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bundle_id::text, 0)
  );
  select * into existing_receipt
  from public.channel_roster_bundle_activation_receipts receipt
  where receipt.bundle_id = p_bundle_id;
  if existing_receipt.id is not null then
    select * into existing_approval
    from public.channel_roster_bundle_approvals approval
    where approval.id = existing_receipt.approval_id;
    if existing_receipt.id <> p_activation_receipt_id
        or existing_receipt.approval_id <> p_approval_id
        or existing_receipt.worker_acknowledgement_id <> p_worker_acknowledgement_id
        or existing_receipt.activated_by <> p_operator_id
        or existing_receipt.activated_at <> p_activated_at
        or existing_receipt.safe_boundary_proof <> p_safe_boundary_proof
        or existing_approval.id <> p_approval_id
        or existing_approval.approval_evidence_ref
          <> btrim(p_approval_evidence_ref)
        or existing_approval.approved_at <> p_approved_at
        or not exists (
          select 1
          from public.channel_roster_bundle_lifecycle_receipts lifecycle
          where lifecycle.id = p_approved_lifecycle_receipt_id
            and lifecycle.bundle_id = p_bundle_id
            and lifecycle.state = case
              when exists (
                select 1 from public.channel_roster_bundles replay_bundle
                where replay_bundle.id = p_bundle_id
                  and replay_bundle.rollback_context is not null
              ) then 'rolled-back'
              else 'approved'
            end
        ) then
      raise exception using errcode = '23505', message = 'roster activation idempotency conflict';
    end if;
    select * into new_manifest from public.release_manifests
    where id = existing_receipt.release_manifest_id;
    return query select existing_receipt.id, existing_receipt.bundle_id,
      existing_receipt.release_manifest_id, new_manifest.manifest_key,
      existing_receipt.configuration_epoch_id, existing_receipt.activated_at,
      existing_receipt.rollback_target_manifest_key, false;
    return;
  end if;
  select * into bundle from public.channel_roster_bundles where id = p_bundle_id;
  select * into acknowledgement
  from public.channel_roster_bundle_worker_acknowledgements acknowledgement_row
  where acknowledgement_row.id = p_worker_acknowledgement_id
    and acknowledgement_row.bundle_id = p_bundle_id;
  select lifecycle.* into current_receipt
  from public.channel_roster_bundle_lifecycle_receipts lifecycle
  where lifecycle.bundle_id = p_bundle_id
  order by lifecycle.effective_at desc, lifecycle.created_at desc, lifecycle.id desc
  limit 1 for update;
  select * into base_manifest from public.release_manifests
  where manifest_key = bundle.base_manifest_key for update;
  if bundle.id is null or acknowledgement.id is null
      or current_receipt.id is null or current_receipt.state <> 'validated'
      or base_manifest.id is null or base_manifest.status <> 'active'
      or base_manifest.content_hash <> bundle.base_manifest_content_hash
      or bundle.candidate_manifest ->> 'parentManifestId'
        <> base_manifest.manifest_key
      or bundle.candidate_manifest ->> 'rollbackTargetManifestId'
        <> base_manifest.manifest_key
      or (bundle.rollback_context is not null and not exists (
        select 1
        from public.channel_roster_bundle_activation_receipts rollback_source
        join public.release_manifests rollback_target
          on rollback_target.id = rollback_source.prior_release_manifest_id
        where rollback_source.id = (
            bundle.rollback_context ->> 'rollbackOfActivationReceiptId'
          )::uuid
          and rollback_source.release_manifest_id = base_manifest.id
          and rollback_target.manifest_key
            = bundle.rollback_context ->> 'exactTargetManifestId'
          and rollback_target.content_hash
            = bundle.rollback_context ->> 'exactTargetManifestContentHash'
      ))
      or acknowledgement.configuration_epoch_id <> bundle.configuration_epoch_id
      or acknowledgement.candidate_manifest_content_hash
        <> bundle.candidate_manifest ->> 'contentHash'
      or acknowledgement.acknowledged_at < p_activated_at - interval '5 minutes'
      or acknowledgement.acknowledged_at > p_activated_at + interval '5 seconds'
      or length(btrim(p_approval_evidence_ref)) not between 1 and 500
      or p_approved_at < acknowledgement.acknowledged_at
      or p_approved_at > p_activated_at
      or p_approved_at < p_activated_at - interval '2 hours'
      or p_activated_at > pg_catalog.now()
      or p_activated_at < pg_catalog.now() - interval '5 minutes' then
    raise exception using errcode = '40001', message = 'roster activation evidence or base drifted';
  end if;
  if bundle.capacity_evaluation ->> 'state' <> 'pass'
      or bundle.capacity_evaluation ->> 'executionAuthority' <> 'false'
      or bundle.capacity_evaluation ->> 'runtimeMutationAuthorized' <> 'false'
      or bundle.capacity_evaluation ->> 'orderAuthority' <> 'false'
      or exists (
        select 1 from jsonb_array_elements(bundle.validation_results) result
        where result ->> 'state' <> 'pass'
      ) then
    raise exception 'roster validation or capacity evidence is not passing';
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
      or coalesce(p_safe_boundary_proof ->> 'accountInventoryEvidenceRef', '') = ''
      or (p_safe_boundary_proof ->> 'observedAt')::timestamptz
        < p_activated_at - interval '30 seconds'
      or (p_safe_boundary_proof ->> 'observedAt')::timestamptz
        > p_activated_at + interval '5 seconds'
      or exists (
        select 1
        from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account
        where account #>> '{openPositions,state}' is distinct from 'observed'
          or account #>> '{openPositions,count}' is distinct from '0'
          or coalesce(account #>> '{openPositions,evidenceRef}', '') = ''
          or account #>> '{openOrders,state}' is distinct from 'observed'
          or account #>> '{openOrders,count}' is distinct from '0'
          or coalesce(account #>> '{openOrders,evidenceRef}', '') = ''
      ) then
    raise exception 'roster activation safe-boundary proof is incomplete or stale';
  end if;
  select coalesce(jsonb_agg(account.id::text order by account.id::text), '[]'::jsonb)
  into configured_account_ids from public.accounts account
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
        (select jsonb_array_elements_text(
          p_safe_boundary_proof -> 'configuredPaperAccountIds'
        ) except select account ->> 'accountId'
          from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account)
        union all
        (select account ->> 'accountId'
          from jsonb_array_elements(p_safe_boundary_proof -> 'brokerAccounts') account
        except select jsonb_array_elements_text(
          p_safe_boundary_proof -> 'configuredPaperAccountIds'
        ))
      )
      or exists (select 1 from public.positions where status = 'open') then
    raise exception 'roster activation did not prove every paper account and desk flat';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(bundle.candidate_specs) candidate_spec
    where coalesce(candidate_spec ->> 'executionPosture', 'paper') = 'paper'
      and not exists (
        select 1
        from public.channel_collection_state_current collection
        where collection.channel_id = (candidate_spec ->> 'channelId')::uuid
          and collection.state = 'active'
      )
  ) then
    raise exception 'roster activation requires active collection for every paper channel';
  end if;

  insert into public.channel_roster_bundle_approvals (
    id, bundle_id, worker_acknowledgement_id, approved_by,
    approval_evidence_ref, approved_at, activation_boundary,
    runtime_mutation_scope, order_authority
  ) values (
    p_approval_id, p_bundle_id, p_worker_acknowledgement_id, p_operator_id,
    btrim(p_approval_evidence_ref), p_approved_at, 'next-safe-entry',
    'receipt-bound-new-entry-only', false
  );

  insert into public.release_manifests (
    manifest_key, release_id, cohort_id, worker_compatibility_version,
    legacy_configuration_hash, paper_live_authority,
    admission_policy_version, collision_policy_version,
    activation_boundary, admission_policies, rollback_target_manifest_id,
    parent_manifest_id, manifest_json, content_hash, created_by, created_at,
    valid_from, valid_until, status
  ) values (
    bundle.candidate_manifest ->> 'id',
    bundle.candidate_manifest ->> 'releaseId',
    bundle.candidate_manifest ->> 'cohortId',
    bundle.candidate_manifest ->> 'workerCompatibilityVersion',
    bundle.candidate_manifest ->> 'legacyConfigurationHash', 'paper-only',
    bundle.candidate_manifest ->> 'admissionPolicyVersion',
    bundle.candidate_manifest ->> 'collisionPolicyVersion',
    'next-safe-entry', bundle.candidate_manifest -> 'admissionPolicies',
    base_manifest.manifest_key, base_manifest.id, bundle.candidate_manifest,
    bundle.candidate_manifest ->> 'contentHash',
    bundle.candidate_manifest ->> 'createdBy',
    (bundle.candidate_manifest ->> 'createdAt')::timestamptz,
    p_activated_at, null, 'draft'
  ) returning * into new_manifest;

  for spec in
    select value from jsonb_array_elements(bundle.candidate_specs)
      with ordinality as specs(value, ord) order by ord
  loop
    select * into member_spec from public.channel_spec_versions
    where version_key = spec ->> 'id';
    if member_spec.id is not null then
      if member_spec.content_hash <> spec ->> 'contentHash'
          or member_spec.status <> 'active'
          or not exists (
            select 1 from public.release_manifest_channels member
            where member.release_manifest_id = base_manifest.id
              and member.channel_spec_version_id = member_spec.id
          ) then
        raise exception 'roster unchanged candidate spec drifted';
      end if;
    else
      parent_from_rollback := false;
      select base_spec.* into parent_spec
      from public.release_manifest_channels member
      join public.channel_spec_versions base_spec
        on base_spec.id = member.channel_spec_version_id
      where member.release_manifest_id = base_manifest.id
        and base_spec.version_key = spec ->> 'parentVersionId';
      if parent_spec.id is null and bundle.rollback_context is not null then
        select target_spec.* into parent_spec
        from public.release_manifests rollback_target
        join public.release_manifest_channels target_member
          on target_member.release_manifest_id = rollback_target.id
        join public.channel_spec_versions target_spec
          on target_spec.id = target_member.channel_spec_version_id
        where rollback_target.manifest_key
            = bundle.rollback_context ->> 'exactTargetManifestId'
          and target_spec.version_key = spec ->> 'parentVersionId'
          and target_spec.channel_id::text = spec ->> 'channelId'
          and target_spec.channel_slug = spec ->> 'slug';
        parent_from_rollback := parent_spec.id is not null;
      end if;
      if parent_spec.id is null and not exists (
        select 1 from public.research_channel_registration_current registration
        where registration.state = 'paper-eligible'
          and registration.channel_id::text = spec ->> 'channelId'
          and registration.channel_slug = spec ->> 'slug'
          and registration.candidate_spec ->> 'id' = spec ->> 'parentVersionId'
      ) then
        raise exception 'roster new candidate spec lacks an eligible immutable parent';
      end if;
      if parent_spec.id is not null and (
          (not parent_from_rollback and parent_spec.status <> 'active')
          or parent_spec.channel_id::text <> spec ->> 'channelId'
          or parent_spec.channel_slug <> spec ->> 'slug'
        ) then
        raise exception 'roster candidate parent spec drifted';
      end if;
      insert into public.channel_spec_versions (
        version_key, channel_id, channel_slug, strategy_identity,
        strategy_version, signal_version, manager_profile_id, manager_version,
        account_id, account_role, account_mode, symbol_scope, family_id,
        cohort, priority, quantity, max_debit_usd, entry_parameters,
        exit_parameters, take_profit, stop_loss, ratchet_parameters,
        reentry_policy, scale_policy, collision_domain, risk_limits,
        execution_posture, valid_from, valid_until, created_by, created_at,
        parent_version_id, content_hash, status
      ) values (
        spec ->> 'id', (spec ->> 'channelId')::uuid, spec ->> 'slug',
        spec ->> 'strategyIdentity', spec ->> 'strategyVersion',
        spec ->> 'signalVersion', spec ->> 'managerProfileId',
        spec ->> 'managerVersion', (spec ->> 'accountId')::uuid,
        spec ->> 'accountRole', 'paper', spec -> 'symbolScope',
        spec ->> 'familyId', spec ->> 'cohort',
        (spec ->> 'priority')::integer, (spec ->> 'quantity')::integer,
        (spec ->> 'maxDebitUsd')::numeric, spec -> 'entryParameters',
        spec -> 'exitParameters', spec -> 'takeProfit', spec -> 'stopLoss',
        spec -> 'ratchetParameters', spec ->> 'reentryPolicy',
        spec -> 'scalePolicy', spec ->> 'collisionDomain', spec -> 'riskLimits',
        coalesce(spec ->> 'executionPosture', 'paper'),
        (spec ->> 'validFrom')::timestamptz, null, spec ->> 'createdBy',
        (spec ->> 'createdAt')::timestamptz, parent_spec.id,
        spec ->> 'contentHash', 'draft'
      ) returning * into member_spec;
      update public.channel_spec_versions set status = 'validated'
      where id = member_spec.id;
      update public.channel_spec_versions set status = 'scheduled'
      where id = member_spec.id;
    end if;
    insert into public.release_manifest_channels (
      release_manifest_id, channel_spec_version_id, ordinal
    ) values (new_manifest.id, member_spec.id, ordinal);
    ordinal := ordinal + 1;
  end loop;
  if ordinal <> jsonb_array_length(
      bundle.candidate_manifest -> 'channelSpecVersionIds'
    )
      or ordinal <> jsonb_array_length(
        bundle.candidate_manifest -> 'channelSpecContentHashes'
      )
      or exists (
        select 1 from public.release_manifest_channels membership
        join public.channel_spec_versions channel_spec
          on channel_spec.id = membership.channel_spec_version_id
        where membership.release_manifest_id = new_manifest.id
          and (channel_spec.version_key <> (
            bundle.candidate_manifest -> 'channelSpecVersionIds'
          ) ->> membership.ordinal
          or channel_spec.content_hash <> (
            bundle.candidate_manifest -> 'channelSpecContentHashes'
          ) ->> membership.ordinal)
      ) then
    raise exception 'roster activation manifest membership drifted';
  end if;
  update public.release_manifests set status = 'validated'
  where id = new_manifest.id;
  update public.release_manifests set status = 'scheduled'
  where id = new_manifest.id;

  insert into public.channel_roster_bundle_activation_receipts (
    id, bundle_id, approval_id, worker_acknowledgement_id,
    configuration_epoch_id, prior_release_manifest_id, release_manifest_id,
    prior_manifest_key, prior_manifest_content_hash, candidate_manifest_key,
    candidate_manifest_content_hash, rollback_target_manifest_key,
    exact_diffs, capacity_evaluation, safe_boundary_proof,
    worker_acknowledgement, activated_by, activated_at, activation_scope,
    open_position_policy_preservation, historical_evidence_mutation,
    order_authority
  ) values (
    p_activation_receipt_id, bundle.id, p_approval_id,
    acknowledgement.id, bundle.configuration_epoch_id, base_manifest.id,
    new_manifest.id, base_manifest.manifest_key, base_manifest.content_hash,
    new_manifest.manifest_key, new_manifest.content_hash,
    base_manifest.manifest_key, bundle.exact_diffs,
    bundle.capacity_evaluation, p_safe_boundary_proof,
    acknowledgement.acknowledgement, p_operator_id, p_activated_at,
    'prospective-new-entry-only', 'entry-epoch-immutable', false, false
  );

  for member_spec in
    select channel_spec.*
    from public.release_manifest_channels membership
    join public.channel_spec_versions channel_spec
      on channel_spec.id = membership.channel_spec_version_id
    where membership.release_manifest_id = new_manifest.id
      and channel_spec.status = 'scheduled'
  loop
    select * into parent_spec from public.channel_spec_versions
    where id = member_spec.parent_version_id;
    insert into public.channel_roster_bundle_activation_specs (
      activation_receipt_id, channel_id, channel_slug,
      old_spec_version_id, new_spec_version_id, old_content_hash,
      new_content_hash
    ) values (
      p_activation_receipt_id, member_spec.channel_id,
      member_spec.channel_slug, parent_spec.id, member_spec.id,
      parent_spec.content_hash, member_spec.content_hash
    );
  end loop;

  insert into public.channel_roster_bundle_activation_removals (
    activation_receipt_id, channel_id, channel_slug,
    old_spec_version_id, old_content_hash, collection_preserved
  )
  select p_activation_receipt_id, old_spec.channel_id,
    old_spec.channel_slug, old_spec.id, old_spec.content_hash, true
  from public.release_manifest_channels old_membership
  join public.channel_spec_versions old_spec
    on old_spec.id = old_membership.channel_spec_version_id
  where old_membership.release_manifest_id = base_manifest.id
    and not exists (
      select 1
      from public.release_manifest_channels new_membership
      join public.channel_spec_versions new_member_spec
        on new_member_spec.id = new_membership.channel_spec_version_id
      where new_membership.release_manifest_id = new_manifest.id
        and new_member_spec.channel_id = old_spec.channel_id
    );

  update public.channel_spec_versions old_spec
  set status = 'superseded', valid_until = p_activated_at
  where old_spec.id in (
    select activation_spec.old_spec_version_id
    from public.channel_roster_bundle_activation_specs activation_spec
    where activation_spec.activation_receipt_id = p_activation_receipt_id
      and activation_spec.old_spec_version_id is not null
  );
  update public.channel_spec_versions removed_spec
  set status = 'superseded', valid_until = p_activated_at
  where removed_spec.id in (
    select removal.old_spec_version_id
    from public.channel_roster_bundle_activation_removals removal
    where removal.activation_receipt_id = p_activation_receipt_id
  );
  update public.channel_spec_versions new_spec
  set status = 'active'
  where new_spec.id in (
    select activation_spec.new_spec_version_id
    from public.channel_roster_bundle_activation_specs activation_spec
    where activation_spec.activation_receipt_id = p_activation_receipt_id
  );
  update public.release_manifests
  set status = 'superseded', valid_until = p_activated_at
  where id = base_manifest.id;
  update public.release_manifests set status = 'active'
  where id = new_manifest.id;
  insert into public.channel_roster_bundle_lifecycle_receipts (
    id, bundle_id, prior_receipt_id, state, successor_bundle_id,
    reason, evidence_refs, operator_id, effective_at
  ) values (
    p_approved_lifecycle_receipt_id, bundle.id, current_receipt.id,
    case when bundle.rollback_context is null then 'approved' else 'rolled-back' end,
    null,
    case when bundle.rollback_context is null
      then 'Operator approved exact atomic roster activation.'
      else 'Operator approved exact prior-manifest rollback activation.'
    end,
    jsonb_build_array(btrim(p_approval_evidence_ref)), p_operator_id,
    p_activated_at
  );
  return query select p_activation_receipt_id, bundle.id, new_manifest.id,
    new_manifest.manifest_key, bundle.configuration_epoch_id, p_activated_at,
    base_manifest.manifest_key, false;
end;
$$;

alter table public.channel_roster_bundle_worker_acknowledgements enable row level security;
alter table public.channel_roster_bundle_approvals enable row level security;
alter table public.channel_roster_bundle_activation_receipts enable row level security;
alter table public.channel_roster_bundle_activation_specs enable row level security;
alter table public.channel_roster_bundle_activation_removals enable row level security;

revoke all on public.channel_roster_bundle_worker_acknowledgements from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_approvals from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_activation_receipts from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_activation_specs from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_activation_removals from public, anon, authenticated, service_role;
revoke all on function public.create_channel_roster_rollback_draft(
  uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,
  jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.acknowledge_channel_roster_bundle(
  uuid,uuid,uuid,uuid,text,timestamp with time zone,text,jsonb
) from public, anon, authenticated;
revoke all on function public.activate_channel_roster_bundle(
  uuid,uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,
  timestamp with time zone,jsonb
) from public, anon, authenticated;
revoke all on function seve_control.serialize_collection_against_activation()
  from public, anon, authenticated, service_role;

grant select on public.channel_roster_bundle_worker_acknowledgements to service_role;
grant select on public.channel_roster_bundle_approvals to service_role;
grant select on public.channel_roster_bundle_activation_receipts to service_role;
grant select on public.channel_roster_bundle_activation_specs to service_role;
grant select on public.channel_roster_bundle_activation_removals to service_role;
grant execute on function public.create_channel_roster_rollback_draft(
  uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,
  jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) to service_role;
grant execute on function public.acknowledge_channel_roster_bundle(
  uuid,uuid,uuid,uuid,text,timestamp with time zone,text,jsonb
) to service_role;
grant execute on function public.activate_channel_roster_bundle(
  uuid,uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,
  timestamp with time zone,jsonb
) to service_role;

comment on function public.acknowledge_channel_roster_bundle(
  uuid,uuid,uuid,uuid,text,timestamp with time zone,text,jsonb
) is
  'Service-role-only worker staging receipt. It grants no runtime or order authority.';
comment on function public.create_channel_roster_rollback_draft(
  uuid,uuid,uuid,text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,
  jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) is
  'Service-role-only exact prior-manifest rollback draft. It grants no runtime or order authority.';
comment on function public.activate_channel_roster_bundle(
  uuid,uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,
  timestamp with time zone,jsonb
) is
  'Atomic paper-only prospective roster activation after exact worker, operator, and fresh flat-book evidence.';

commit;
