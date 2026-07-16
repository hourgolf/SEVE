# Session evidence correctness implementation — 2026-07-16

## Status

Review branch only. Production, Supabase, Railway, and Vercel production have not been changed.

## What this tranche fixes

### YF-A — manager observer admission

- Enrolls a completed paper fill immediately, without waiting for an eligible quote.
- Persists admission source, admission time/delay, first eligible quote time, provider-event age, snapshot-fetch age, and an explicit evidence state.
- Reconstructs missed same-session admissions from both open and closed positions.
- Records `no_eligible_quote_before_actual_close` instead of silently losing short-lived trades.
- Keeps the observer non-executing: it cannot place, modify, or close an order.
- Leaves version-1 evidence unchanged; new observations use `manager-shadow-book-v2`.

### YF-C — closed-position truth

- Every close writer atomically sets `unrealized_pnl = 0`.
- Late mark updates are limited to rows that are still open.
- The migration backfills historical closed rows and adds a database constraint so the invariant cannot regress.

### YF-E — resilient market reads

- Removes the exact option-quote row count from the live polling path.
- Reads option snapshots, bars, and events independently, so one timeout no longer blanks the whole workspace.
- Preserves a still-fresh last-good option snapshot with a market-scoped warning.
- Keeps warnings out of mobile Book; Book position truth remains independently usable.
- Adds per-query read diagnostics for first/last failure, last success, and recovery.
- Adds the index needed for the latest-underlying option snapshot query.

## Database migrations

Apply in timestamp order:

1. `20260716204725_enforce_closed_position_unrealized_zero.sql`
2. `20260716205122_add_latest_option_quote_index.sql`
3. `20260716205844_manager_shadow_book_v2_admission_provenance.sql`

The migrations are required before deploying the worker changes. They have not been applied to production from this branch.

## Safe rollout order

1. Review the code and preview UI.
2. Apply the three Supabase migrations after confirming the market is closed and no paper position is open.
3. Run Supabase security and performance advisors; investigate any new finding.
4. Deploy the Railway worker from the reviewed commit and confirm a fresh run ledger/heartbeat.
5. Deploy the Vercel web build.
6. Run read-only smoke checks: auth, paper-only mode, position reconciliation, market snapshot, mobile Book, incident state, and manager-v2 admission receipts.
7. During the next paper session, verify one opened-and-closed trade produces both a v2 admission row and an actual-close attachment without affecting execution.

## Verification

- Root TypeScript: clean.
- Worker TypeScript: clean.
- Production web build: clean.
- Runner self-test: 146/146.
- Manager shadow-book self-test: 149/149.
- Closed-position invariant self-test: 8/8.
- Manager shadow self-test: 17/17.
- Incident self-test: 59/59.
- Manual-close self-test: 8/8.
- Market-calendar self-test: pass.

## Explicit non-goals

- No strategy rule, channel configuration, order sizing, or exit policy changed.
- No live-trading authority was added; the desk remains paper-only.
- No statement-timeout increase or approximate market snapshot was introduced.
- Phase 1K-D findings do not authorize policy or production changes.
