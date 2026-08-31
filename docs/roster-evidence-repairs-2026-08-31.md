# Roster evidence repairs — August 31, 2026

## Status and scope

All four requested workstreams are implemented or prepared **locally**, not deployed or activated. Work is on `codex/monday-readiness-2026-08-31` in the Monday-readiness worktree, based on `ece102d9102915ef578b27bf2651e57e85386a6f`. The dirty original SEVE checkout and the prior changes to `docs/monday-readiness-program-2026-08-31.md` were preserved.

No production writes, pushes, merges, deployments, broker actions, or configuration activations were performed. These repairs do not establish that the current roster is optimal, or that every historical roster choice used the faulty dashboard query.

Two evidence windows must stay distinct:

- **Account Results reconciliation:** frozen audit through August 31 at 12:23 PDT (`2026-08-31T19:23:20.012Z`); Monday is incomplete.
- **Trial decisions and regenerated briefs:** completed sessions through August 28; current immutable specification and account only. No virtual paths enter the trial-limit calculation.

## 1. Account Results retrieval repaired

The previous route query could require 2,841 execution-observation rows but receive only 1,000. Its unpaged response incorrectly made historical account evidence appear missing. The longer window consequently showed fewer trades than the shorter window.

The replacement pages position, execution-route, and NAV reads in stable order; checks exact counts and identities; and reports incomplete or changing reads rather than silently accepting them. Whole bank/runner families are hydrated even when the bank predates the requested window. Account attribution still requires immutable execution observations—there is no current-roster routing fallback.

The actual retrieval helpers reconciled **20/20** frozen comparisons: ten active channels across 7-day and 30-day windows. Grind's corrected 30-day result is **12 trades, 7 profitable, +$464**, not the incomplete 3/2/−$34. That total pools historical configurations; it is not the current-configuration trial result.

Tests also cover nested Today/7D/30D cohorts, cross-window partial exits, missing parents, three separate accounts, genuinely absent account evidence, duplicate identities, changing counts, server truncation, and safety limits. Reads exceeding the safety bound fail visibly rather than truncate. This is not a transactional database snapshot; concurrent mutations can require a refresh.

## 2. Trial-limit reviews now outrank generic research guidance

Added a release-bound trial-review calculation and connected it to brief generation, the first-glance card, fleet prioritization, and lineup disposition. A reached trial limit can no longer be hidden behind a generic five-session minimum or a contradictory “size hold” badge. Research lenses remain in supporting detail and do not change the executed trial cohort.

All **10/10** regenerated current-spec trial cohorts agree with the frozen independent audit. The three review flags are:

| Channel | Completed current-spec evidence, Aug 24–28 | Decision prepared |
| --- | --- | --- |
| `vb-gap-drift-qqq` | 3 trades; 3 losing sessions; −$358 total; −$118 median trade | Review return to observing: its written three-losing-session trial limit is reached. |
| `vb-level-break` | 8 trades in 4 sessions; −$816 total; −$804 without the best session | Review size 4→2; preserve the native exit. |
| `grind-smart-entries` | 5 trades in 5 sessions; +$304 total; +$84 median trade; −$76 without the best session | Separate size-concentration review from channel viability; resolve conflicting written rules. |

Grind's channel-specific rule tests negative typical contribution, while the general sizing rule tests contribution without the best session. They are not interchangeable. The prospective proposal is: after at least three completed sessions or five trades, negative without-best-session contribution triggers a **4→2 sizing review**; negative median or verified adverse displacement triggers a **separate viability review**. This clarification is proposed, not retroactively imposed or activated.

The trial contract is explicitly scoped to the audited configuration epoch. A future release must explicitly carry forward or revise its contract; this implementation does not silently apply the August contract to unrelated future configurations.

## 3. Exact rollback drafts prepared; activation remains blocked

Base manifest: `manifest:proposal:07c47519-ead9-5084-bde8-a0aebee13b78`.

Base content hash: `sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98`.

Four alternative drafts share that same base; they must not be applied sequentially without rebuilding against the resulting manifest:

| Draft | Exact bounded change |
| --- | --- |
| Gap only | `vb-gap-drift-qqq`: paper trading → observe-only. |
| Level only | `vb-level-break`: 4→2 contracts, debit cap $700→$350, risk cap $210→$105. |
| Gap + Level | Combined preferred candidate for further review; no other roster changes. |
| Grind optional | `grind-smart-entries`: 4→2 contracts, debit cap $1,200→$600, risk cap $420→$210. |

Entries, native managers, account routing, priority, account admission policy, and family/OCC protections are unchanged in these drafts. Static compiler and exact-diff checks pass. The draft packet marks `validationReady: false` and does not authorize activation.

**Observed facts:** the limits and losses above. **Supported inference:** Gap warrants its agreed trial review; Level's larger allocation is not supported by this observed period. **Strongest counterargument:** small samples can rebound, and reducing one channel's footprint changes which other trades enter. Grind's positive median and total argue against calling it rehabilitated or failed solely from its best-day dependence. Confidence is high in the arithmetic, moderate in the bounded review priorities, and insufficient to claim improved portfolio P&L.

Before activation: refresh the active manifest identity; run the exact same-opportunity chronological portfolio replay, recent/holdout and without-best-session checks; measure capacity, family/OCC collisions, and displaced trades; regenerate the compatibility projection and seal; verify a safe activation boundary; obtain separate approval. Pausing Gap frees Account 2 capacity; reducing sizes can admit other trades. Halving old P&L is not a portfolio replay.

## 4. Missing forward controls implemented

Enrollment now selects promised controls from the immutable entry manager profile **and version**, not today's mutable channel settings:

- Grind Smart: restore its displaced all-out +8/−35 control alongside its current FULL-R50-K75 native.
- Momo Shape 2: add the exact displaced BANK20/RUN50 with post-bank breakeven, FULL-R20-K50, and FULL-R50-K67 controls. The latter retains exactly two-thirds. An equivalent generic arm is excluded to avoid counting the same policy twice.
- Level Break: restore +50/−30, retain the +25 alternative, and avoid duplicating the current native +30 policy.
- ORB Trend Rider: add its source +30/−35 control without duplicating its current +50 native.
- MACD: the displaced +18 control already exists under `VB-MACD-CURRENT-LOCK18`; no duplicate was added.

This is **future evidence collection**, not invented historical coverage. Existing durable runs retain their identities and policy inventory. Late recovery does not add controls that missed the quote path. New tests cover version matching, causal bid-price overshoot, bank/runner lot weights, breakeven, ratchet recovery, codec round trips, restart safety, and stable historical IDs. Native execution behavior is unchanged, but deploying this worker code would change forward shadow enrollment and research writes.

## Verification and artifacts

Passed: root and worker TypeScript, production Next build, diff checks, new windowed-read/trial-review/shadow-control tests, existing manager-shadow and durable-book tests, logical-trade cohort tests, performance-evidence tests, brief/summary/lineup and preview/hierarchy tests, trail-frontier tests, and publication/hash/hook selftests. A preexisting UI source test still expected the old “active/shadowing” legend; its expectation was updated to the already-shipped “trading/observing” terminology without changing the legend.

In-app browser QA used the real card component with regenerated frozen briefs in a loopback-only fixture: desktop 1280×720 and mobile 390×844, cream and blackout, supporting-detail interaction, no horizontal overflow and no browser console errors. This is **component QA, not authenticated end-to-end production smoke**; that remains a release gate.

Local artifacts (not published):

- `data/roster-evidence-repairs-2026-08-31/verification/frozen-reconciliation.json`: 20 window comparisons and 10 trial checks.
- `data/roster-evidence-repairs-2026-08-31/proposals/packet.json` and `receipt.json`: four bounded alternatives and missing activation gates.
- `data/roster-evidence-repairs-2026-08-31/briefs-complete/`: 68 regenerated briefs through August 28, including entry and trail evidence; supersedes the incomplete local `briefs/` generation.

Source audit hash: `sha256:e4202d92d37d528836f38817d9883cb7d8d863d96817323fe6e3a3bd69d0d936`.

Proposal packet hash: `sha256:645840247466894bdc145b0f6b90288e778d925051a0064a1d41de3dc23d5e2d`.

Regenerated briefs hash: `sha256:daa804f9d750cd24c679232c9dce7bbad4540dff4116b0858b4e59fa77a72c34`.

## Next release decision

Local code checks: **GO for release review**, not a claim of production completion. Roster activation: **NO-GO until the remaining checks and approval above**.

A release approval must explicitly cover dashboard, worker shadow-enrollment changes, and refreshed brief publication. Pushing main can automatically redeploy **both Vercel and Railway**; do not describe this as a Vercel-only merge. After release, authenticate and smoke-test Account Results and the trial cards against production, then verify new control enrollment on eligible forward fills. Native roster, sizing, and manager changes require their own validated proposal and approval.
