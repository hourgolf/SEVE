-- Append-only research-channel registration and atomic roster-bundle drafts.
-- Installing this migration creates no registration, bundle, proposal,
-- activation receipt, manifest, runtime change, route change, or order.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.research_channel_registrations (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  registration_key            text not null unique check (
                                registration_key ~ '^[a-z0-9][a-z0-9:._/-]{2,199}$'
                              ),
  channel_id                  uuid not null references public.strategists(id),
  channel_slug                text not null check (
                                channel_slug ~ '^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$'
                              ),
  cartridge                   jsonb null check (
                                cartridge is null or jsonb_typeof(cartridge) = 'object'
                              ),
  candidate_spec              jsonb null check (
                                candidate_spec is null
                                or jsonb_typeof(candidate_spec) = 'object'
                              ),
  state                       text not null check (
                                state in ('paper-eligible', 'registered-blocked')
                              ),
  declared_blockers           jsonb not null check (
                                jsonb_typeof(declared_blockers) = 'array'
                                and jsonb_array_length(declared_blockers) <= 128
                              ),
  blockers                    jsonb not null check (
                                jsonb_typeof(blockers) = 'array'
                                and jsonb_array_length(blockers) <= 128
                              ),
  content_hash                text not null unique check (
                                content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  registered_by               text not null check (length(btrim(registered_by)) between 3 and 200),
  registered_at               timestamptz not null,
  execution_authority         boolean not null default false check (not execution_authority),
  runtime_mutation_authorized boolean not null default false check (not runtime_mutation_authorized),
  order_authority             boolean not null default false check (not order_authority),
  created_at                  timestamptz not null default now(),
  check (
    state = 'registered-blocked'
    or (
      cartridge is not null
      and candidate_spec is not null
      and jsonb_array_length(blockers) = 0
      and candidate_spec ->> 'channelId' = channel_id::text
      and candidate_spec ->> 'slug' = channel_slug
      and candidate_spec ->> 'accountMode' = 'paper'
      and candidate_spec ->> 'executionPosture' = 'observe-only'
      and candidate_spec ->> 'status' = 'validated'
    )
  )
);

create index research_channel_registrations_channel_idx
  on public.research_channel_registrations (channel_id, registered_at desc);

create or replace view public.research_channel_registration_current
with (security_invoker = true)
as
select distinct on (registration.channel_id)
  registration.*
from public.research_channel_registrations registration
order by
  registration.channel_id,
  registration.registered_at desc,
  registration.created_at desc,
  registration.id desc;

create table public.channel_roster_bundles (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  base_release_manifest_id    uuid not null references public.release_manifests(id),
  base_manifest_key           text not null,
  base_manifest_content_hash  text not null check (
                                base_manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  registry_content_hash       text not null check (
                                registry_content_hash ~ '^sha256:[0-9a-f]{64}$'
                              ),
  registry_entries            jsonb not null check (
                                jsonb_typeof(registry_entries) = 'array'
                                and jsonb_array_length(registry_entries) <= 68
                              ),
  changes                     jsonb not null check (
                                jsonb_typeof(changes) = 'array'
                                and jsonb_array_length(changes) between 1 and 68
                              ),
  candidate_manifest          jsonb not null check (
                                jsonb_typeof(candidate_manifest) = 'object'
                              ),
  candidate_specs             jsonb not null check (
                                jsonb_typeof(candidate_specs) = 'array'
                                and jsonb_array_length(candidate_specs) > 0
                              ),
  worker_projection           jsonb not null check (
                                jsonb_typeof(worker_projection) = 'object'
                              ),
  dashboard_projection        jsonb not null check (
                                jsonb_typeof(dashboard_projection) = 'object'
                              ),
  exact_diffs                 jsonb not null check (
                                jsonb_typeof(exact_diffs) = 'array'
                                and jsonb_array_length(exact_diffs) > 0
                              ),
  validation_results          jsonb not null check (
                                jsonb_typeof(validation_results) = 'array'
                                and jsonb_array_length(validation_results) > 0
                              ),
  capacity_evaluation         jsonb not null check (
                                jsonb_typeof(capacity_evaluation) = 'object'
                              ),
  configuration_epoch_id      text not null unique check (
                                configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                              ),
  reason                      text not null check (length(btrim(reason)) between 8 and 2000),
  evidence_refs               jsonb not null check (
                                jsonb_typeof(evidence_refs) = 'array'
                                and jsonb_array_length(evidence_refs) between 1 and 64
                              ),
  operator_id                 uuid not null,
  created_at                  timestamptz not null,
  activation_boundary         text not null default 'next-safe-entry' check (
                                activation_boundary = 'next-safe-entry'
                              ),
  historical_evidence_mutation boolean not null default false check (not historical_evidence_mutation),
  runtime_mutation_authorized boolean not null default false check (not runtime_mutation_authorized),
  order_authority             boolean not null default false check (not order_authority),
  unique (base_release_manifest_id, id)
);

create index channel_roster_bundles_base_idx
  on public.channel_roster_bundles (base_release_manifest_id, created_at desc);

create table public.channel_roster_bundle_lifecycle_receipts (
  id                          uuid primary key,
  schema_version              integer not null default 1 check (schema_version = 1),
  bundle_id                   uuid not null references public.channel_roster_bundles(id),
  prior_receipt_id            uuid null references public.channel_roster_bundle_lifecycle_receipts(id),
  state                       text not null check (
                                state in ('draft', 'validated', 'canceled', 'superseded', 'approved', 'rolled-back')
                              ),
  successor_bundle_id         uuid null references public.channel_roster_bundles(id),
  reason                      text not null check (length(btrim(reason)) between 8 and 2000),
  evidence_refs               jsonb not null check (
                                jsonb_typeof(evidence_refs) = 'array'
                                and jsonb_array_length(evidence_refs) between 1 and 64
                              ),
  operator_id                 uuid not null,
  effective_at                timestamptz not null,
  runtime_mutation_authorized boolean not null default false check (not runtime_mutation_authorized),
  order_authority             boolean not null default false check (not order_authority),
  created_at                  timestamptz not null default now(),
  unique (bundle_id, effective_at, id),
  check (
    (state = 'superseded' and successor_bundle_id is not null and successor_bundle_id <> bundle_id)
    or (state <> 'superseded' and successor_bundle_id is null)
  )
);

create index channel_roster_bundle_lifecycle_latest_idx
  on public.channel_roster_bundle_lifecycle_receipts
  (bundle_id, effective_at desc, created_at desc);

create or replace view public.channel_roster_bundle_current
with (security_invoker = true)
as
select distinct on (bundle.id)
  bundle.*,
  lifecycle.id as lifecycle_receipt_id,
  lifecycle.prior_receipt_id,
  lifecycle.state,
  lifecycle.successor_bundle_id,
  lifecycle.effective_at as state_effective_at
from public.channel_roster_bundles bundle
join public.channel_roster_bundle_lifecycle_receipts lifecycle
  on lifecycle.bundle_id = bundle.id
order by
  bundle.id,
  lifecycle.effective_at desc,
  lifecycle.created_at desc,
  lifecycle.id desc;

create or replace function seve_control.reject_operator_activation_artifact_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

create trigger research_channel_registrations_append_only
before update or delete on public.research_channel_registrations
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundles_append_only
before update or delete on public.channel_roster_bundles
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create trigger channel_roster_bundle_lifecycle_append_only
before update or delete on public.channel_roster_bundle_lifecycle_receipts
for each row execute function seve_control.reject_operator_activation_artifact_mutation();

create or replace function public.create_research_channel_registration(
  p_id uuid,
  p_registration_key text,
  p_channel_id uuid,
  p_channel_slug text,
  p_cartridge jsonb,
  p_candidate_spec jsonb,
  p_state text,
  p_declared_blockers jsonb,
  p_blockers jsonb,
  p_content_hash text,
  p_registered_by text,
  p_registered_at timestamptz
)
returns table (
  registration_id uuid,
  registration_key text,
  state text,
  content_hash text,
  execution_authority boolean,
  runtime_mutation_authorized boolean,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.research_channel_registrations%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_id::text, 0)
  );
  select * into existing
  from public.research_channel_registrations registration
  where registration.id = p_id;
  if existing.id is not null then
    if existing.registration_key <> p_registration_key
        or existing.channel_id <> p_channel_id
        or existing.channel_slug <> p_channel_slug
        or existing.cartridge is distinct from p_cartridge
        or existing.candidate_spec is distinct from p_candidate_spec
        or existing.state <> p_state
        or existing.declared_blockers <> p_declared_blockers
        or existing.blockers <> p_blockers
        or existing.content_hash <> p_content_hash
        or existing.registered_by <> btrim(p_registered_by)
        or existing.registered_at <> p_registered_at then
      raise exception using errcode = '23505', message = 'research registration idempotency conflict';
    end if;
    return query select existing.id, existing.registration_key,
      existing.state, existing.content_hash, false, false, false;
    return;
  end if;
  if p_state not in ('paper-eligible', 'registered-blocked')
      or jsonb_typeof(p_declared_blockers) <> 'array'
      or jsonb_array_length(p_declared_blockers) > 128
      or jsonb_typeof(p_blockers) <> 'array'
      or jsonb_array_length(p_blockers) > 128
      or length(btrim(p_registered_by)) not between 3 and 200
      or p_registered_at < pg_catalog.now() - interval '5 minutes'
      or p_registered_at > pg_catalog.now() + interval '1 minute' then
    raise exception 'research registration request metadata is invalid';
  end if;
  if p_state = 'paper-eligible' and (
      p_cartridge is null
      or jsonb_typeof(p_cartridge) <> 'object'
      or p_candidate_spec is null
      or jsonb_typeof(p_candidate_spec) <> 'object'
      or jsonb_array_length(p_blockers) <> 0
      or p_candidate_spec ->> 'channelId' <> p_channel_id::text
      or p_candidate_spec ->> 'slug' <> p_channel_slug
      or p_candidate_spec ->> 'accountMode' <> 'paper'
      or p_candidate_spec ->> 'executionPosture' <> 'observe-only'
      or p_candidate_spec ->> 'status' <> 'validated'
    ) then
    raise exception 'paper-eligible research registration is incomplete';
  end if;
  insert into public.research_channel_registrations (
    id, registration_key, channel_id, channel_slug, cartridge,
    candidate_spec, state, declared_blockers, blockers, content_hash, registered_by,
    registered_at
  ) values (
    p_id, p_registration_key, p_channel_id, p_channel_slug, p_cartridge,
    p_candidate_spec, p_state, p_declared_blockers, p_blockers, p_content_hash,
    btrim(p_registered_by), p_registered_at
  );
  return query select p_id, p_registration_key, p_state, p_content_hash,
    false, false, false;
end;
$$;

create or replace function public.create_channel_roster_bundle_draft(
  p_bundle_id uuid,
  p_initial_receipt_id uuid,
  p_base_manifest_key text,
  p_base_manifest_content_hash text,
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
  base_manifest public.release_manifests%rowtype;
  existing public.channel_roster_bundles%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bundle_id::text, 0)
  );

  select * into existing
  from public.channel_roster_bundles
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
        or existing.created_at <> p_created_at then
      raise exception using errcode = '23505', message = 'roster bundle idempotency conflict';
    end if;
    if not exists (
      select 1
      from public.channel_roster_bundle_lifecycle_receipts receipt
      where receipt.id = p_initial_receipt_id
        and receipt.bundle_id = existing.id
        and receipt.prior_receipt_id is null
        and receipt.state = 'draft'
        and receipt.reason = existing.reason
        and receipt.evidence_refs = existing.evidence_refs
        and receipt.operator_id = existing.operator_id
        and receipt.effective_at = existing.created_at
    ) then
      raise exception using errcode = '23505', message = 'roster initial receipt idempotency conflict';
    end if;
    return query
    select existing.id, lifecycle.id, lifecycle.state,
      existing.configuration_epoch_id, false, false
    from public.channel_roster_bundle_lifecycle_receipts lifecycle
    where lifecycle.id = p_initial_receipt_id;
    return;
  end if;

  select * into base_manifest
  from public.release_manifests
  where manifest_key = p_base_manifest_key
  for update;
  if base_manifest.id is null
      or base_manifest.status <> 'active'
      or base_manifest.content_hash <> p_base_manifest_content_hash then
    raise exception using errcode = '40001', message = 'roster bundle base manifest drifted';
  end if;
  if p_created_at < pg_catalog.now() - interval '5 minutes'
      or p_created_at > pg_catalog.now() + interval '1 minute'
      or length(btrim(p_reason)) not between 8 and 2000
      or jsonb_typeof(p_evidence_refs) <> 'array'
      or jsonb_array_length(p_evidence_refs) not between 1 and 64 then
    raise exception 'roster bundle request metadata is invalid';
  end if;
  if jsonb_typeof(p_registry_entries) <> 'array'
      or jsonb_array_length(p_registry_entries) > 68
      or jsonb_array_length(p_registry_entries) <> (
        select count(*)
        from public.research_channel_registration_current
      )
      or jsonb_array_length(p_registry_entries) <> (
        select count(distinct supplied ->> 'registrationKey')
        from jsonb_array_elements(p_registry_entries) supplied
      )
      or exists (
        select 1
        from jsonb_array_elements(p_registry_entries) supplied
        left join public.research_channel_registration_current registration
          on registration.registration_key = supplied ->> 'registrationKey'
          and registration.channel_id::text = supplied ->> 'channelId'
          and registration.channel_slug = supplied ->> 'slug'
          and registration.state = supplied ->> 'state'
          and registration.content_hash = supplied ->> 'contentHash'
        where registration.id is null
      ) then
    raise exception 'roster bundle registry snapshot is stale or invalid';
  end if;
  if jsonb_typeof(p_changes) <> 'array'
      or jsonb_array_length(p_changes) not between 1 and 68
      or jsonb_typeof(p_candidate_specs) <> 'array'
      or jsonb_array_length(p_candidate_specs) = 0
      or jsonb_array_length(p_candidate_specs) <> (
        select count(distinct spec ->> 'channelId')
        from jsonb_array_elements(p_candidate_specs) spec
      )
      or jsonb_typeof(p_exact_diffs) <> 'array'
      or jsonb_array_length(p_exact_diffs) = 0 then
    raise exception 'roster bundle changes, specs, or diffs are incomplete';
  end if;
  if p_candidate_manifest ->> 'parentManifestId' <> p_base_manifest_key
      or p_candidate_manifest ->> 'rollbackTargetManifestId' <> p_base_manifest_key
      or p_candidate_manifest ->> 'paperLiveAuthority' <> 'paper-only'
      or p_candidate_manifest ->> 'activationBoundary' <> 'next-safe-entry'
      or p_candidate_manifest ->> 'status' <> 'draft'
      or p_candidate_manifest ->> 'contentHash'
        <> p_worker_projection ->> 'manifestContentHash'
      or p_candidate_manifest ->> 'contentHash'
        <> p_dashboard_projection ->> 'manifestContentHash'
      or p_candidate_manifest ->> 'releaseId'
        <> p_worker_projection ->> 'releaseId'
      or p_candidate_manifest ->> 'releaseId'
        <> p_dashboard_projection ->> 'releaseId'
      or p_worker_projection ->> 'activationAuthorized' <> 'false'
      or p_dashboard_projection ->> 'activationAuthorized' <> 'false' then
    raise exception 'roster bundle manifest or projection identity disagrees';
  end if;
  if p_candidate_manifest -> 'channelSpecVersionIds' <> (
      select jsonb_agg(spec ->> 'id' order by ordinal)
      from jsonb_array_elements(p_candidate_specs)
        with ordinality as specs(spec, ordinal)
    )
      or p_candidate_manifest -> 'channelSpecContentHashes' <> (
        select jsonb_agg(spec ->> 'contentHash' order by ordinal)
        from jsonb_array_elements(p_candidate_specs)
          with ordinality as specs(spec, ordinal)
      )
      or exists (
        select 1
        from jsonb_array_elements(p_candidate_specs) spec
        where spec ->> 'accountMode' <> 'paper'
          or coalesce(spec ->> 'executionPosture', 'paper')
            not in ('paper', 'observe-only')
          or (
            not exists (
              select 1
              from public.release_manifest_channels member
              join public.channel_spec_versions base_spec
                on base_spec.id = member.channel_spec_version_id
              where member.release_manifest_id = base_manifest.id
                and base_spec.channel_id::text = spec ->> 'channelId'
                and base_spec.channel_slug = spec ->> 'slug'
                and base_spec.version_key in (
                  spec ->> 'id', spec ->> 'parentVersionId'
                )
            )
            and not exists (
              select 1
              from public.research_channel_registration_current registration
              where registration.state = 'paper-eligible'
                and registration.channel_id::text = spec ->> 'channelId'
                and registration.channel_slug = spec ->> 'slug'
                and registration.candidate_spec ->> 'id'
                  = spec ->> 'parentVersionId'
            )
          )
      ) then
    raise exception 'roster bundle candidate spec membership is invalid';
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
    raise exception 'roster bundle validation or portfolio capacity is not passing';
  end if;

  insert into public.channel_roster_bundles (
    id, base_release_manifest_id, base_manifest_key,
    base_manifest_content_hash, registry_content_hash, registry_entries, changes,
    candidate_manifest, candidate_specs, worker_projection,
    dashboard_projection, exact_diffs, validation_results,
    capacity_evaluation, configuration_epoch_id, reason, evidence_refs,
    operator_id, created_at
  ) values (
    p_bundle_id, base_manifest.id, p_base_manifest_key,
    p_base_manifest_content_hash, p_registry_content_hash, p_registry_entries, p_changes,
    p_candidate_manifest, p_candidate_specs, p_worker_projection,
    p_dashboard_projection, p_exact_diffs, p_validation_results,
    p_capacity_evaluation, p_configuration_epoch_id, btrim(p_reason),
    p_evidence_refs, p_operator_id, p_created_at
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

create or replace function public.transition_channel_roster_bundle(
  p_receipt_id uuid,
  p_bundle_id uuid,
  p_target_state text,
  p_successor_bundle_id uuid,
  p_reason text,
  p_evidence_refs jsonb,
  p_operator_id uuid,
  p_effective_at timestamptz
)
returns table (
  bundle_id uuid,
  lifecycle_receipt_id uuid,
  state text,
  successor_bundle_id uuid,
  runtime_mutation_authorized boolean,
  order_authority boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_receipt public.channel_roster_bundle_lifecycle_receipts%rowtype;
  existing_receipt public.channel_roster_bundle_lifecycle_receipts%rowtype;
  current_bundle public.channel_roster_bundles%rowtype;
  successor public.channel_roster_bundles%rowtype;
  successor_receipt public.channel_roster_bundle_lifecycle_receipts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bundle_id::text, 0)
  );
  select * into existing_receipt
  from public.channel_roster_bundle_lifecycle_receipts
  where id = p_receipt_id;
  if existing_receipt.id is not null then
    if existing_receipt.bundle_id <> p_bundle_id
        or existing_receipt.state <> p_target_state
        or existing_receipt.successor_bundle_id is distinct from p_successor_bundle_id
        or existing_receipt.reason <> btrim(p_reason)
        or existing_receipt.evidence_refs <> p_evidence_refs
        or existing_receipt.operator_id <> p_operator_id
        or existing_receipt.effective_at <> p_effective_at then
      raise exception using errcode = '23505', message = 'roster lifecycle idempotency conflict';
    end if;
    return query select p_bundle_id, existing_receipt.id,
      existing_receipt.state, existing_receipt.successor_bundle_id,
      false, false;
    return;
  end if;
  select lifecycle.* into current_receipt
  from public.channel_roster_bundle_lifecycle_receipts lifecycle
  where lifecycle.bundle_id = p_bundle_id
  order by lifecycle.effective_at desc, lifecycle.created_at desc,
    lifecycle.id desc
  limit 1
  for update;
  select * into current_bundle from public.channel_roster_bundles
  where id = p_bundle_id;
  if current_receipt.id is null
      or current_receipt.state not in ('draft', 'validated')
      or p_target_state not in ('canceled', 'superseded')
      or length(btrim(p_reason)) not between 8 and 2000
      or jsonb_typeof(p_evidence_refs) <> 'array'
      or jsonb_array_length(p_evidence_refs) not between 1 and 64
      or p_effective_at < current_receipt.effective_at
      or p_effective_at > pg_catalog.now() + interval '1 minute' then
    raise exception 'roster lifecycle transition is invalid';
  end if;
  if p_target_state = 'superseded' then
    select * into successor from public.channel_roster_bundles
    where id = p_successor_bundle_id;
    select lifecycle.* into successor_receipt
    from public.channel_roster_bundle_lifecycle_receipts lifecycle
    where lifecycle.bundle_id = p_successor_bundle_id
    order by lifecycle.effective_at desc, lifecycle.created_at desc,
      lifecycle.id desc
    limit 1;
    if successor.id is null or successor.id = p_bundle_id
        or successor_receipt.id is null
        or successor_receipt.state not in ('draft', 'validated')
        or successor.base_release_manifest_id
          <> current_bundle.base_release_manifest_id
        or successor.base_manifest_key <> current_bundle.base_manifest_key
        or successor.base_manifest_content_hash
          <> current_bundle.base_manifest_content_hash
        or successor.created_at < current_bundle.created_at then
      raise exception 'roster supersession successor is invalid';
    end if;
  elsif p_successor_bundle_id is not null then
    raise exception 'roster cancellation cannot name a successor';
  end if;
  insert into public.channel_roster_bundle_lifecycle_receipts (
    id, bundle_id, prior_receipt_id, state, successor_bundle_id,
    reason, evidence_refs, operator_id, effective_at
  ) values (
    p_receipt_id, p_bundle_id, current_receipt.id, p_target_state,
    p_successor_bundle_id, btrim(p_reason), p_evidence_refs,
    p_operator_id, p_effective_at
  );
  return query select p_bundle_id, p_receipt_id, p_target_state,
    p_successor_bundle_id, false, false;
end;
$$;

alter table public.research_channel_registrations enable row level security;
alter table public.channel_roster_bundles enable row level security;
alter table public.channel_roster_bundle_lifecycle_receipts enable row level security;

revoke all on public.research_channel_registrations from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundles from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_lifecycle_receipts from public, anon, authenticated, service_role;
revoke all on public.research_channel_registration_current from public, anon, authenticated, service_role;
revoke all on public.channel_roster_bundle_current from public, anon, authenticated, service_role;
revoke all on function public.create_research_channel_registration(
  uuid,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb,text,text,timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.create_channel_roster_bundle_draft(
  uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.transition_channel_roster_bundle(
  uuid,uuid,text,uuid,text,jsonb,uuid,timestamp with time zone
) from public, anon, authenticated;

grant select on public.research_channel_registrations to service_role;
grant select on public.research_channel_registration_current to service_role;
grant select on public.channel_roster_bundles to service_role;
grant select on public.channel_roster_bundle_lifecycle_receipts to service_role;
grant select on public.channel_roster_bundle_current to service_role;
grant execute on function public.create_research_channel_registration(
  uuid,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb,text,text,timestamp with time zone
) to service_role;
grant execute on function public.create_channel_roster_bundle_draft(
  uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) to service_role;
grant execute on function public.transition_channel_roster_bundle(
  uuid,uuid,text,uuid,text,jsonb,uuid,timestamp with time zone
) to service_role;

comment on table public.research_channel_registrations is
  'Append-only paper-only research registration. Eligibility never grants execution or order authority.';
comment on table public.channel_roster_bundles is
  'Immutable atomic roster candidate with portfolio-capacity evidence. Draft storage never grants activation or order authority.';
comment on function public.create_research_channel_registration(
  uuid,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb,text,text,timestamp with time zone
) is
  'Service-role-only idempotent research registration. Registration and eligibility never grant execution or order authority.';
comment on function public.create_channel_roster_bundle_draft(
  uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,jsonb,uuid,timestamp with time zone
) is
  'Service-role-only idempotent storage of one passing authority-dark atomic roster draft.';
comment on function public.transition_channel_roster_bundle(
  uuid,uuid,text,uuid,text,jsonb,uuid,timestamp with time zone
) is
  'Service-role-only append-only cancel or supersede transition. Never runtime or order authority.';

commit;
