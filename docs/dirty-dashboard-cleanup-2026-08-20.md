# Dirty dashboard trust and decision-clarity — 2026-08-20

This is the carried-forward DD-01 through DD-10 backlog and implementation
receipt. It covers dashboard presentation and deterministic read-only research
only. It authorizes no trading, configuration, roster, research publication,
merge, or deployment action.

Status legend: `VERIFIED LOCAL` means present on this branch with selftests,
TypeScript, production build, fixture QA, and authenticated SELECT-only
normal-zoom visual QA passing. Nothing here is live until separately approved,
merged, and deployed.

| Item | Status | Local implementation |
| --- | --- | --- |
| DD-01 honest evidence scopes | VERIFIED LOCAL | Inspector/Atlas now exposes Current Settings, Comparable Evidence, and All Channel History with sessions, logical opportunities, source breakdown, and count explanations. |
| DD-02 persistent source identity | VERIFIED LOCAL | Virtual rows, current execution, Atlas, manager counterfactuals, and capacity replay retain visible source labels. |
| DD-03 reconcile era policies | VERIFIED LOCAL | Virtual and executed readers retain forward provenance; exact current follows the latest channel behavior spec rather than unrelated portfolio receipt churn. Shared axis compatibility excludes route, priority, roster, and release churn while keeping capacity portfolio-era aware. |
| DD-04 session-aware maturity | VERIFIED LOCAL | Decision-ready requires at least 5 independent sessions and 10 logical opportunities. |
| DD-05 maturity/freshness default | VERIFIED LOCAL | Default order is decision-first; through-date, sessions, freshness, and weak-session sorts are first-class. Raw metric sorting is explicitly separated. |
| DD-06 demote path sums | VERIFIED LOCAL | Coverage and distributions lead. Any sum is labeled non-additive hypothetical evidence and is never presented as portfolio P&L. |
| DD-07 expose tails/outliers | VERIFIED LOCAL | Weak/typical/strong session evidence, positive-session coverage, largest-winner concentration, and a deterministic fragile classification are available. |
| DD-08 honest native-path language | VERIFIED LOCAL | Typical best move replaces ambiguous average language; T/S/B is defined as hypothetical native target/stop/bell. |
| DD-09 explain ledger/Atlas counts | VERIFIED LOCAL | Selected-channel cards compare cohort counts and explain different windows/configuration relations instead of displaying competing truths. |
| DD-10 actionable lineup and visuals | VERIFIED LOCAL | Six score-free lineup groups, Entry → Finish fleet map, and Weak → Typical → Strong strip reuse Research and Inspector surfaces. |

## Shared evidence contract

- The primary unit is one logical opportunity; fills, tranches, runner rows,
  and manager arms never increase the trade count.
- `CURRENT SETTINGS` is the exact current channel-behavior cohort.
- `COMPARABLE EVIDENCE` is explicitly scoped to the decision axis.
- `ALL CHANNEL HISTORY` is the widest available single source; actual,
  structural, virtual, manager, and capacity P&L are never added together.
- Entry compatibility follows strategy, signal, contract selection, DTE,
  strike, and entry parameters.
- Exit comparisons keep compatible entry evidence while preventing incompatible
  exit settings from being silently pooled.
- Manager comparisons require compatible opportunities and quote coverage.
- Quantity-only changes retain per-contract evidence. Capacity and displacement
  remain portfolio-era aware.
- Route, roster, priority, account receipt, and release receipt churn do not
  reset unaffected entry/exit evidence.
- Genuine behavior changes create a new exact-current cohort and keep earlier
  cohorts as labeled history.
- A published brief without the new same-cohort session distribution is labeled
  `BRIEF NEEDS REFRESH`. Its current sample remains visible, but the comparable
  fleet map and actionable `NEXT` are withheld instead of being reconstructed
  from a different cohort.
- Favorable move is floored at zero, and a below-entry finish retains 0% of the
  favorable move. Operator cards no longer display negative “best move” or
  negative move-kept percentages.

## Score-free lineup contract

The default lineup is one of: `WORKING CONSISTENTLY`, `GOOD ENTRY · LEAKING
EXIT`, `WEAK ENTRY`, `PROMISING BUT FRAGILE`, `TOO EARLY / STALE`, or
`CONSISTENTLY NEGATIVE`. Total profit and win rate never choose the group.

First glance is limited to typical session, positive independent sessions,
typical best favorable move, typical share retained, and weak-session result,
plus scope,  sessions/opportunities, freshness, one `WHY`, and one `NEXT`.

## Acceptance fixtures

- `orb-ustop-ctl` through 2026-08-19: Current Settings `1s / 2`; Actual
  Executed `23s / 46`; Structural History `28s / 60`; Prospective Virtual
  `28s / 83`. Every claim names its supporting subset.
- `vb-curl-reversal-qqq`: the `137` ledger paths and `197` Atlas opportunities
  are explained as different source windows/cohorts, not competing trade counts.
- A two-path channel last observed 2026-08-03 is stale/early and cannot lead the
  2026-08-19 default lineup.
- A positive-median channel with a damaging loss tail is fragile, not simply a
  winner.
- Positive opportunity with a negative typical finish is an exit leak.
- Weak opportunity becomes weak entry or consistently negative only after the
  shared evidence floor and paired-manager check.
- Receipt-only churn retains comparable evidence; a genuine entry change does
  not.

## Verification status

- Full deterministic selftest suite — PASS.
- TypeScript and production build with the worktree's own dependencies — PASS.
- Fixture normal-zoom QA at wide/standard desktop, tablet, and mobile in cream
  and blackout — PASS.
- Empty, low-sample, stale, fragile, established, conflicting-source,
  executed-only, and virtual-only fixture/component coverage — PASS.
- Before references, after screenshots, hashes, and diff receipt — PASS.
- Authenticated SELECT-only live-data QA after market close — PASS on Research
  and Channel Inspector at desktop, tablet, and mobile sizes in cream and
  blackout. Broker status was flat and the desk reported afterhours.
- Existing production briefs through 2026-08-19 do not yet contain the new
  same-cohort session distribution. The branch fails honest with `BRIEF NEEDS
  REFRESH`; a separate authorized nightly brief publication is required after
  merge/deploy to populate the comparable fleet map.
- Separate operator approval before push, merge, deploy, schedule activation,
  or any production research publication.
