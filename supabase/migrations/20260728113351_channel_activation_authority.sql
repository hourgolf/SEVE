-- PROPOSED / UNAPPLIED: adopt the existing paper-only runtime as the first
-- active control-plane baseline.
--
-- This migration does not change strategists, worker configuration, orders,
-- positions, or the running Railway process. The only executable operation it
-- adds is a service-role-only, atomic baseline-adoption RPC. Calling that RPC
-- still requires exact current-worker, all-account flatness, capture-readiness,
-- operator-approval, manifest, and channel-spec evidence.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.control_plane_adoption_receipts (
  id                           uuid primary key default gen_random_uuid(),
  schema_version               integer not null default 1 check (schema_version = 1),
  release_manifest_id          uuid not null unique references public.release_manifests(id),
  release_id                   text not null,
  manifest_content_hash        text not null check (
                                 manifest_content_hash ~ '^sha256:[0-9a-f]{64}$'
                               ),
  legacy_configuration_hash    text not null check (
                                 legacy_configuration_hash ~ '^[0-9a-f]{64}$'
                               ),
  configuration_epoch_id       text not null unique check (
                                 configuration_epoch_id ~ '^sha256:[0-9a-f]{64}$'
                               ),
  channel_spec_content_hashes  jsonb not null check (
                                 jsonb_typeof(channel_spec_content_hashes) = 'array'
                                 and jsonb_array_length(channel_spec_content_hashes) > 0
                               ),
  startup_receipt              jsonb not null check (
                                 jsonb_typeof(startup_receipt) = 'object'
                                 and startup_receipt <> '{}'::jsonb
                               ),
  worker_acknowledgement       jsonb not null check (
                                 jsonb_typeof(worker_acknowledgement) = 'object'
                                 and worker_acknowledgement <> '{}'::jsonb
                               ),
  safe_boundary_proof          jsonb not null check (
                                 jsonb_typeof(safe_boundary_proof) = 'object'
                                 and safe_boundary_proof <> '{}'::jsonb
                               ),
  validator_versions           jsonb not null check (
                                 jsonb_typeof(validator_versions) = 'array'
                                 and jsonb_array_length(validator_versions) > 0
                               ),
  approved_by                  uuid not null,
  approval_evidence_ref        text not null check (
                                 length(btrim(approval_evidence_ref)) > 0
                               ),
  approved_at                  timestamptz not null,
  adopted_at                   timestamptz not null,
  runtime_mutation             boolean not null default false check (runtime_mutation = false),
  order_authority              boolean not null default false check (order_authority = false),
  created_at                   timestamptz not null default now(),
  check (adopted_at >= approved_at)
);

create index control_plane_adoption_receipts_adopted_idx
  on public.control_plane_adoption_receipts (adopted_at desc);

create or replace function seve_control.enforce_control_plane_adoption_receipt_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  manifest public.release_manifests%rowtype;
  expected_spec_hashes jsonb;
  configured_account_ids jsonb;
begin
  select * into manifest
  from public.release_manifests
  where id = new.release_manifest_id;

  if manifest.id is null or manifest.status <> 'scheduled' then
    raise exception 'baseline adoption requires a scheduled manifest';
  end if;
  if manifest.parent_manifest_id is not null then
    raise exception 'baseline adoption is only valid for a root manifest';
  end if;
  if new.release_id <> manifest.release_id
      or new.manifest_content_hash <> manifest.content_hash
      or new.legacy_configuration_hash <> manifest.legacy_configuration_hash then
    raise exception 'baseline adoption identities do not match the manifest';
  end if;

  select jsonb_agg(spec.content_hash order by membership.ordinal)
  into expected_spec_hashes
  from public.release_manifest_channels membership
  join public.channel_spec_versions spec
    on spec.id = membership.channel_spec_version_id
  where membership.release_manifest_id = manifest.id;

  if expected_spec_hashes is null
      or new.channel_spec_content_hashes <> expected_spec_hashes
      or manifest.manifest_json -> 'channelSpecContentHashes' <> expected_spec_hashes then
    raise exception 'baseline adoption channel specification hashes do not match';
  end if;
  if exists (
    select 1
    from public.release_manifest_channels membership
    join public.channel_spec_versions spec
      on spec.id = membership.channel_spec_version_id
    where membership.release_manifest_id = manifest.id
      and spec.status <> 'scheduled'
  ) then
    raise exception 'baseline adoption requires every member specification to be scheduled';
  end if;

  if new.startup_receipt ->> 'releaseId' is distinct from manifest.release_id
      or new.startup_receipt ->> 'workerVersion'
        is distinct from manifest.worker_compatibility_version
      or new.startup_receipt ->> 'releaseConfigurationSha256'
        is distinct from manifest.legacy_configuration_hash
      or lower(new.startup_receipt ->> 'fundMode') is distinct from 'paper'
      or new.startup_receipt #>> '{runtimeReadiness,heldCaptureReady}' is distinct from 'true'
      or new.startup_receipt #>> '{runtimeReadiness,heldCaptureStartedBeforeBootDecision}'
        is distinct from 'true' then
    raise exception 'baseline adoption startup receipt is not exact and capture-ready';
  end if;
  if jsonb_typeof(new.startup_receipt -> 'roots') <> 'array'
      or jsonb_array_length(new.startup_receipt -> 'roots')
        <> jsonb_array_length(expected_spec_hashes)
      or exists (
        select 1
        from public.release_manifest_channels membership
        join public.channel_spec_versions spec
          on spec.id = membership.channel_spec_version_id
        where membership.release_manifest_id = manifest.id
          and not exists (
            select 1
            from jsonb_array_elements(new.startup_receipt -> 'roots') root
            where root ->> 'slug' = spec.channel_slug
              and root ->> 'accountId' = spec.account_id::text
              and root ->> 'managerProfileId' = spec.manager_profile_id
              and root ->> 'quantity' = spec.quantity::text
          )
      ) then
    raise exception 'baseline adoption startup roster does not match the manifest';
  end if;

  if new.worker_acknowledgement ->> 'manifestId' is distinct from manifest.manifest_key
      or new.worker_acknowledgement ->> 'manifestContentHash'
        is distinct from manifest.content_hash
      or new.worker_acknowledgement ->> 'configurationEpochId'
        is distinct from new.configuration_epoch_id
      or new.worker_acknowledgement ->> 'workerCompatibilityVersion'
        is distinct from manifest.worker_compatibility_version
      or new.worker_acknowledgement ->> 'workerReleaseId'
        is distinct from manifest.release_id
      or new.worker_acknowledgement ->> 'protocolVersion'
        is distinct from 'channel-activation-protocol-v1'
      or new.worker_acknowledgement ->> 'accountMode' is distinct from 'paper'
      or new.worker_acknowledgement ->> 'posture'
        is distinct from 'baseline-observed-no-order-authority'
      or coalesce(new.worker_acknowledgement ->> 'bootId', '') = ''
      or coalesce(new.worker_acknowledgement ->> 'evidenceRef', '') = ''
      or coalesce(new.worker_acknowledgement ->> 'acknowledgedAt', '') = '' then
    raise exception 'baseline adoption worker acknowledgement is not exact';
  end if;
  if (new.worker_acknowledgement ->> 'acknowledgedAt')::timestamptz
      < new.adopted_at - interval '60 seconds'
      or (new.worker_acknowledgement ->> 'acknowledgedAt')::timestamptz
        > new.adopted_at + interval '5 seconds' then
    raise exception 'baseline adoption worker acknowledgement is stale or future';
  end if;

  if new.safe_boundary_proof ->> 'globalFlat' is distinct from 'true'
      or new.safe_boundary_proof ->> 'protocolVersion'
        is distinct from 'channel-activation-protocol-v1'
      or jsonb_typeof(new.safe_boundary_proof -> 'configuredPaperAccountIds') <> 'array'
      or jsonb_array_length(new.safe_boundary_proof -> 'configuredPaperAccountIds') = 0
      or jsonb_typeof(new.safe_boundary_proof -> 'brokerAccounts') <> 'array'
      or new.safe_boundary_proof #>> '{deskOpenPositions,state}' is distinct from 'observed'
      or new.safe_boundary_proof #>> '{deskOpenPositions,count}' is distinct from '0'
      or coalesce(new.safe_boundary_proof #>> '{deskOpenPositions,evidenceRef}', '') = ''
      or coalesce(new.safe_boundary_proof ->> 'observedAt', '') = ''
      or coalesce(new.safe_boundary_proof ->> 'accountInventoryEvidenceRef', '') = '' then
    raise exception 'baseline adoption safe-boundary proof is incomplete';
  end if;
  if (new.safe_boundary_proof ->> 'observedAt')::timestamptz
      < new.adopted_at - interval '30 seconds'
      or (new.safe_boundary_proof ->> 'observedAt')::timestamptz
        > new.adopted_at + interval '5 seconds' then
    raise exception 'baseline adoption safe-boundary proof is stale or future';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.safe_boundary_proof -> 'brokerAccounts') account
    where account #>> '{openPositions,state}' is distinct from 'observed'
      or account #>> '{openPositions,count}' is distinct from '0'
      or coalesce(account #>> '{openPositions,evidenceRef}', '') = ''
      or account #>> '{openOrders,state}' is distinct from 'observed'
      or account #>> '{openOrders,count}' is distinct from '0'
      or coalesce(account #>> '{openOrders,evidenceRef}', '') = ''
  ) then
    raise exception 'baseline adoption broker account is not proven flat';
  end if;

  select coalesce(jsonb_agg(account.id::text order by account.id::text), '[]'::jsonb)
  into configured_account_ids
  from public.accounts account
  where lower(account.mode) = 'paper';

  if configured_account_ids <> (
      select coalesce(jsonb_agg(account_id order by account_id), '[]'::jsonb)
      from jsonb_array_elements_text(
        new.safe_boundary_proof -> 'configuredPaperAccountIds'
      ) account_id
  ) then
    raise exception 'baseline adoption did not inspect every configured paper account';
  end if;
  if jsonb_array_length(new.safe_boundary_proof -> 'brokerAccounts')
      <> jsonb_array_length(new.safe_boundary_proof -> 'configuredPaperAccountIds') then
    raise exception 'baseline adoption broker account count does not match configured accounts';
  end if;
  if exists (
    (
      select jsonb_array_elements_text(
        new.safe_boundary_proof -> 'configuredPaperAccountIds'
      )
      except
      select account ->> 'accountId'
      from jsonb_array_elements(new.safe_boundary_proof -> 'brokerAccounts') account
    )
    union all
    (
      select account ->> 'accountId'
      from jsonb_array_elements(new.safe_boundary_proof -> 'brokerAccounts') account
      except
      select jsonb_array_elements_text(
        new.safe_boundary_proof -> 'configuredPaperAccountIds'
      )
    )
  ) then
    raise exception 'baseline adoption broker proof does not match configured accounts';
  end if;
  if exists (select 1 from public.positions where status = 'open') then
    raise exception 'baseline adoption requires the desk position ledger to be flat';
  end if;
  if not (
    new.validator_versions @> '[
      "channel-control-plane-compiler-v1",
      "channel-activation-protocol-v1"
    ]'::jsonb
  ) then
    raise exception 'baseline adoption validator versions are incomplete';
  end if;
  if new.runtime_mutation or new.order_authority then
    raise exception 'baseline adoption cannot grant runtime or order authority';
  end if;
  return new;
end;
$$;

-- A scheduled version may become active through either a normal proposal
-- activation receipt or the one-time exact baseline-adoption receipt.
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
    if tg_table_name = 'channel_spec_versions' and not exists (
      select 1
      from public.activation_receipts receipt
      where receipt.new_spec_version_id = new.id
        and receipt.activated_at <= now()
      union all
      select 1
      from public.control_plane_adoption_receipts adoption
      join public.release_manifest_channels membership
        on membership.release_manifest_id = adoption.release_manifest_id
      where membership.channel_spec_version_id = new.id
        and adoption.adopted_at <= now()
    ) then
      raise exception 'channel spec activation requires an activation or baseline-adoption receipt';
    end if;
    if tg_table_name = 'release_manifests' and not exists (
      select 1
      from public.activation_receipts receipt
      where receipt.release_manifest_id = new.id
        and receipt.activated_at <= now()
      union all
      select 1
      from public.control_plane_adoption_receipts adoption
      where adoption.release_manifest_id = new.id
        and adoption.adopted_at <= now()
    ) then
      raise exception 'release manifest activation requires an activation or baseline-adoption receipt';
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

create or replace function public.adopt_channel_control_plane_baseline(
  p_manifest_key text,
  p_manifest_content_hash text,
  p_configuration_epoch_id text,
  p_operator_id uuid,
  p_approval_evidence_ref text,
  p_approved_at timestamptz,
  p_adopted_at timestamptz,
  p_safe_boundary_proof jsonb,
  p_worker_acknowledgement jsonb,
  p_startup_receipt jsonb,
  p_validator_versions jsonb
)
returns table (
  adoption_receipt_id uuid,
  release_manifest_id uuid,
  manifest_key text,
  manifest_status text,
  adopted_at timestamptz,
  runtime_mutation boolean,
  order_authority boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  manifest public.release_manifests%rowtype;
  existing_receipt public.control_plane_adoption_receipts%rowtype;
  spec_hashes jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_manifest_key, 0)
  );

  select * into manifest
  from public.release_manifests candidate_manifest
  where candidate_manifest.manifest_key = p_manifest_key
  for update;

  if manifest.id is null then
    raise exception using errcode = 'P0002', message = 'baseline manifest is missing';
  end if;

  select * into existing_receipt
  from public.control_plane_adoption_receipts adoption
  where adoption.release_manifest_id = manifest.id;

  if existing_receipt.id is not null then
    if existing_receipt.manifest_content_hash <> p_manifest_content_hash
        or existing_receipt.configuration_epoch_id <> p_configuration_epoch_id
        or existing_receipt.approved_by <> p_operator_id
        or existing_receipt.approval_evidence_ref <> btrim(p_approval_evidence_ref)
        or existing_receipt.safe_boundary_proof <> p_safe_boundary_proof
        or existing_receipt.worker_acknowledgement <> p_worker_acknowledgement
        or existing_receipt.startup_receipt <> p_startup_receipt
        or existing_receipt.validator_versions <> p_validator_versions then
      raise exception using errcode = '23505', message = 'baseline adoption idempotency conflict';
    end if;
    return query select
      existing_receipt.id,
      manifest.id,
      manifest.manifest_key,
      manifest.status,
      existing_receipt.adopted_at,
      existing_receipt.runtime_mutation,
      existing_receipt.order_authority;
    return;
  end if;

  if manifest.status <> 'draft' or manifest.parent_manifest_id is not null then
    raise exception 'baseline manifest must be an unadopted root draft';
  end if;
  if manifest.content_hash <> p_manifest_content_hash then
    raise exception using errcode = '40001', message = 'baseline manifest hash drifted';
  end if;
  if p_configuration_epoch_id !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'baseline configuration epoch is malformed';
  end if;
  if p_approval_evidence_ref is null or length(btrim(p_approval_evidence_ref)) = 0 then
    raise exception 'baseline operator approval evidence is missing';
  end if;
  if p_approved_at > p_adopted_at
      or p_approved_at < p_adopted_at - interval '2 hours'
      or p_adopted_at > pg_catalog.now()
      or p_adopted_at < pg_catalog.now() - interval '5 minutes' then
    raise exception 'baseline adoption timestamps are outside the acceptance window';
  end if;
  if exists (
    select 1
    from public.release_manifests other_manifest
    where other_manifest.status = 'active'
      and other_manifest.id <> manifest.id
  ) then
    raise exception 'another control-plane manifest is already active';
  end if;
  if exists (
    select 1
    from public.release_manifest_channels membership
    join public.channel_spec_versions spec
      on spec.id = membership.channel_spec_version_id
    where membership.release_manifest_id = manifest.id
      and spec.status <> 'draft'
  ) then
    raise exception 'baseline manifest contains a non-draft specification';
  end if;

  select jsonb_agg(spec.content_hash order by membership.ordinal)
  into spec_hashes
  from public.release_manifest_channels membership
  join public.channel_spec_versions spec
    on spec.id = membership.channel_spec_version_id
  where membership.release_manifest_id = manifest.id;

  if spec_hashes is null
      or spec_hashes <> manifest.manifest_json -> 'channelSpecContentHashes' then
    raise exception 'baseline manifest membership is incomplete or hash-drifted';
  end if;

  update public.channel_spec_versions spec
  set status = 'validated'
  from public.release_manifest_channels membership
  where membership.release_manifest_id = manifest.id
    and membership.channel_spec_version_id = spec.id;

  update public.release_manifests
  set status = 'validated'
  where id = manifest.id;

  update public.channel_spec_versions spec
  set status = 'scheduled'
  from public.release_manifest_channels membership
  where membership.release_manifest_id = manifest.id
    and membership.channel_spec_version_id = spec.id;

  update public.release_manifests
  set status = 'scheduled',
      valid_from = p_adopted_at
  where id = manifest.id;

  insert into public.control_plane_adoption_receipts (
    release_manifest_id, release_id, manifest_content_hash,
    legacy_configuration_hash, configuration_epoch_id,
    channel_spec_content_hashes, startup_receipt, worker_acknowledgement,
    safe_boundary_proof, validator_versions, approved_by, approval_evidence_ref, approved_at,
    adopted_at, runtime_mutation, order_authority
  ) values (
    manifest.id, manifest.release_id, manifest.content_hash,
    manifest.legacy_configuration_hash, p_configuration_epoch_id,
    spec_hashes, p_startup_receipt, p_worker_acknowledgement,
    p_safe_boundary_proof, p_validator_versions, p_operator_id, btrim(p_approval_evidence_ref), p_approved_at,
    p_adopted_at, false, false
  )
  returning * into existing_receipt;

  update public.channel_spec_versions spec
  set status = 'active'
  from public.release_manifest_channels membership
  where membership.release_manifest_id = manifest.id
    and membership.channel_spec_version_id = spec.id;

  update public.release_manifests
  set status = 'active'
  where id = manifest.id;

  return query select
    existing_receipt.id,
    manifest.id,
    manifest.manifest_key,
    'active'::text,
    existing_receipt.adopted_at,
    existing_receipt.runtime_mutation,
    existing_receipt.order_authority;
end;
$$;

alter table public.control_plane_adoption_receipts enable row level security;
revoke all on public.control_plane_adoption_receipts from public, anon, authenticated;
grant select on public.control_plane_adoption_receipts to authenticated, service_role;
grant insert on public.control_plane_adoption_receipts to service_role;

create policy control_plane_adoption_receipts_operator_read
  on public.control_plane_adoption_receipts
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'seve_role') = 'operator');

create trigger control_plane_adoption_receipts_insert_guard
  before insert on public.control_plane_adoption_receipts
  for each row execute function seve_control.enforce_control_plane_adoption_receipt_insert();

create trigger control_plane_adoption_receipts_append_only_guard
  before update or delete on public.control_plane_adoption_receipts
  for each row execute function seve_control.reject_append_only_mutation();

revoke all on function seve_control.enforce_control_plane_adoption_receipt_insert()
  from public, anon, authenticated;
grant execute on function seve_control.enforce_control_plane_adoption_receipt_insert()
  to service_role;

revoke all on function public.adopt_channel_control_plane_baseline(
  text, text, text, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.adopt_channel_control_plane_baseline(
  text, text, text, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) to service_role;

comment on table public.control_plane_adoption_receipts is
  'Append-only proof that an existing paper-only runtime was adopted as the initial control-plane baseline without changing runtime or order authority.';
comment on function public.adopt_channel_control_plane_baseline(
  text, text, text, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) is
  'Service-role-only atomic adoption of an exact, flat, capture-ready paper baseline. It does not mutate runtime configuration or place orders.';

commit;
