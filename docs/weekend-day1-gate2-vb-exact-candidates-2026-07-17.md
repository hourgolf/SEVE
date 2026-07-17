# Weekend Day 1 — Gate 2 exact VB candidate extension

Status: **local implementation complete; migration, R2 publication, and deployment not authorized**.

This extends the existing `signals` → `gate-shadow` → `virtual_trades` lane. It does not create another
shadow fleet, does not read from an order path, and cannot authorize a strategy or policy change.

## Provenance decision

The existing worker has the exact source-bar clock in `ExecCtx.decisionAtMs`, but historical blocked
signals did not persist it. `signals.created_at` is an insert clock and is not substituted. Existing rows
without the new stamps are therefore censored.

Future signal rationale now records:

- exact `decision_source_bar_at`;
- channel and manager versions;
- an account-independent configuration epoch plus the account-bearing policy epoch;
- underlying, option side, OCC, and worker version.

The canonical candidate identity is a deterministic function of channel version, exact source clock,
underlying, option side, OCC, and configuration epoch. Account remains provenance and is excluded from
market-opportunity identity. The existing accepted-position opportunity identity remains unchanged.

## Re-entry and exact-path contract

The existing sequential VB walk remains canonical. Per-minute repeats while the prior virtual position is
open are coalesced. A later signal at or after the prior exit receives a deterministic re-entry ordinal and
a distinct opportunity ID. Ordinals reset by ET session and candidate lane.

Exact paths are `OPRA.PILLAR` / `cbbo-1s`, content addressed by compressed SHA-256, and intended for the
existing T+1 Databento adapter. The scorecard requires a verified checksum, valid exact OCC, strictly
ordered positive executable bids, a candidate-time executable ask, and exact candidate/opportunity joins.
Missing or invalid evidence is censored. It is never replaced with `option_quotes`, a snapshot, a mid, or
the synthetic VB result.

Manager replay uses the preregistered manager suite and candidate-time executable ask to executable bid.
The native mid-based result remains separately labeled `native_mid_synthetic_development_only`.

## Local changes

- `lib/research/vbCandidateEvidence.ts`: pure identity, coalescing, content-addressing, censor, and manager
  scorecard model;
- `scripts/gate-shadow.ts`: emits `data/vb-candidates.json` and `data/vb-candidate-censors.json` beside the
  existing ledger; legacy rows fail closed; `--read-only` disables every external write branch even when
  the process authenticates with a backend credential;
- `worker/src/execute.ts` and `worker/src/planShadowModel.ts`: future provenance stamps and a reusable,
  account-independent configuration identity;
- `supabase/migrations/20260717210403_gate2_vb_exact_candidate_receipts.sql`: review-only compact receipt
  schema with RLS and least-privilege grants. It has not been applied.

## Verification

- root TypeScript: pass;
- VB candidate evidence: 22/22 pass;
- runner self-test: 148/148 pass;
- enforced read-only live adapter smoke: 139 reconstructed rows, zero external writes, zero exact receipts,
  and 136 legacy candidate censors as expected because July 17 signals predate the exact provenance stamps;
- migration: generated with `supabase migration new`; not applied and therefore advisors/runtime insert
  verification remain blocked pending operator authorization.

## Operator-review boundary

Before this can publish exact path receipts, an operator must review and authorize the migration. After
authorization, the required order is: flat paper/broker reconciliation, apply migration, run Supabase
security/performance advisors, verify RLS/grants and append-only inserts, then separately review any worker
deployment. No R2 object or Supabase row was written during this implementation.
