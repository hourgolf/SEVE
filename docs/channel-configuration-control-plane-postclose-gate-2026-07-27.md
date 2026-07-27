# Channel configuration control plane — post-close Gate 0 packet

Date: 2026-07-27
Status: **READ-ONLY GATE 0 PASSED AT 14:38 PDT — NO PRODUCTION AUTHORITY**

This packet is the first step after the market is confirmed closed. Passing it
does not authorize a migration, deployment, configuration change, activation,
order, or trade.

## Run contract

From the repository root, preview the packet without executing any check:

```bash
npm run channel-control-plane-postclose-gate
```

After an operator has independently confirmed the market is closed, execute the
local tests and external SELECT/GET checks with an explicit environment file:

```bash
npm run channel-control-plane-postclose-gate -- \
  --run-read-only \
  --ack-market-closed \
  --env-file /absolute/path/to/.env.local
```

The acknowledgement is intentionally manual. Wall-clock time alone does not
prove a market session has ended on holidays or early-close days.

## What it proves

1. The disabled compiler/contracts and negative fail-closed checks pass.
2. Current RC5.4 manager and release contracts still pass.
3. The exact RC5.4 composite replay still passes.
4. Current database rows produce the checked-in RC5.4 binding and identity seal.
5. Every bound paper broker and desk book is reconciled and flat, and runtime
   liveness checks pass.

## July 27 execution receipt

The packet was executed after the dashboard and operator independently showed
the regular session closed. The first run correctly stopped because the legacy
readiness subprocess selected the older RC5.3 Day 1 receipt instead of the
current RC5.4 receipt. That was a local reader-scope defect, not a broker,
worker, release, or capture failure.

The local correction keeps the responsibilities separate:

- `rc54-release-bindings.ts` owns the current nine-root RC5.4 database binding
  and identity seal;
- `preopen-readiness.ts --require-flat --broker-runtime-only` owns only the
  paper host, fund boundary, worker liveness, and broker/desk flatness;
- the OPS evidence model binds an entry fill only to `position_opened`, never a
  later `position_remainder_opened` runner row.

The corrected full packet passed:

- control-plane compiler/contracts: 22/22, manifest
  `sha256:ee6901d6ee2a4d975c994d41dac782f9dab35d424ee2258aed70347363be2467`;
- RC5.4 manager contract: 35/35;
- RC5.4 release contract: 27/27;
- RC5.4 composite replay: 12/12;
- production fleet: 68 rows, nine exact RC5.4 roots, identity errors zero;
- release configuration:
  `a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227`;
- worker runtime: `stream-runtime-2026-07-27a`, clean and fresh;
- FIRST-TEAM, LAB, and MORGUE: reachable, distinct, broker 0 / desk 0 OCCs;
- fund and broker boundary: paper, not halted, paper Alpaca host.

`origin/main` remained
`c256effa516384b047fc930fea6cdd2120d5ad4e` at the read-only remote check.

### Capture-panel finding

The screenshot's `5/8` capture and `40/64` manager states were false negatives
in the dashboard read model:

1. `orb-ustop-ctl`, `orb-qqq-trail`, and `vb-macd-state` each created a
   one-contract runner row after a target tranche.
2. The outcome list placed `position_remainder_opened` after
   `position_opened`, so the opportunity map overwrote each primary entry
   position with its runner row.
3. Manager arms correctly remain attached to the original entry position, so
   the remap hid exactly 24 arms and rendered `40/64`.
4. The capture hook loads the newest 1,000 session receipts. The three
   short-lived runner receipts had aged out of that window, producing `5/8`.

Direct SELECT-only evidence for the eight original entry positions showed:

- 1,777 immutable receipt rows;
- 15,637 samples;
- eight of eight entry positions receipted;
- 64/64 distinct manager arms observing;
- zero dropped samples;
- zero provider-request failures;
- zero July 27 held-capture health rows.

No capture backfill or production-data repair is required. The local dashboard
correction is not deployed.

## Remaining limitation and stop condition

The existing `preopen-readiness.ts` still imports the older Day 1 sealed-root
roster. Gate 0 therefore runs its explicit `--broker-runtime-only` mode and
requires the separate RC5.4 binding/identity check immediately before it.
Neither subprocess alone is complete release evidence.

The proposed migration also intentionally blocks the first active control-plane
bootstrap: new specs and manifests must be inserted as drafts, while an
activation receipt requires an already-active base spec. Do not bypass this.
The initial no-change RC5.4 bootstrap needs a separately reviewed, one-time
procedure with exact hashes, flat-book proof, rollback, and operator authority.

## Local migration and draft-bootstrap validation

The unapplied migration was executed against an isolated PostgreSQL 17 PGlite
database after creating only the prerequisite table/role shapes. The test also
ran the generated no-change RC5.4 draft bootstrap. Final result: **17/17
checks passed**.

The review found and corrected these pre-PR defects:

1. five newly introduced foreign keys lacked covering indexes;
2. scheduled manifests could still accept new membership rows;
3. an approved proposal could insert a receipt while
   `activation_authorized=false`;
4. the SQL spec shape omitted `family_id`, `cohort`, and `priority`, which are
   part of the compiler content hash;
5. compiler version keys such as `spec:rc54:pb-ride` needed immutable external
   keys alongside internal UUID relational IDs.

The final isolated receipt proves:

- migration SQL executes on PostgreSQL 17;
- all five control-plane tables have RLS and least-privilege grants;
- anonymous reads are denied and non-operator authenticated reads are censored;
- existing evidence rows retain null control-plane references;
- semantic mutations, unreceipted activation, unauthorized receipt insertion,
  and late manifest membership fail closed;
- every newly introduced foreign key has a covering index;
- the bootstrap writes nine draft specs, one draft manifest, and nine exact
  memberships;
- the database-shaped rows reconstruct manifest
  `sha256:ee6901d6ee2a4d975c994d41dac782f9dab35d424ee2258aed70347363be2467`;
- no proposal, activation receipt, active status, runtime reader, or hosted
  state is created.

Current production advisors were read as a pre-migration baseline only. Their
warnings concern existing objects and are not attributable to this unapplied
schema. A hosted post-DDL advisor comparison still requires either a separately
approved Supabase development branch or the separately approved migration
window.

Applying the migration, running the generated bootstrap against Supabase,
wiring runtime readers, changing a hosted flag, deploying, or activating
remains a separate explicitly authorized action.
