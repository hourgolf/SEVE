# Phase 1C — observed policy epochs and position plans

Status: implementation branch. Dark/unwired. No live policy changes.

## Outcome

For each unblocked, positive-quantity entry that reaches the existing stream
executor boundary, the worker now prepares two immutable evidence records:

1. a deterministic `policy_epochs` row containing the resolved account, worker
   release, alpha/config snapshot, manager snapshot, and provenance bases;
2. a deterministic `position_plans` row describing the accepted initial
   allocation in `mode='observe'`.

The opportunity id is also copied into the existing signal rationale and the
position's entry features when a fill creates a row. This gives analysis a
durable join key without making the plan authoritative.

## Hard boundaries

- No plan is read by `decide`, `executeEntry`, `executeAdd`, any exit path, or
  the risk sweep.
- Evidence persistence is serialized in a best-effort queue and is never
  awaited by the order path.
- A missing table, rejected promise, Supabase error, or malformed draft can
  only lose evidence. It cannot suppress, resize, delay, or create an order.
- Blocked entries, zero-size entries, stale-bar decisions, manage-only
  accounts, and unresolved synthetic routing identities do not produce plans.
- Existing tables and RLS from Phase 1B are reused; Phase 1C has no migration.
- All records remain `observe`. Promotion to `assist` or `auto` is a later,
  explicit allocator/risk-service decision.

## Honest modeling boundary

`PositionPlanV1` captures the accepted **initial** allocation. Its
`maxRiskUsd` is the full long-option debit—the actual bounded maximum loss—not
the smaller modeled stop loss. The stop-budget estimate is separately labeled
inside the epoch provenance.

Today's pyramid quantity is quote-dependent and re-sized at each continuation.
It cannot truthfully be represented as fixed favorable-R add stages at entry.
Therefore:

- `plan_json.adds = []` and `maxTotalQuantity = entry.quantity` for the observed
  initial plan;
- the exact current pyramid switch/cap is preserved in
  `policy_json.manager`;
- `policy_json.dynamicAdds.capturedInEpochOnly = true` explains the boundary.

This is deliberately incomplete rather than fabricated. Before plans can
govern execution, the contract needs a new version for allocator-approved,
quote-dependent earned-conviction adds.

## Identity and idempotency

- Built-in channel versions include `WORKER_VERSION`, because those strategies
  do not expose an independent semantic code version. This over-segments
  evidence rather than pooling across an unnamed code change.
- Manager versions hash the exact channel manager overrides and compiled-spec
  management payload.
- Epoch ids hash strategist + resolved account + worker + channel + manager +
  policy snapshot.
- Opportunity ids hash strategist + resolved account + OCC + direction +
  reason + source-bar timestamp.
- Plan ids derive from opportunity ids.

All ids are deterministic UUIDs. Database uniqueness makes process restarts and
same-bar retries idempotent; in-memory pending/success sets avoid redundant
requests while still allowing retry after a failed write.

## Verification gates

Before review:

```bash
npm run runner-selftest
npm run position-plan-selftest
npx tsc --noEmit -p worker/tsconfig.json
npx tsc --noEmit
npm run build
```

Expected worker suite: 122/122 or greater, including deterministic identities,
resolved-account stamping, full-debit risk, manager/worker version boundaries,
deep freeze, blocked-decision rejection, and no synthetic-account evidence.

After a paper session and before any later enforcement work:

```sql
select id, channel_slug, channel_version, manager_id, manager_version,
       account_id, mode, created_by_boot_id, created_at
from public.policy_epochs
order by created_at desc
limit 20;

select id, opportunity_id, policy_epoch_id, strategist_id, account_id,
       position_id, state, plan_json, created_at
from public.position_plans
order by created_at desc
limit 20;
```

Acceptance:

- every row is `mode='observe'` / `state='planned'`;
- repeated handling of one source-bar opportunity creates one row;
- account ids match resolved routing accounts, never `__default__` or an
  unresolved placeholder;
- `policy_epoch_id` resolves and identity fields agree with the relational
  columns;
- no entry, order, fill, position quantity, channel config, or fund-state value
  differs because evidence persistence succeeds or fails.

