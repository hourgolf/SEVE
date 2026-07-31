# Channel performance review and operator-control workflow

Date: 2026-07-30 after close
Posture: paper-only control-plane implementation; this document does not itself authorize a proposal or activation.

## Outcome

Build one authenticated operator workflow that separates three independent decisions:

1. **Execution posture:** execute on paper, run a bounded paper canary, or observe only.
2. **Paper route:** PAPER 1, PAPER 2, PAPER 3, or no broker route.
3. **Economics:** quantity, risk cap, TP/SL, and manager policy.

An operator should be able to draft and preview any of those changes in one place, then apply a safe bounded change with one informed confirmation. Every applied change must fork an immutable configuration epoch, affect only new entries at the safe boundary, preserve entry-time policy for open positions, and leave signal, quote, held-position, manager-observer, reconciliation, and Sentinel evidence collection intact.

“Promote” must not be a disguised bundle of routing, sizing, and manager changes. The exact diff must show each axis independently.

PAPER 1/2/3 are presentation aliases keyed by immutable account UUID. They
carry no hierarchy or performance meaning. Stored legacy names, credential
references, historical receipts, and routing identities are not rewritten.

## Current truth

- Runtime authority is the sealed/receipt-bound nine-root release, not `strategists.status`, current `strategist_config`, or a local draft.
- The current inventory contains 68 channels: 25 marked `paper`, 38 marked `draft`, and 5 marked `disabled`.
- Nineteen `paper` rows are not members of the sealed nine-root runtime.
- Three sealed PAPER 2 roots are still marked `draft`.
- Therefore the current mutable lifecycle label is not an accurate answer to “will this channel place a paper order?”
- The cumulative book contains 1,453 structurally complete logical trades over 42 sessions, but 1,426 trades predate exact configuration stamping.
- Exact current-configuration evidence contains 27 logical trades over 4 sessions and is insufficient for a current-root promotion, reduction, retirement, or parameter verdict.
- The exact T+1 replay contains 2,637 eligible clocks over 22 sessions and is the better manager-comparison layer, but no active target/runner grid forms a stable promotion plateau.
- The current nine-root recommendation remains `retain_rc54_unchanged`.

### Evidence receipts

- Profitability ledger: `sha256:15b62196518c93f64962d47afe72d4f64203f1848741a29df3a52ffa567c9b7b`
- Profitability snapshot: `sha256:7e5cf2f21a4372fa12bfae1cf8838db37bb006844520f05e9889c600c0f8ac3c`
- RC5.5 research receipt: `sha256:d93c61b60f3ea697e193b7aa0ec0e1dff8d0ef44cc7ef6aeab8f1f8cdd8faaa0`
- Exact T+1 manager study: `data/rc54-comparable-refresh/sealed-manager-study/`

## Decision board

These are review dispositions, not runtime instructions.

| Disposition | Channels | Evidence-based read |
| --- | --- | --- |
| **Promote candidate to a small sealed paper canary** | `momo-shape-2` | Strongest cross-layer nomination: broad executed +$5,106.95 over 63 trades/9 sessions; prospective same-session +$16.41 per contract over 26 paths/5 sessions with clustered 95% interval +$8.48 to +$24.34; exact T+1 manager evidence is positive in both chronological halves but only 8 paths/4 sessions and is not an exact current-manager comparison. Reviewable as an explicitly experimental canary, not proven for paper execution enablement. |
| **Keep observe-only watchlist** | `vb-gap-drift`, `vb-ribbon-cross-iwm`, `pb-ride-2`, `breakout` | Positive or near-positive prospective evidence, but confidence intervals cross zero, exact manager comparability is missing, or historical/current layers disagree. |
| **Hold sealed runtime unchanged** | `breakout-alt-v3-iwm`, `orb-qqq-trail`, `pb-ride`, `grind-v3`, `momo-shape`, `orb-ustop-ctl`, `vb-macd-state`, `vb-ribbon-cross-qqq`, `vb-squeeze-break` | All nine roots are below current-configuration evidence floors. Early exact results are mixed and often reverse the sign of broad or approximate evidence. |
| **Continue as observe-only; do not add to sealed execution roster** | `qqq-thrust-trail`, `breakout-alt-v3`, `breakout-smart-entries`, `breakout-qqq`, `orb-ustop`, `vb-curl-reversal`, `vb-squeeze-break-qqq` | Negative and/or conflicting multi-layer evidence. These are not sealed roots today, so the immediate operational correction is truthful labeling rather than a runtime demotion. |
| **Tune research queue only** | `breakout-alt-v3-iwm`, `orb-qqq-trail`, `pb-ride`, `grind-v3`, `orb-ustop-ctl`, the three PAPER 2 roots | Profit protection, admission quality, and manager alternatives merit preregistered exact replay. No TP/SL/manager value is activation-ready today. |

The first product distinction must be:

- **Evidence-qualified promotion:** the evidence floor is met and the operator approves the exact bounded change.
- **Bounded experiment:** evidence is insufficient, risk is capped to LAB-canary limits, the UI says `EXPERIMENTAL`, and the operator records the hypothesis and stopping rule.

Conservative actions such as execute-to-observe-only or lower quantity must not require positive performance evidence. They still require identity, route, collision, open-position, and capture-continuity checks. Risk-increasing actions require the stricter evidence and capacity gates.

## Evidence hierarchy shown in the UI

Every decision card must show the layers separately; it must not pool them into a single score:

1. Exact executed results for the same configuration epoch.
2. Exact T+1 replay for a comparable manager and signal version.
3. Prospective same-session shadow outcomes, labeled approximate when parameters or valuation differ.
4. Broad structurally complete history, partitioned by known configuration era.
5. Manager counterfactuals, kept separate from signal quality and portfolio effects.

Each metric must display trades/paths, distinct sessions, configuration identity, date window, sample grade, confidence interval where available, censor count, and a linkable evidence receipt.

## Required operator flow

### 1. Inspect

- Display effective runtime state from the active manifest and activation receipt.
- Display mutable database labels only as legacy/admin metadata.
- Show execution posture, account route, and economics as separate fields.
- Show open positions and the configuration epoch governing each position.

### 2. Draft

- Permit local edits without persistence or runtime authority.
- Require exactly one explicit action class:
  - `observe_only`
  - `start_paper_canary`
  - `promote_paper_tier`
  - `change_account_route`
  - `tune_economics`
  - `reduce_risk`
  - `rollback`
- Require a reason, evidence references, and—when experimental—a hypothesis, review date, and stopping rule.
- Never infer quantity, account route, TP/SL, manager, or collision changes from the word “promote.”

### 3. Validate and preview

- Re-read the active manifest and reject base-hash drift.
- Produce one exact before/after diff with derived capacity and collision effects.
- Classify every field as bounded, governed, or forbidden.
- Verify authenticated operator identity and paper-only authority.
- Verify broker route reachability, current positions/orders, account budgets, worker compatibility, and capture continuity.
- Show whether the change can activate at the next safe entry or must wait for an after-close/flat-book boundary.
- Show the new configuration epoch and rollback target before confirmation.

### 4. Apply once

- Accept one informed operator confirmation over the exact preview hash.
- Persist an idempotent proposal, approval, activation receipt, and worker acknowledgement.
- Activate only at the declared safe boundary.
- Apply the new policy to new entries only.
- Preserve the old entry policy on every open position.
- Do not restart or redeploy code when the running worker already supports the exact manifest and epoch.

### 5. Verify

- Confirm the worker acknowledges the exact manifest, spec, manager, route, and configuration epoch.
- Confirm no duplicate proposal, receipt, or activation was created on retry.
- Confirm observe-only channels continue every required evidence path while producing no order attempts.
- Confirm the first new entry after activation is stamped with the new epoch.
- Confirm historical and open-position rows were not rewritten.
- Provide a concise receipt with the diff, boundary, worker acknowledgement, capture continuity, and rollback identity.

## Acceptance tests

1. **Runtime-truth test:** with today’s data, the UI reports exactly nine effective sealed roots even though 25 rows say `paper`, and it reports the three receipt-bound LAB roots as executing paper rather than merely `draft`.
2. **No-badge-authority test:** changing `strategists.status` or `strategist_config` alone cannot change the effective runtime indicator or grant order authority.
3. **Three-axis diff test:** an execution-posture change cannot silently change route or economics; an account change cannot masquerade as a bounded parameter edit.
4. **Draft isolation test:** moving controls creates only a local draft and performs no database, worker, broker, roster, or order mutation.
5. **Base-drift test:** a proposal built against an old manifest or spec hash fails closed and must be re-previewed.
6. **One-confirmation test:** a valid bounded paper change can move from reviewed preview to scheduled activation with one authenticated confirmation, without Git, SQL, or deployment work.
7. **Risk-asymmetry test:** execute-to-observe-only and quantity reduction can proceed without an efficacy floor; execution enablement, quantity increase, looser loss limits, or higher capital tier cannot.
8. **Canary test:** an insufficient-evidence channel can only enter execution as an explicitly labeled, capped paper canary with a hypothesis, review date, stopping rule, and no live-money authority.
9. **New-entry-only test:** activation while another position is open leaves that position on its immutable entry-time manager and stamps only later entries with the new epoch.
10. **Observe-continuity test:** demoting a channel to observe-only produces zero post-boundary order attempts while quote capture, candidate decisions, virtual outcomes, manager observations, reconciliation, and Sentinel evidence remain current.
11. **Evidence-partition test:** before/after results are queryable by configuration epoch and are never pooled as if they were the same policy.
12. **Failure-atomicity test:** missing broker evidence, stale capture evidence, worker incompatibility, collision failure, or receipt disagreement leaves the active runtime unchanged.
13. **Idempotency test:** retrying the same confirmation returns the same proposal/receipt identity and never creates a second activation.
14. **Rollback test:** rollback creates a new immutable receipt targeting the prior manifest, obeys the same safe-boundary rule, and does not rewrite history.
15. **Legacy-write fence test:** existing roster/strip controls cannot directly persist execution-affecting configuration; they must enter this workflow.
16. **No-deploy test:** a supported configuration-only change does not require a code commit, Vercel deployment, or Railway rebuild.

## Implementation status at the July 30 close

Completed and production-safe:

- Read-only `EffectiveChannelState` projection from verified runtime authority.
- Evidence-backed decision card with unpooled evidence layers.
- Authenticated read-only projection of the exact active spec, paper route,
  admission policy, collision domain, priority, and capacity limits.
- Neutral PAPER 1/2/3 presentation aliases without identity/history rewrites.
- Legacy direct configuration, roster, executor, create, duplicate, and delete
  writes fenced behind the governed-proposal boundary.
- Manager-only proposal drafts can prove static capacity/collision preservation;
  sizing, re-entry, route, and roster changes remain blocked pending fresh
  current-session evidence.

Still blocked from operator apply:

- The dashboard has no activation endpoint that binds fresh broker/desk truth,
  exact preview, explicit approval, and immutable receipt.
- The worker has no general preview watcher that independently validates and
  acknowledges candidate manifests.
- Observe-only channels outside the active manifest have no preregistered
  executable specification, so they cannot safely be promoted.
- Research collection has no independent active/paused/archived registry, so
  culling the observation swarm cannot yet be separated cleanly from execution
  posture.

These are fail-closed product blockers, not hidden TODOs. Until all four are
resolved and verified, an operator can inspect, compare, and fork a local draft,
but cannot safely “just flip” execution or collection switches.
