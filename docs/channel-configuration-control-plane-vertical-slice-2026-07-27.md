# Channel configuration control plane — disabled vertical slice

Date: 2026-07-27
Status: **LOCAL DESIGN + DISABLED PLUMBING ONLY — NO PRODUCTION AUTHORITY**

This document is the required source-of-truth inventory and implementation plan
for the first channel-configuration control-plane slice. It does not authorize a
roster, account, quantity, entry, exit, risk, collision, re-entry, scaling,
environment, migration, deployment, order, or active-release change.

## Confirmed baseline

- `origin/main` and the pre-work local `HEAD` were both
  `c256effa516384b047fc930fea6cdd2120d5ad4e` after a fresh fetch.
- Work is isolated on local branch `codex/channel-config-control-plane`.
- The worktree was clean before the branch was created.
- The hosted Vercel surface returned HTTP 200 and its deployed application
  bundle contained release `week2-2026-07-27-rc5.4`, worker version
  `stream-2026-07-27a`, and configuration hash
  `a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227`.
- The Railway runtime environment, deployment SHA, and current execution flags
  were not independently observable from this checkout. `worker/Dockerfile`
  defaults and repository documentation are not hosted-runtime proof.
- Before implementation, current behavior passed:
  - RC5.4 manager policy: 35/35;
  - RC5.4 release policy: 27/27;
  - RC5.4 composite replay: 12/12;
  - channel passport RC5.3 + RC5.4 contract suite;
  - inert channel draft: 21/21.

## Confirmed source-of-truth map

| Concern | Current authorities and mirrors | Confirmed readers | Confirmed writers / mutation seams | Control-plane disposition |
| --- | --- | --- | --- | --- |
| Channel identity and roster | `worker/src/rc54ReleasePolicy.ts` owns the executable nine-root overlay and identity seal; `lib/channels/activeRelease.ts` independently restates the nine dashboard roots; `strategists` is the persisted 68-channel source fleet | worker startup and decision path in `worker/src/index.ts` and `worker/src/decide.ts`; dashboard passports and readiness; binding scripts | code release for both mirrors; `hooks/useDeskWrite.ts` can mutate persisted strategist lifecycle/config outside sealed-root controls | **Rewrite** into immutable spec versions plus one manifest; keep current overlay active until an authorized cutover |
| Account routing | Root `accountId` values are duplicated in worker and dashboard; persisted `strategists.account_id` and `accounts` are checked at worker startup; credential routing remains environment-derived | RC5.4 startup validation, broker routing, dashboard passport | strategist/account tables, environment credentials, release code | **Generate** routing projections; retain environment credential resolution as an independent hosted gate |
| Quantity and risk | Worker root quantity, premium/debit caps, derived 30% risk budget, dashboard equivalents, and legacy `strategist_config` fields coexist | worker overlay/admission, dashboard, readiness and research scripts | legacy config write hook and code release | **Generate** worker/dashboard values from spec; bounds stay validator-owned; no direct active-row edit |
| Entry and exit parameters | Entry DTE/strike and manager profile selection live in the worker release; manager mechanics live in `rc54ManagerPolicy.ts`; dashboard restates labels and effective values; persisted config can differ intentionally | worker execution/mark refresh, dashboard, replay/research | code release or legacy config writer | **Keep** manager execution logic; **generate** profile references and presentation projection from spec |
| Manager policy | `rc54ManagerPolicy.ts` is executable truth; release root selects profile; dashboard independently maps profile to labels | execution path and manager tests; dashboard labels | code release only | **Keep** executable policy code for this slice; manifest pins exact manager version/profile |
| Re-entry and scaling | RC5.4 admission policy says re-entry disabled; release overlay forces `pyramid_adds=0`; manager profiles also prohibit adds | admission finalizer, overlay, tests | code release / legacy config outside sealed overlay | **Generate and validate** compatibility; missing or contradictory proof blocks |
| Collision and admission | `rc54ReleasePolicy.ts` defines two domain policies; `admissionDomainModel.ts` implements ordering/capacity/collision behavior | worker admission path and release tests | code release | **Keep** admission engine; manifest pins policy version and compiler generates its inputs |
| Release identity and checksum | Worker canonicalizes `RC54_RELEASE_CONFIGURATION`; dashboard hard-codes the resulting hash; docs and environment repeat it | startup gate, release evidence, dashboard receipt matching, readiness, binding scripts | code release plus Railway expected-hash environment | **Generate** deterministic manifest/projections; hosted expected hash remains a separate activation gate |
| Worker environment gates | `worker/src/config.ts` reads mutually exclusive Day 1/RC5.4/LAB flags and expected hash; `index.ts` enforces startup | worker boot | Railway environment only | **Keep** fail-closed gate; future manifest loader cannot bypass hosted flags |
| Dashboard projection | `activeRelease.ts` restates roots, identities, manager presentation, release/hash/version | passports, readiness, desktop/mobile inspector, local draft base | code release | **Generate** a read-only projection; do not wire it into active UI in this slice |
| Draft proposal | `channelConfigDraft.ts` and `useChannelConfigDraft.ts` hold a local React-memory patch with `activationAuthorized:false` | desktop/mobile draft panel | local React state only; no remote writer | **Reuse** inert UX and canonical review concept; replace legacy-field-only model later with versioned proposal records |
| Trade/evidence stamps | Worker computes policy identity, stamps `channel_version`, `manager_version`, `configuration_epoch_id`, `policy_epoch_id`, worker version, and release evidence into plans, signals/observations, and position entry features | execution, exact-path intake, evidence audits | worker order/evidence path | **Keep** current stamping; add nullable relational references for new rows without rewriting history |
| Database policy identity | `policy_epochs` and `position_plans` already provide immutable policy/plan attribution; newer exact-evidence tables carry SHA-256 configuration identities | worker plan shadow, research/evidence readers | service-role worker paths; migrations | **Reuse** policy epochs; add control-plane versions/manifests/proposals/receipts and optional links |

### Blunt conclusion

The current sealed behavior is safe because it is duplicated and cross-checked,
not because it has one source of truth. A small change is operationally heavy
because worker policy, dashboard projection, environment hash, receipts, tests,
and documentation must agree manually. Replacing those seams in one market-hours
change would be reckless. The minimum safe slice is a disabled compiler whose
output is compared against both live code mirrors without being consumed by
either runtime.

## Minimum vertical slice

The local slice introduces:

1. Versioned TypeScript contracts and JSON-schema-shaped runtime schemas for
   `ChannelSpecVersion`, `ReleaseManifest`, `ChannelChangeProposal`, and
   `ActivationReceipt`.
2. A deterministic canonicalizer and SHA-256 manifest compiler.
3. A frozen RC5.4 fixture that compiles worker and dashboard projections.
4. Compatibility tests proving those projections match the current RC5.4
   executable/dashboard contracts.
5. A read-only active-versus-draft preview that always reports
   `activationAuthorized:false` in this slice.
6. An unapplied migration proposal with RLS, least-privilege grants, immutable
   semantic content, audit records, and nullable new-evidence references.

The compiler is intentionally not imported by `worker/src/index.ts`,
`rc54ReleasePolicy.ts`, `activeRelease.ts`, any API route, or any Supabase write
hook. That wiring is a separate code/strategy release.

## Market-hours groundwork completed

- Added negative validation for empty evidence references, malformed entry/exit
  projection fields, premium × quantity × multiplier debit mismatches, exact
  collision priority rosters, duplicate underlying priorities, incompatible
  ratchet payloads, unknown change classes, and forbidden identity-field patches.
- Hardened the proposed migration so specs/manifests can only be inserted as
  drafts; lifecycle promotion is guarded; approved/terminal proposals freeze;
  activation receipts must match the approved proposal, active base, scheduled
  child, scheduled containing manifest, exact hashes, and passing evidence.
- Added a plan-first post-close Gate 0 runner and self-test. It performs no
  subprocesses by default and requires both `--ack-market-closed` and an
  existing absolute `--env-file` before SELECT/GET-only external checks run.
- No migration was applied, no row was seeded, no hosted configuration was
  changed, no deployment was made, and no order path was invoked.

Two blockers remain explicit:

1. The existing session-close readiness reader still imports the older Day 1
   root roster. It can prove paper broker/desk flatness and runtime liveness,
   but cannot certify RC5.4 manifest parity.
2. The hardened migration deliberately has no implicit first-active bootstrap.
   Receipt-based activation requires an already-active base spec. The initial
   local procedure now persists only exact RC5.4 **drafts** for read-only
   parity. Establishing a first active base still requires a separate reviewed
   authorization design; weakening the lifecycle guard is not an acceptable
   shortcut.

## Post-close local validation receipt

The migration and generated draft bootstrap were executed in an isolated
PostgreSQL 17 database. The final database suite passed 17/17 checks. It
verified RLS, grants, historical null preservation, lifecycle immutability,
explicit activation denial, frozen manifest membership, covering foreign-key
indexes, and exact nine-spec/one-manifest/nine-membership draft parity.

The validation corrected three fail-closed defects and one persistence-shape
gap before review:

- five missing foreign-key indexes were added;
- manifest membership inserts are now allowed only while the manifest is a
  draft;
- receipt insertion now rejects `activation_authorized=false`;
- immutable external version/manifest keys plus `family_id`, `cohort`, and
  `priority` preserve the exact compiler hash across database reads.

The generated bootstrap is local-only, idempotent, draft-only, and creates no
proposal or activation receipt. Reconstructing the compiler input from its
database-shaped rows reproduces
`sha256:ee6901d6ee2a4d975c994d41dac782f9dab35d424ee2258aed70347363be2467`
with both worker and dashboard projections still
`activationAuthorized:false`.

## Change classes

| Class | Examples | Required handling |
| --- | --- | --- |
| A — presentation-only | label, description, ordering, display grouping | audit record; no trading-semantic projection change |
| B — bounded parameter | quantity, max debit, approved target/stop within an existing envelope | exact diff, static bounds, replay/counterfactual, capacity/collision/risk checks, operator approval, next-safe-entry activation |
| C — governed operational policy | roster, account routing, risk envelope, collision domain, re-entry, scaling, paper/live boundary | stronger review, explicit operator authority, new manifest, safe-boundary proof, rollback receipt; may require LAB/canary evidence |
| D — code/strategy logic | signal, order, schema semantics, worker behavior | branch, tests, review, merge, deployment, and separate activation gates |

Misclassifying a changed field is a blocker. A Class B proposal cannot smuggle a
Class C account or collision change, and no proposal can represent Class D code
as data.

## Fail-closed validation contract

| Gate | Local/static proof available now | Proof required before activation |
| --- | --- | --- |
| Schema and identity | exact schema version, IDs, parent, hashes, unique roots | server revalidation against persisted base/version |
| Risk | positive whole quantity, debit/risk envelopes, paper-only authority | fresh account buying power and concentration |
| Capacity | declared domain limits and spec bounds | current broker, pending-order, and desk occupancy |
| Account authority | manifest/spec account agreement and paper mode | credential route, account mode, armed/halt state |
| Collision | known domain/policy and deterministic priorities | fresh cross-account OCC/order reconciliation |
| Re-entry/scaling | compatible policy combinations | current session entry/open-position state |
| Replay sufficiency | evidence references and declared sample/censor results | exact retained-session run with limitations surfaced |
| Evidence readiness | required collectors/version declarations | hosted collector and observer attachment proof |
| Safe boundary | boundary type is declared | no conflicting open position or pending order at activation |
| Rollback | exact prior manifest/spec target | persisted rollback target plus worker acknowledgement path |

`not-run`, missing, stale, malformed, or ambiguous evidence blocks readiness. The
disabled slice cannot produce an activation receipt.

## Database adoption without historical rewriting

- Existing `policy_epochs`, `position_plans`, JSON `entry_features`, decision
  rationale, and `release_evidence` remain valid historical attribution.
- New nullable references are populated only for evidence created after a
  future authorized cutover. Existing rows stay null; no backfill invents a
  version association.
- Resolution order for old evidence is: explicit new relational reference,
  existing position-plan/policy-epoch link, exact stamped JSON identity, then
  **unknown/censored**. Time-window inference is forbidden.
- Open positions keep the position-plan/spec/manager stamp captured at entry.
  A later active manifest applies only to a new admission after the safe
  boundary.
- Signal quality, manager/configuration performance, and actual portfolio
  dollars remain separate reporting cohorts.

Current Supabase guidance was checked before drafting: raw-SQL tables in exposed
schemas require explicit RLS and grants, authorization uses `app_metadata`, and
new Data API exposure behavior must not be assumed. The migration therefore
enables RLS, revokes public/anon access, grants authenticated operator read only,
and reserves writes for the service role. It is generated locally and remains
unapplied.

## Keep / reuse / rewrite map

- **Keep:** `admissionDomainModel.ts`, RC5.4 manager execution logic, release
  evidence stamping, policy epochs/position plans, exact replay, startup
  fail-closed environment gates, broker/desk reconciliation.
- **Reuse:** channel passport presentation model, inert local-draft UX,
  deterministic canonicalization pattern, existing operator `app_metadata`
  RLS convention, current regression suites.
- **Rewrite later:** duplicated worker/dashboard root arrays, manually repeated
  account/risk/manager presentation, release hash coordination, direct legacy
  strategist-config writes for governed fields.
- **Do not reuse as authority:** Dockerfile defaults, documentation-only flags,
  cached release receipts as liveness, or time-based inference for historical
  configuration identity.

## Post-market production sequence — not authorized now

1. Review the schema/compiler and compare the generated RC5.4 projection with
   current code and hosted evidence.
2. Apply the migration only after explicit approval, advisor review, local
   migration verification, backup/rollback review, and a proven safe window.
3. Persist the current sealed RC5.4 specs/manifest without activating a new
   policy and verify read-only parity.
4. Add server-only proposal writes and operator authorization; keep clients
   read-only.
5. Teach worker/dashboard to read a pinned manifest behind a default-off flag;
   retain the compiled code fallback and exact hash comparison.
6. Rehearse a no-change activation and rollback in paper/LAB with the book flat.
7. Only then request authorization for a bounded proposal and next-safe-entry
   activation.

Rollback for the future cutover is the exact prior manifest ID plus the compiled
code fallback. If either the database read, content hash, worker acknowledgement,
or safe-boundary proof is missing, the worker must refuse the new manifest and
continue the already stamped entry-time policy for existing positions.
