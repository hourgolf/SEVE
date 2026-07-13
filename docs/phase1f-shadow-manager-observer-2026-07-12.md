# Phase 1F — dark manager observer

Status: built on `research-databento-backfill-v2`; not merged or deployed.

## Purpose

Measure exit managers independently over the same paper entries without changing
an order, an open position, channel sizing, or the active manager. The observer
runs only inside the worker's existing executable-bid sweep (about 10 seconds).

The shared causal policy is `engine/managerPolicy.ts`. The retrospective manager
lab and forward observer therefore use the same eight registered definitions:

- LOCK20/30, LOCK30/30, LOCK50/30, WIDE20/50
- BANK20/RUN50, ARM20/HALF-GIVEBACK
- BELL/-30 and BELL/no-stop controls

## Evidence contract

- Cohort: positions opened on or after `2026-07-13 00:00 America/New_York`.
- Basis: fresh executable option bid, never mid.
- Storage: the existing append-only `execution_observations` table.
- Shape: `event_kind=decision`, `action=exit`,
  `blocked_reason=observation_only`, and `payload.shadowOnly=true`.
- Identity: deterministic by position ID + manager ID + policy version. Trigger
  time and reason are excluded, so the first successful insert wins across
  retries and restarts.
- Fail posture: persistence is serialized and best-effort off the order path.
  A failure can lose evidence; it cannot block, delay, resize, or create an order.

No migration is required. The production table contract was checked read-only;
the table exists and its action constraint intentionally remains unchanged.

## Restart behavior

LOCK managers need no state. BANK and ARM recover their armed state from the
position's durable bid-side `peak_mark`. Because that peak cannot reconstruct
the first +20 crossing's exact overshoot, a recovered bank uses the registered
+20 threshold and records `managerState.recovered=true`. Analysis must keep
recovered and fully observed bank outcomes distinguishable.

## Important censoring boundary

This first forward slice observes a counterfactual only while the real position
row remains open. If the active manager/operator closes first, any alternative
that would have held longer is **right-censored**, not a loss, win, or completed
manager outcome. Phase 1E's actual-close lineage supplies the censor timestamp.

The frozen Databento corpus remains the correct source for complete post-entry
paths and apples-to-apples historical manager comparisons. A future extension
may keep polling closed contracts in a dedicated shadow book, but it must add
durable state before its output can survive worker restarts without bias.

## Deployment gate

1. `runner-selftest` passes.
2. `manager-lab-selftest` passes (shared-policy parity).
3. `manager-shadow-selftest` passes (causality, restart identity, cohort gate).
4. Worker and root TypeScript checks pass.
5. Merge to `main`, then manually deploy Railway service
   `enchanting-appreciation` (auto-deploy is disabled).
6. Verify `worker_runs.worker_version = stream-2026-07-12f` and observe only
   `observation_only` manager receipts after a qualifying Monday paper entry.

