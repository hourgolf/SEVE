# Phase 1E — Paper outcome chain

Status: contract design on `phase1e-outcome-chain`. Shadow-only; no evidence row is read by entry, sizing, order placement, or position management.

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

Every event carries `plan_id`, `opportunity_id`, `policy_epoch_id`, `strategist_id`, `account_id`, `position_id`, optional `parent_position_id`, `source_boot_id`, event time, and a versioned JSON payload. No event is updated or deleted.

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

