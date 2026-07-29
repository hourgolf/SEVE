# Release-agnostic channel configuration readiness

Status: local implementation and proof only. No commit, push, pull request,
deployment, migration, Railway restart, live proposal, activation, roster
change, retention change, or order action is represented by this document.

## Authority baseline

- RC5.4 remains the sealed, paper-only runtime authority.
- The active Railway worker is a separate release surface from the dashboard.
- Supabase market-ingest v11 is outside this change and must remain undisturbed.
- Draft `ChannelSpecVersion` and `ReleaseManifest` rows are not runtime
  authority.
- An existing position is managed only by its immutable entry-time policy.
- Readiness proves operational congruence. It does not decide whether a
  quantity, take-profit, or stop-loss value is strategically desirable.

## Keep / reuse / modify map

| Component | Decision | Reason |
| --- | --- | --- |
| `channelControlPlane.ts` types, canonical JSON, hashes, manifest compiler, worker/dashboard projections, validation gates | Keep and reuse | This is the release-agnostic source of configuration identity and projections. |
| `channelActivation.ts` candidate preview, safe-boundary proof, activation review, acknowledgement binding, receipt, entry policy, rollback | Keep and reuse | The protocol already fails closed and preserves entry-time policy. |
| `channelActivationShadowAdapter.ts` | Keep as temporary RC5.4 adapter | It verifies the exact sealed RC5.4 release, worker, configuration hash, root roster, paper posture, and held-capture readiness without acquiring authority. |
| `channelBaselineAdoption*` and the adoption RPC | Keep inactive | These implement a governed baseline boundary, but no adoption receipt exists and this work does not invoke them. |
| `channelProposalWrite.ts` | Modify | Proposal construction now receives an explicitly resolved compiled manifest and contains no RC5.4 fixture or economics. |
| `rc54ChannelProposalAdapter.ts` | Add temporarily | The current API keeps identical RC5.4 draft behavior while the generic core remains release-agnostic. |
| `channelControlPlanePersistence.ts` | Add | Once a manifest is active, the proposal path reconstructs and hash-verifies that authority instead of falling back to the RC5.4 fixture. Read failure blocks. |
| `channelConfigurationWorkflow.ts` | Add | One inert orchestration seam composes validation, preview, boundary, acknowledgement, receipt, rollback, and capture continuity. |
| `channelEpochEvidence.ts` | Add | One pure receipt-bound identity contract covers candidates, orders, fills, positions, closes, held paths, and manager observations. |
| `rc54NoopConfigurationCanary.ts` and canary command | Add temporarily | This proves the full protocol against the sealed RC5.4 adapter with identical economics and no live writes. |
| `channelConfigurationRuntimeAdapter.ts` | Add dormant | It converts an exact activation receipt and reviewed projection into a paper-only next-entry policy, but remains unimported by the active worker pending review. |
| `channelConfigDraft.ts` | Do not extend | It is the older Day 1 UI draft model and must not become a second control plane. |
| Worker execution, order placement, capture loops, manager observers, broker reconciliation, Sentinel, and market-ingest | Preserve unchanged | The local proof must not change current execution or capture. |

## Generic workflow

The reviewed configuration identity is the only source for both projections:

1. EDIT DRAFT creates an inert bounded proposal against an exact base spec ID
   and content hash.
2. VALIDATE runs deterministic schema, risk, capacity, account, collision,
   re-entry/scale, replay, evidence, boundary, and rollback gates.
3. PREVIEW compiles one candidate manifest and generates worker and dashboard
   projections with the same manifest hash.
4. APPLY AT NEXT SAFE ENTRY requires every configured paper account to be
   queried, broker positions and open orders to be zero, desk positions to be
   zero, evidence to be fresh, capture paths to be healthy, and the exact
   worker lineage to acknowledge the candidate.
5. IMMUTABLE ACTIVATION RECEIPT binds proposal, old and new spec identities,
   manifest, configuration epoch, validation evidence, operator approval,
   boundary proof, worker acknowledgement, schedule, and rollback target.
6. New-entry evidence can acquire a configuration identity only when that
   receipt exactly matches the compiled manifest and projection.
7. ROLLBACK is a new reviewed next-safe-entry transition to the pinned prior
   manifest. It never edits historical rows or reinterprets open positions.

Every stage remains fail-closed and carries `activationAuthorized: false` or
`runtimeMutationAuthorized: false` until a separate production adapter consumes
an operator-approved receipt.

## Local RC5.4 no-op canary

Run:

```bash
npm run channel-configuration-noop-canary
```

The fixture proposes the current `orb-ustop-ctl` quantity as the new quantity.
It therefore creates a new proposal/spec/manifest/epoch identity while leaving
the identity-free economic projection unchanged. The local sequence:

- validates and previews the candidate;
- asks the existing RC5.4 shadow adapter to verify the sealed runtime fixture;
- queries a fixture inventory containing every manifest account plus an extra
  configured paper account;
- proves zero broker positions, zero broker orders, and zero desk positions;
- proves quote capture, held capture, manager observers, broker
  reconciliation, and Sentinel evidence;
- generates a deterministic acknowledgement and activation receipt;
- stamps all seven required evidence classes with the receipt-bound epoch;
- proves an already-open position retains its prior epoch;
- produces a rollback plan to the exact active manifest.

The command performs no network call or persistence and reports
`liveMutationPerformed: false`, `liveProposalCreated: false`,
`activationAuthorized: false`, and `orderAuthority: false`.

## Fail-closed matrix

| Risk | Required proof |
| --- | --- |
| Invalid or over-broad edit | Exact bounded field list, deterministic validation, base hash match |
| Worker/dashboard drift | Same compiled manifest content hash and spec roster |
| Missing or stale worker evidence | Exact compatibility, boot, release, RC5.4 configuration, timestamp, startup receipt |
| Account uncertainty | Every configured account present, paper-only, queried once |
| Unsafe boundary | Zero broker positions, zero open orders, zero desk positions |
| Capture regression | Fresh quote, held, manager, reconciliation, and Sentinel observations |
| Missing approval | Exact proposal-bound operator approval |
| Missing acknowledgement | Exact proposal/manifest/hash/epoch/worker/boot acknowledgement |
| Missing or mismatched receipt | New epoch identity cannot be constructed |
| Mixed evidence epochs | Lifecycle validation blocks |
| Missing immutable position route | Position/close/held/manager stamp construction blocks |
| Open-position reinterpretation | Only immutable entry stamp is accepted; no current-policy fallback exists |
| Rollback drift | Pinned parent/target manifest lineage and exact hashes |

## Exact production activation procedure (documented, not executed)

This procedure is intentionally split by operator approval boundaries.

1. **Commit review boundary:** review the local diff and full test/build
   evidence. Commit only after explicit approval.
2. **Merge/deployment boundary:** review the pull request and release surfaces.
   Merge and deploy only after separate explicit approval. A dashboard
   deployment must not restart or replace Railway.
3. **Baseline authority boundary:** read live worker identity, startup receipt,
   configured paper-account inventory, broker positions, broker open orders,
   desk positions, capture receipts, and current control-plane counts. If the
   baseline-adoption design is still required, prepare its exact receipt and
   request explicit approval before invoking its RPC.
4. **No-op proposal boundary:** create the economically identical RC5.4
   proposal only after explicit approval. Persisting a live proposal is a
   separate action from code deployment.
5. **Validation/preview boundary:** compile from the stored exact base identity;
   publish the worker and dashboard preview hashes; attach replay, capture,
   account, collision, and rollback evidence. Any disagreement blocks.
6. **Activation boundary:** obtain explicit proposal approval, re-query every
   configured paper account, prove a fresh global flat/order-free boundary,
   verify the current RC5.4 worker/startup receipt, and obtain the exact staged
   worker acknowledgement. Do not restart Railway to manufacture freshness.
7. **Receipt boundary:** atomically persist the activation receipt and active
   configuration epoch only if the database transaction revalidates proposal,
   base identity, approval, boundary, acknowledgement, and rollback lineage.
   Request explicit approval before this action.
8. **Next-entry boundary:** only a new eligible entry after the receipt may use
   the new epoch. All candidate/order/fill/position/close/held/manager evidence
   must carry that exact receipt-bound identity. Existing open positions remain
   on their original stamps.
9. **Post-activation verification:** read back the receipt, worker
   acknowledgement, projections, first new-entry stamps, capture continuity,
   broker reconciliation, and Sentinel evidence. Any missing identity or
   capture regression fails closed and invokes the reviewed rollback procedure.
10. **Rollback boundary:** prepare the pinned prior-manifest transition, prove a
    new safe boundary, obtain explicit approval, acknowledgement, and a new
    immutable rollback receipt. Never update old evidence rows.

## Bounded strategic proposal

The generic server builder can generate a draft preview for `quantity`,
`maxDebitUsd`, `takeProfit`, `stopLoss`, or `riskLimits` against any explicitly
resolved active manifest. It rejects semantic no-ops for live storage and never
approves or activates a proposal.

The prepared review input is
`docs/bounded-channel-proposal-review-2026-07-28.md`. It identifies
`breakout-alt-v3-iwm` as the first channel-specific question, but selects no
value because the preregistered evidence floor is not met and the leading
all-out lock arms are not faithfully representable by the current half-bank
schema. Until an operator selects a supported value after evidence review, no
bounded proposal artifact should be mistaken for strategic approval or runtime
authority.

## Remaining production gap

The local protocol and receipt-bound evidence contract are proven, but they are
not wired into the active worker or database lifecycle. That wiring must be a
separate reviewed change after the no-op evidence is accepted. In particular:

- no live proposal or activation receipt has been created by this work;
- no active worker consumes a control-plane manifest;
- the existing activation-receipt database guard is intentionally dormant:
  proposal rows are constrained to `activation_authorized = false` while the
  receipt trigger requires `true`, so a later reviewed migration/RPC is required
  before any live activation can succeed;
- no current runtime row is retroactively stamped;
- the new relational epoch columns remain dormant until a receipt-authorized
  next-entry adapter is reviewed and deployed;
- the current sealed RC5.4 execution and capture behavior remains unchanged.
