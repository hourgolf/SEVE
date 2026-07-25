# Exact persistence migration review — 2026-07-24

Status: **REVIEWED · DO NOT APPLY**

Scope:

- `20260717210403_gate2_vb_exact_candidate_receipts.sql`
- `20260723233555_prospect_evidence_receipts.sql`

No migration was applied and no production database write was performed.

## Decision

The candidate and exact-path migration is structurally close. The follow-on
exact-manager migration is not yet sufficient for SEVE's fail-closed evidence
standard. Keep both migrations unapplied until the two blocking invariants below
are represented in SQL and their payload/schema tests are extended.

## Confirmed strengths

- Both migrations are additive and transaction-wrapped.
- Lock and statement timeouts are bounded.
- All three tables explicitly enable RLS.
- `anon` receives no access.
- `authenticated` receives SELECT only, gated by the immutable
  `app_metadata.seve_role = operator` claim.
- `service_role` receives SELECT and INSERT only. UPDATE and DELETE remain
  revoked, matching the append-only claim.
- Candidate identity, source clocks, exact-contract shape, content hashes,
  exact basis, and research-only/order-disabled claims are constrained.
- Foreign keys default to restrictive deletion behavior.
- Session/channel, epoch, contract, completion, and exact-path lookup indexes
  match the expected bounded reads.
- TypeScript payload keys match the proposed SQL columns:
  - VB candidate/exact-path contract self-test: 39/39 pass.
  - exact-manager persistence contract self-test: 9/9 pass.

Supabase's current guidance treats grants and RLS as separate required layers
for exposed schemas. The migrations correctly include both:

- <https://supabase.com/docs/guides/api/securing-your-api>
- <https://supabase.com/docs/guides/database/postgres/row-level-security>

## Blocking findings

### B-01 · Exact manager censors are not durable

`vb_exact_manager_path_receipts` can store only completed manager paths with a
positive `exit_bid`. The exact replay model also produces explicit manager-arm
censors such as `no_executable_exit_bid`, but the migration has no table or
row shape for them.

After persistence, a missing manager row would therefore be ambiguous:

- not evaluated,
- still pending,
- failed to write, or
- truthfully censored.

That violates SEVE's rule that absent evidence must not be promoted into a
result or silently discarded.

Required before application:

1. Add an append-only `vb_exact_manager_path_censors` receipt table, or use a
   single terminal-receipt table with mutually exclusive completed/censored
   states.
2. Bind each censor to candidate, opportunity, exact-path receipt, manager,
   manager-policy version, replay version, censor code, and observed clock.
3. Enforce one terminal state per expected manager arm.
4. Extend the completeness and SQL-contract self-tests to prove:
   `completed + censored = expected`, with neither overlap nor absence.

### B-02 · Candidate/exact-path identity is guarded only in TypeScript

The application helper rejects a manager payload when its candidate and
opportunity do not match the supplied exact-path receipt. The database does
not enforce that triad.

Today, SQL separately proves:

- `(candidate_id, opportunity_id)` exists in `vb_candidate_receipts`, and
- `exact_path_receipt_id` exists in `vb_exact_path_receipts`.

It does not prove that the referenced exact-path row belongs to the same
candidate/opportunity. A service-role bug or direct SQL insert could link a
manager result to the wrong exact object while satisfying both foreign keys.

Required before application:

1. Add a unique key on
   `(id, candidate_id, opportunity_id)` in `vb_exact_path_receipts`.
2. Replace the single-column exact-path foreign key with:

   ```sql
   foreign key (exact_path_receipt_id, candidate_id, opportunity_id)
     references public.vb_exact_path_receipts
       (id, candidate_id, opportunity_id)
   ```

3. Add a negative self-test that proves a cross-candidate exact-path link is
   rejected by the SQL contract, not merely by the payload builder.

## Hardening before approval

These are not blockers if their contracts are made explicit, but they should be
resolved in the same review:

- Include `manager_policy_version` in the natural uniqueness constraint, or
  document and test the invariant that every policy change must also change
  `replay_version`.
- Add a write-path test using deterministic IDs and duplicate inserts so retry
  behavior is proven idempotent.
- Record the expected query used to reconcile every candidate to its exact path
  and every expected manager arm to exactly one terminal receipt.
- Define a backout boundary:
  - before any writes, rollback is table removal;
  - after receipts exist, preserve evidence and ship a forward migration rather
    than deleting history.
- Run Supabase database/security advisors immediately before any future apply.

## Application gate

Do not apply until all are true:

- B-01 and B-02 are fixed in SQL.
- Updated schema-contract and completeness tests pass.
- A service-role writer exists and has an idempotent dry-run receipt.
- Operator-read queries are verified against an isolated environment.
- Database/security advisors are clean or every warning is dispositioned.
- The operator separately authorizes the production migration.
