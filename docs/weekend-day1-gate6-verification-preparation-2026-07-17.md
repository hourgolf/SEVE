# Weekend Day 1 — corrected Gate 6 verification preparation

Status: **correction-pass local verification green; migration, configuration, roster finalization, Day 1
seal, merge, push, and deployment stopped for operator review**.

## Gate 0 preservation

The machine receipt remains byte-identical to commit `746407a`:
SHA-256 `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`.

## Checks rerun after corrections

- root `tsc --noEmit`: pass;
- worker `tsc --noEmit`: pass;
- Next.js production build: pass, including type validation and all static/dynamic route generation;
- held-contract capture: 86/86 pass;
- VB candidate exact evidence: 35/35 pass;
- deterministic Gate 2 exact dry-run: pass, `externalWrites=false`;
- checksum-verified July 15 Databento object dry-run: 555,969 parsed rows, 8/8 manager arms,
  `externalWrites=false`;
- new prospective versioned and duplicate-safe scorer: 25/25 pass;
- legacy family scorer: 19/19 pass, unchanged;
- Databento exact path and persisted-object parser: 19/19 pass;
- Day 1 canonical receipt model: 5/5 pass; no receipt rendered or sealed;
- runner: 148/148 pass;
- manager shadow: 17/17 pass;
- manager shadow book: 149/149 pass;
- family admission: 13/13 pass;
- session exit replay: 6/6 pass;
- channel contract: 60/60 pass;
- current channel inventory: 25/25 pass;
- family preregistration: 15/15 pass;
- market calendar: 16/16 pass;
- `git diff --check`: clean after the documentation correction; the earlier inaccurate claim is superseded.

The adversarial matrix covers sustained R2 and Supabase-receipt outages, combined open/sealed sample and
byte bounds, retry backoff and exhaustion, never-resolving R2 and Supabase adapters, multi-segment shutdown,
left/right path boundaries, internal gaps, invalid and wrong-contract Databento quotes, stale/unproven live
asks, approximate contracts, exact SQL/payload field alignment, prospective version separation, exact and
conflicting duplicate ingestion, siblings sharing one clock, invalid dates, and the zero-delta denominator.

## Deliberately not performed

- no migration applied and no Supabase advisor/runtime-insert claim;
- no Supabase or R2 object, manifest, candidate, exact-path, or receipt written;
- no strategy, lifecycle, risk, stop, target, manager, family, collision, or roster setting changed;
- no order placed or closed;
- no Monday roster finalized and no Day 1 receipt sealed;
- no merge, push, Vercel deployment, or Railway deployment;
- no rehearsal against an unratified configuration.

## Remaining review sequence

1. Choose Gate 1's 24/120 or recommended 12/60 batching window and accept its loss exposure, or require
   durable staging; separately ratify state/retry bounds.
2. Review Gate 2's unapplied SQL and zero-write adapter. Migration, advisors, RLS/grant insert checks, and
   R2 publication remain later, separately authorized actions.
3. Ratify or revise every Gate 4 root, debit/contract/stop/EOD bound, manager arm, dark sibling, max-open
   rule, and SPY collision rule.
4. Freeze exact channel/manager/configuration identities and evidence floors into the new prospective
   scorer contract.
5. Only then render and review a canonical Gate 5 receipt. Sealing is a separate stop point before any
   configuration application.
6. Re-run this matrix and flat broker/desk reconciliation after any approved change. Merge, push, and each
   manual deployment remain separate explicit approvals.
