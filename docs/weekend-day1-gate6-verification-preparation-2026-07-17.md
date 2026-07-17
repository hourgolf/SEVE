# Weekend Day 1 — corrected Gate 6 verification preparation

Status: **operator-ratified local release-candidate verification green; receipt seal is the next isolated
commit. Migration, configuration application, merge, push, and deployment remain stopped**.

## Gate 0 preservation

The machine receipt remains byte-identical to commit `746407a`:
SHA-256 `967f342378922b4e8c12e1d9bef01739bde40ae014cb54dd65c56cc021c7f819`.

## Checks rerun after corrections

- root `tsc --noEmit`: pass;
- worker `tsc --noEmit`: pass;
- Next.js production build: pass, including type validation and all static/dynamic route generation;
- held-contract capture: 92/92 pass, including the in-flight high-water follow-up race;
- VB candidate exact evidence: 35/35 pass;
- deterministic Gate 2 exact dry-run: pass, `externalWrites=false`;
- checksum-verified July 15 Databento object dry-run: 555,969 parsed rows, 8/8 manager arms,
  `externalWrites=false`;
- prospective versioned, opportunity-clustered, duplicate-safe scorer: 41/41 pass;
- legacy family scorer: 19/19 pass, unchanged;
- Databento exact path and persisted-object parser: 19/19 pass;
- Day 1 canonical receipt model and zero-mutation renderer guard: 7/7 pass;
- Day 1 release policy/admission/lifecycle: 33/33 pass;
- SELECT-only 68-channel release receipt validation: pass; two SELECTs, zero external writes, no local
  receipt output during the preflight;
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
samples arriving above high water during an in-flight flush and prompt follow-up drain,
left/right path boundaries, internal gaps, invalid and wrong-contract Databento quotes, stale/unproven live
asks, approximate contracts, exact SQL/payload field alignment, prospective version separation, exact and
conflicting duplicate ingestion, siblings sharing one clock, opportunity-cluster invariants, the independent
10-clock/five-session evidence floor, the unweighted-portfolio prohibition, invalid dates, and the zero-delta
denominator.

## Deliberately not performed

- no migration applied and no Supabase advisor/runtime-insert claim;
- no Supabase or R2 object, manifest, candidate, exact-path, or receipt written;
- no external strategy, lifecycle, risk, stop, target, manager, family, collision, or roster setting changed;
- no order placed or closed;
- no Day 1 receipt sealed in this verification/documentation commit;
- no merge, push, Vercel deployment, or Railway deployment;
- no rehearsal against an unratified configuration.

## Remaining release sequence

1. Commit the verified scorer/documentation and SELECT-only receipt renderer.
2. Re-run the renderer against the unchanged 68-channel paper inventory, write only the local canonical
   receipt, verify its embedded content SHA and file SHA, and commit it alone.
3. Stop. Gate 2 migration remains design-approved and unapplied before T+1. Any configuration application,
   merge, push, broker/desk reconciliation, or Railway/Vercel deployment is a separate operator action.
4. A later deployment must re-run this matrix and the flat broker/desk gate, require the sealed identities,
   observe the active-settings startup receipt, and abort on any mismatch.
