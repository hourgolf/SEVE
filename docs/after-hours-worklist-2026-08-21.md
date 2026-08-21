# SEVE after-hours worklist — 2026-08-21

## 1. Prevent local experiments from impersonating production readiness

- The deployed commit and production System surface agree: the receipt-bound topology, all three paper accounts, worker health, flat books, and zero open orders passed.
- The apparent 13-mismatch `NO-GO` came from running the canonical command against locally modified authority files; it was not a production failure.
- Add a source-purity guard before any broker or database observation so a dirty local authority file produces an explicit provenance error instead of a false production verdict.
- Keep the clean deployed-commit procedure as the authoritative production check and cover dirty/clean path handling with deterministic selftests.

## 2. Reconcile stale manager-shadow runs

- Audit and repair the 21 `manager_shadow_runs` rows that remained `active` while all broker and desk books were flat.
- The bounded repair updated only `manager_shadow_runs`, inserted no events, and verified 21/21 readbacks.
- Fix complete durable hydration after the table exceeded Supabase's default 1,000-row response cap.
- Add automated session-boundary failure reporting and a dashboard data-quality check so expired observers cannot remain invisible.

## Boundaries

No broker orders, positions, accounts, routing, roster, sizing, channel managers, channel configuration, or trading economics changed.
