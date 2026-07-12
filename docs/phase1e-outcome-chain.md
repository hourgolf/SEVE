# Phase 1E — Paper outcome chain

Status: implemented and verified on `phase1e-outcome-chain`; migration unapplied and worker undeployed pending review. Shadow-only; no evidence row is read by entry, sizing, order placement, or position management.

## Objective

Complete a queryable, restart-safe chain from candidate opportunity to accepted plan, broker result, desk position lineage, and final booking/reconciliation outcome. This phase measures the existing paper system; it does not promote a channel or change how any trade is managed.

## Load-bearing modeling rule

`position_plans.position_id` is not sufficient as the complete outcome model. A partial fill, tranche, runner, or partial-exit remainder can turn one accepted opportunity into multiple desk rows. Treating the first closed row as the completed plan would truncate the continuing exposure and corrupt channel results.

Phase 1E therefore uses append-only lineage/outcome events. One plan may reference several position rows, while every event retains the root opportunity and policy epoch.

## Event contract

The next migration adds an append-only `position_outcome_events` relation with deterministic ids and these event classes:

- `position_opened`: a successfully inserted desk row linked to the accepted opportunity/plan;
- `position_remainder_opened`: a runner or unsold partial-exit remainder linked to its parent row;
- `position_booked`: a status-guarded close with quantity, entry basis, exit price, realized P&L, and machine/manual close reason;
- `reconciliation_unresolved`: the row remains open because no defensible exit price exists;
- `reconciliation_estimated`: a booking used an explicit estimate and requires later verification;
- `reconciliation_verified`: later broker truth confirms or corrects an estimated booking.

Every event carries deterministic `plan_id`/`opportunity_id`, `position_id`, optional `parent_position_id`, `source_boot_id`, event time, and a versioned JSON payload. No event is updated or deleted. `plan_id` is indexed but intentionally not a foreign key: plan and outcome evidence use independent best-effort queues and may arrive in either order.

## State projection

Plan state is a derived projection, not execution input:

- `planned`: no successfully inserted root position;
- `active`: at least one linked lineage row remains open;
- `complete`: all known lineage rows are booked and no unresolved reconciliation remains;
- `canceled`: accepted opportunity produced no fill and its broker order reached a terminal zero-fill state.

The worker may maintain the existing convenience columns on `position_plans` only after the append-only event is durable. Analysis must be reproducible from events alone.

## Safety and acceptance

- Writes run through the existing serialized best-effort evidence queue and are never awaited by an order path.
- Deterministic ids make retries, restarts, and late-fill recovery idempotent.
- A database failure can lose evidence only; it cannot suppress, resize, delay, create, close, or reconcile a position.
- Parent/remainder quantities must conserve the filled quantity.
- A plan cannot project `complete` while any linked remainder is open or any unresolved reconciliation is outstanding.
- Manual closes retain the operator reason tag and remain distinguishable from policy exits.
- All evidence remains paper-only and `mode='observe'`.

## Build order

1. Add pure lineage/outcome builders and adversarial self-tests.
2. Add the append-only migration with service-role insert/select and operator read-only access.
3. Return inserted position ids without changing current error handling.
4. Emit root-open, remainder-open, booking, and reconciliation events at existing successful write boundaries.
5. Add a read-only projection/query and compare it with current desk rows before any dashboard work.

## Implemented slice

- Shared deterministic identity and outcome builders are usable by both the worker and the authenticated manual-close route.
- Position inserts now return the inserted row id while preserving their existing explicit error result.
- Root fills, late-fill bookings, partial remainders, runners, ordinary exits, reconciliations, unresolved-price cases, estimated bookings, manual closes, and manual reason tags emit evidence only after their corresponding durable desk-row write succeeds.
- `entry_features.opportunity_id` survives worker reloads and is copied into remainder rows, preserving lineage across restarts and row splits.
- Manual close/tag updates now verify that their status-guarded update actually changed a row before emitting evidence.
- The migration uses explicit grants, RLS, an app-metadata operator policy, and indexes for every foreign key and analytical join. Deterministic `plan_id` remains deliberately unconstrained to avoid cross-queue arrival-order loss.

Verification: worker typecheck clean; application typecheck clean; production build clean; runner self-test 141/141; position-plan 7/7; Phase 1D market-truth 4/4; manual-close 6/6. Remote prerequisite inspection confirmed `positions`, `position_plans`, `worker_runs`, `positions.entry_features`, and `positions.runner_of` exist. The migration has not been applied.
