# Release-agnostic channel configuration completion audit — 2026-07-29

Status: **LOCAL IMPLEMENTATION READY FOR OPERATOR DIFF REVIEW · UNCOMMITTED · UNPUSHED · UNDEPLOYED · UNMIGRATED · INACTIVE**

Baseline local commit: `24901f3a` (`Add receipt-bound activation and immutable epochs`)

This audit proves the local implementation state only. It does not authorize a
commit, push, pull request, merge, deployment, migration, Railway change,
baseline adoption, live proposal, acknowledgement write, activation, rollback,
roster/account change, retention change, or order.

## Requirement audit

| Requirement | Authoritative local evidence | Result |
| --- | --- | --- |
| Reuse one generic configuration workflow | `channelControlPlane.ts`, `channelConfigurationWorkflow.ts`, `channelActivation.ts`, `channelActivationPersistence.ts`, and `channelControlPlanePersistence.ts` remain the only proposal/preview/receipt protocol | Proven |
| Keep RC5.4 economics out of the generic core | Generic `lib/channels` workflow modules do not import RC5.4; `rc54ChannelProposalAdapter.ts`, `rc54NoopConfigurationCanary.ts`, and `temporaryRc54RuntimeAdapter.ts` are explicit temporary adapters | Proven |
| Faithfully represent active sealed RC5.4 | No-op runtime adapter and temporary-admission tests compare every root's account, quantity, caps, manager, stop, target, runner, and epoch to the sealed RC5.4 fixture | Proven |
| Preserve the legacy worker path | `CHANNEL_CONFIGURATION_RUNTIME_ENABLED` defaults false; absent that flag, reload continues through `applyRc54ReleaseFleetOverlay` and `validateRc54ReleaseStartup` with the sealed checksum | Proven by source contract and RC5.4 regression tests |
| Generate worker/dashboard projections from one identity | The compiler emits both projections; preview persistence and SQL guards require identical ordered roots and manifest hashes | Proven |
| Stamp new-entry evidence with one receipt-bound epoch | Candidate decisions, signals, plans, broker/fill observations, positions, closes, held receipts, and manager observations use the all-or-none relational epoch triple; new entries also carry the immutable entry policy | Proven |
| Never reinterpret historical/open-position evidence | Existing rows resolve RC5.4 or receipt-bound entry policy from their own `entry_features`; mixed-epoch restart rejects missing, malformed, unknown, or wrong-route stamps and has no mutable channel fallback | Proven |
| Apply only at the next safe eligible entry | Activation requires the safe-boundary proof and receipt; the worker discovers active receipt authority on its control-plane poll and writes an epoch only for a manifest-root `enter` decision | Proven locally |
| Require validation, preview, acknowledgement, receipt, and rollback | Pure builders plus immutable RPC tables/functions bind exact proposal, manifest, epoch, worker boot, safe boundary, approval, and rollback lineage | Proven locally |
| Fail closed | Tests cover missing/read-failed control plane, stale/missing receipt, projection disagreement, topology/route/re-entry/scaling drift, non-paper/missing credentials, stale worker evidence, missing capture/replay/capacity evidence, malformed open-position policies, and dark-channel non-membership | Proven |
| Query every configured paper account for readiness | The readiness engine is manifest-independent; the no-op canary queries four configured paper accounts, including one outside the manifest | Proven |
| Preserve capture and paper-order boundaries | The existing sealed OPRA/held/manager posture is reused by `rc54OperationalPostureErrors`; receipt-bound runtime never grants order authority and production flags remain unchanged | Proven locally |
| No-op RC5.4 proving sequence | `npm run channel-configuration-noop-canary` returns economics equivalence, full candidate/order/fill/position/close/held/manager chain, acknowledgement, receipt, rollback-ready state, and no mutation | Pass |
| One non-active bounded proposal | `npm run channel-bounded-proposal` deterministically generates a coherent quantity/risk-envelope specimen, marks it non-recommended/non-persisted/non-authoritative, and leaves replay/capacity/boundary/ack/receipt evidence absent | Pass |
| Exact production activation procedure | `release-agnostic-channel-configuration-readiness.md` names the two migrations, two flags, API/RPC interfaces, ordering, freshness bounds, next-entry handoff, and rollback repetition | Documented, not executed |
| Existing RC5.4 and capture remain unchanged | No external mutation occurred; new runtime switch is default false and no repository changes are deployed | Confirmed for this task |

## Deterministic artifacts

- No-op canary:
  `sha256:7205897e334f50a8dd2c796daa29dd22c2dfa80a0bad5acb84d42bc8947eec0d`
- No-op configuration epoch:
  `sha256:f241b8a3c40a9b487a24ec2885891693ba8771f52e84e178a8ccc17688e2d816`
- Bounded proposal specimen:
  `sha256:e8ff23187be55a6e73924178133fa86c681965c4935e5be9517fe5ef11969cba`
- Bounded candidate manifest:
  `sha256:46e40863788d792ea4c6cc03a8079acdeaaaddff5ec600191be49abe9a0f40d1`
- Bounded candidate epoch:
  `sha256:1c322c7a2e702555c81b8c334d90de19afdd832b27e3c14870b5930fe0f0622f`

The quantity-3 specimen is plumbing evidence only. It is not a strategic
recommendation or a live proposal.

## Validation receipts

- Repository self-test inventory: `119/119` executable scripts passed.
- Excluded pre-existing script: `nakamoto-selftest`; its command cannot start
  because `/tmp/nak-golden/bars.csv` is absent. It did not reach assertions and
  is unrelated to this change.
- `npx tsc --noEmit`: pass.
- `npm run build`: pass.
- `git diff --check`: pass.
- PostgreSQL 15 syntax parser:
  - `20260729010000_channel_proposal_activation_bridge.sql`: 59 statements parsed.
  - `20260729013000_channel_epoch_evidence_propagation.sql`: 54 statements parsed.

The parser proves PostgreSQL grammar only. The migrations have not been applied
to a local or remote database, so catalog/permission behavior remains a
separate migration-review boundary.

## Current authority state

- RC5.4 remains the active paper-only runtime authority.
- Production Railway and Vercel are untouched by this tranche.
- `CHANNEL_CONFIGURATION_RUNTIME_ENABLED` is not configured by this work and
  defaults false.
- No proposal, preview, acknowledgement, approval, activation receipt, or
  rollback receipt was persisted.
- No Supabase migration was applied.
- No order was placed.

The next action is operator review of the uncommitted diff. A commit requires
fresh explicit authorization.
