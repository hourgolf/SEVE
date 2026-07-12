# Phase 1B — durable truth foundation

Status: review branch only. Dark/unwired. No live trading policy changes.

## Scope

1. Classify worker deploy handoffs separately from abrupt terminations.
2. Preserve active management-counterfactual state across worker restarts.
3. Add immutable policy-epoch and position-plan storage for later allocator/manager work.

This slice does **not** activate the order/fill ledger, position plans, scaling,
conviction sizing, runners, or new exits.

## Required application order

1. Apply `supabase/migrations/20260712132807_phase_1b_durable_truth.sql` manually.
2. Verify the schema and access checks below.
3. Merge the worker branch.
4. Bump `WORKER_VERSION` once, at the deployment checkpoint.
5. Manually deploy Railway.
6. Verify the versioned heartbeat and restored-state log before market use.

Never deploy the worker code before the migration. The code fails open if the
table is absent, but restart persistence and truthful deploy classification will
remain disabled.

## Schema verification

Run as an administrator:

```sql
select to_regclass('public.policy_epochs'),
       to_regclass('public.position_plans'),
       to_regclass('public.shadow_management_state');

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'worker_runs'
  and column_name in ('superseded_by_boot_id', 'classified_at')
order by column_name;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.policy_epochs'::regclass,
  'public.position_plans'::regclass,
  'public.shadow_management_state'::regclass
);
```

Expected: all three relations exist; both worker-run columns exist; RLS is true
for all three new tables.

## Access verification

- `anon`: no privileges and no rows.
- authenticated non-operator: no rows.
- authenticated user with `app_metadata.seve_role = operator`: SELECT only.
- service role: SELECT/INSERT/UPDATE/DELETE.

The migration explicitly grants every required privilege; it does not depend on
Supabase's changing default table-exposure behavior.

## Runtime verification

After the worker deploy:

```sql
select boot_id, version, git_sha, started_at, last_heartbeat_at,
       ended_at, termination_kind, superseded_by_boot_id, last_error
from public.worker_runs
order by started_at desc
limit 5;

select position_id, slug, underlying, managed_pnl, managed_closed,
       actual_pnl, truncated, source_boot_id, updated_at
from public.shadow_management_state
order by updated_at desc;
```

Acceptance gates:

- latest run has the expected version/SHA and a fresh heartbeat;
- one current run remains open;
- normal deploy predecessors read `superseded_deploy`, not `abrupt_or_unknown`;
- a management shadow row survives a controlled worker restart;
- restored simulations log `mgmt-shadow: restored N durable simulation(s)`;
- no order, fill, position, channel configuration, or fund-state row is mutated by this feature.

## Known boundary

Ride-to-close manual-override tracking remains in memory. Phase 1B persists the
managed scale/breakeven/trail counterfactual first because its current evidence
was invalid across restarts. The ride ledger can be folded into the same durable
framework later without delaying this correction.
