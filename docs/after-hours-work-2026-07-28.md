# SEVE after-hours work queue — 2026-07-28

Status: **LOCAL PLANNING QUEUE · NOT IMPLEMENTATION OR PRODUCTION AUTHORITY**

This list authorizes no commit, push, merge, deployment, migration, Railway
restart, configuration change, proposal, activation, or order action. Each
external boundary still requires explicit operator approval.

## Live reconciliation — 2026-07-28 after close

| Item | Current disposition |
| --- | --- |
| Close boundary | **PASS** — three configured paper accounts reachable, distinct, active, unblocked, flat, and at zero open orders; desk books congruent |
| RC5.4 shadow recovery | **COMPLETE** — release-agnostic replay correction merged in PR #22 |
| Sentinel release contract | **COMPLETE** — manager denominator and generic release binding merged in PRs #23–24 |
| Historical account-scoped P&L | **COMPLETE FOR NATIVE REVIEW** — immutable attribution and account-complete equity merged in PR #25 |
| Native Review migration | **SUBSTANTIALLY COMPLETE** — Autopsy, Performance, Evidence, Sentinel, and account equity now have native destinations |
| Manual-close evidence boundary | **COMPLETE** — immutable account routing and sealed policy receipts live at production commit `fae9d5a1` |
| Hot quote storage | **AUDITED / PHASE A + PARITY MODEL GREEN LOCALLY** — ingest-window and fail-closed archive proof are local; deployment and retention remain unapproved |
| TradingView | **DECIDED** — no SEVE platform purchase; separate operator research only |
| Legacy navigation retirement | **NOT YET** — requires several matching completed sessions and rollback route |

## 0. Establish the close boundary

- Confirm every configured paper account is reachable.
- Confirm broker positions, desk positions, and open broker orders are known.
- Require flat, congruent books before any production-facing maintenance.
- Verify the session's quote archive, publisher, and receipt chain.

## 1. Complete the RC5.4 shadow-recovery correction

- Review the focused local `codex/rc54-shadow-replay` diff.
- Commit and push only after explicit approval.
- Review one consolidated PR.
- After merge, run one idempotent July 27 publisher/backfill.
- Verify 139 VB paths, cumulative inclusion, receipt identity, and no duplicate
  research rows.

No Railway restart, schema migration, configuration change, or order-path
change is expected for this correction.

## 2. Bound the hot options-quote window

Status: **LIVE AUDIT COMPLETE · PHASE A IMPLEMENTED/TESTED LOCALLY · NOT DEPLOYED**

Evidence and recommendation:
`docs/supabase-hot-quote-storage-audit-2026-07-28.md`.

- Determine whether rows written after the 16:15 ET archive seal are required.
- If they are not required, add and test a market-calendar ingestion cutoff.
- If they are required, move the archive seal so the immutable object includes
  the full retained session.
- Prove hot-row count, archive-row count, checksum, and cold-read replay parity.
- Only after parity is proven, draft shorter receipt-gated hot retention.

The local Phase A diff now supplies a DST-safe 08:55 ET through close+15 window,
holiday/early-close handling, and true next-session 1DTE selection. Focused
tests, the maintained calendar suite, TypeScript, and the production build pass.
Supabase still runs the prior function and cron.

The local Phase B model now proves bounded hot rows, cold R2 bytes, manifest,
HEAD metadata, and the immutable receipt are identical before returning a
retention-eligible result. Its fail-closed 10-case matrix and the existing
23-case archive contract both pass. The read-only live adapter also ran against
July 28 and correctly blocked retention: 80,404 hot versus 75,532 archived,
with 7,392 hot rows beyond close+15. Two new bounded sessions remain required;
no deletion path exists in this diff.

Do not combine this work with the RC5.4 shadow-recovery PR.

## 3. Make Sentinel release-agnostic

- Replace the deterministic publisher's Day 1 release constants and receipt
  lookup with the generic `OperationalReleaseContract`.
- Supply RC5.4 through the existing temporary readiness adapter.
- Preserve exact release, configuration, worker, session, target-session,
  configuration-epoch, checksum, censor, and publisher identities.
- Keep the no-LLM deterministic packet as the reference output.
- Preserve the ordered, idempotent `start -> Sentinel -> finish` hosted receipt
  envelope.
- Add Day 1, RC5.4, future-adapter, stale, missing, conflicting, partial, and
  retry fixtures.

## 4. Correct historical account-scoped P&L

- Replace mutable `strategists.account_id` attribution with the latest immutable
  `execution_observations.account_id` route for each position.
- Fail closed on missing or conflicting execution routes.
- Keep account NAV truth separate from per-channel position attribution.
- Label bounded account history as `since <date>` rather than unconditional
  `all time`.
- Add reassignment, duplicate-observation, missing-route, and read-failure
  regression tests.

## 5. Consolidate Legacy evidence into the main view

Status: **NATIVE REVIEW WORKSPACE MERGED · PARITY OBSERVATION CONTINUES**

### Sentinel

- Render receipt/completeness first.
- Add deterministic "what happened" and cohort-safe "what changed" summaries.
- Limit the visible review queue to the top three evidence-linked findings.
- Link findings into Autopsy, Performance, Counterfactuals, Research, or Tape.
- Keep Sentinel descriptive and read-only with zero health, configuration, or
  order authority.

### Review workspace

- Add `Autopsy`, `Performance`, `Counterfactuals`, and `Tape` tabs.
- Reuse the existing Day/Week autopsy bodies with a metrics-first glance and
  the complete narrative behind progressive disclosure.
- Promote Today/Week/Month/All-or-Since P&L and equity views after immutable
  account attribution is proven.
- Decompose the Legacy Shadow Book into reusable counterfactual cards:
  one-account rehearsal, give-back, manual override, benched-versus-live,
  ratchet, pyramid, and concentration-cap scenarios.
- Keep native VB/All Dark paths in Research rather than duplicating them in
  Review.

## 6. Retire Legacy Rooms from navigation

Status: **DEFERRED UNTIL MULTI-SESSION PARITY**

- Maintain one visible product and one page-owned subscription seam.
- Run the new and Legacy views against the same evidence for several completed
  sessions.
- Confirm matching totals, windows, account scope, censors, receipt identity,
  desktop/mobile behavior, and zero duplicate subscriptions.
- Remove `Legacy Rooms` from navigation only after every retained capability has
  an equivalent or better destination.
- Keep a temporary direct archive route for rollback, then delete it in a
  separately reviewed cleanup.

## Parked decision: TradingView

Status: **RESOLVED — DO NOT PURCHASE AS A SEVE INTEGRATION**

- Keep the current open-source Lightweight Charts renderer.
- Do not buy TradingView as a SEVE data, storage, or operational integration.
- Revisit Advanced Charts only if richer manual drawing/indicator tools become
  valuable enough to justify licensing and a SEVE-owned datafeed.
- Any personal TradingView use remains separate research with zero gate or order
  authority.
