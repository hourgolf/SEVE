# SEVE Weekend Day 1 Readiness — 2026-07-17

Status: authoritative weekend execution plan. This commit is documentation-only and does not change
the dashboard, worker, database, strategy configuration, orders, capture behavior, or deployment state.

## Objective

Make Monday, 2026-07-20, the first prospective paper session in which SEVE can turn every material
channel decision into comparable, versioned evidence. The weekend is successful when Monday's roster
is intentionally complementary or deliberately experimental, every executed trade and dark candidate
has truthful provenance, and exit/sizing alternatives can be evaluated without multiplying redundant
paper positions.

Monday is **Day 1 of the evidence-qualified platform**, not a claim that the channels are newly invented
or already optimized. Existing pre-Monday data remains development evidence. No result from this plan
authorizes live-money trading or automatic promotion.

## Starting point

The branch point for this plan is `origin/main@1f6b0f74962a83486031d79161e1049349517374`.
The deployed held-contract observer is `stream-2026-07-17a`. Railway deploys from `main`, but automatic
deployment is disabled; every worker deployment is a separate manual operator action.

At 13:16 PT on July 17, SELECT-only production evidence showed:

- 66 paper positions opened and all 66 closed; zero remained open;
- all 66 positions were multi-contract and had peak/trough observations;
- all 66 positions had manager-shadow runs and held-contract capture receipts;
- 534 manager runs total: 528 terminal, zero active, six truthfully censored;
- the six censors were `BELL/no-stop` runs with `no_fresh_cutoff_bid`: two each for
  `breakout-alt-v3-iwm`, `breakout-smart-entries-iwm`, and `vb-squeeze-break-qqq`;
- 102,545 targeted held-contract samples, of which 101,554 were eligible;
- zero provider request failures, stale quote events, observation gaps, dropped samples, or capture
  health incidents; maximum observed interval was 11,378 ms;
- seven family-admission observations, all involving sibling collisions;
- 1,179 blocked `vb-*` decisions and 139 reconstructed virtual trades; most active VB variants reached
  the current six-round-trip-per-channel/day reconstruction cap.

The July 17 ORB path demonstrates why the platform now needs channel-specific management evidence.
`orb-ustop` entered six contracts at $1.53, peaked at $2.70 (+76.5%), and closed at $0.13
(-91.5%, -$840). The observation-only manager book recorded materially different outcomes on the same
root fill, including positive fixed-lock and bank/runner paths. This is evidence that alternatives are
being measured, not evidence that one manager is universally optimal.

## Immediate yellow gates

### 1. Receipt fragmentation and storage efficiency

July 17 produced 20,794 held-capture receipt rows averaging 4.93 samples per segment. Raw compressed
R2 evidence was only 15.39 MiB, while the Supabase receipt table plus indexes reached 36 MiB. The raw
evidence volume is acceptable; metadata fragmentation is not. This is the first implementation
priority after the July 17 receipt is frozen.

Any fix must preserve content addressing, position/OCC identity, dual freshness clocks, append-only
receipts, queue bounds, and execution isolation. It may change batching/partition persistence only. It
must not change provider sampling, manager semantics, orders, channel configuration, or the strict
15-second quote-event rule.

### 2. Bell cutoff censoring

The six `no_fresh_cutoff_bid` manager runs are truthful rather than silently estimated. Determine whether
they represent expected illiquid cutoff behavior, an observer scheduling boundary, or a missing final
snapshot. Do not substitute a midpoint, last stale quote, or approximate snapshot.

### 3. VB evidence quality

The existing VB Bench is the canonical virtual candidate lane. Do not build a duplicate. Its current
nightly reconstruction is useful for screening but remains entry-ask/exit-mid synthetic, capped at six
round trips per channel/day, and disconnected from the newer exact held-contract evidence standard.
The upgrade should establish canonical candidate identity, coalesce repeated blocked decisions into
independent opportunities, preserve exact OCC/clock/config provenance, acquire exact T+1 CBBO paths,
and replay the manager suite on those paths.

### 4. Arbitrary or unresolved native settings

Many channel TP, stop, risk, maximum-contract, runner, re-entry, and stall values predate the current
evidence system. They are not protected merely because they are deployed. The weekend audit must mark
each value as intentional, development-supported, normalized research baseline, arbitrary, unsafe, or
unresolved. A reasonable Monday baseline is allowed; it must not be represented as learned or optimal.

## Non-negotiable boundaries

1. Paper-only. `liveMoneyAuthorized` remains false.
2. No automatic channel promotion, relegation, sizing, configuration, merge, or deployment.
3. One primary implementation owner. Parallel agents may inspect, test, and challenge; they do not make
   overlapping edits or independently merge/deploy.
4. Freeze July 17 before implementation. Do not rewrite, delete, pool, or relabel its receipts.
5. Development and prospective cohorts remain separate. Monday begins a new prospective cohort only
   after its policies are sealed.
6. Siblings sharing one opportunity clock are one correlated experimental group, not independent samples.
7. Exit-only variants should normally share one executed root fill and run in shadow. Multiple paper fills
   are reserved for real differences in admission, timing, DTE, strike, contract selection, or underlying.
8. Stops and managers are channel-specific. Account-wide safety may sit above them but cannot replace them.
9. Quantity is whole-lot and policy-compatible. Max contracts is a ceiling, not a target, and there is no
   universal four-contract doctrine.
10. Missing entry, fill, path, manager, outcome, collision, operator, or provenance evidence is censored;
    it is never converted to zero or approximated.
11. Service-role credentials remain server-side. No secrets enter the repository or browser bundle.
12. R2 stores raw high-cadence evidence; Supabase stores compact verification receipts and operator-readable
    facts. New exposed tables require explicit grants, RLS, policies, and advisor review.
13. Worker/engine changes require a worker-version bump and manual Railway deployment verification.
14. Review before merge. Strategy/configuration changes require an explicit operator-ratified table before
    they are applied.

## Work sequence

### Gate 0 — Freeze and audit July 17

Complete before changing capture or configuration:

- verify all paper broker books are flat and reconcile to the desk;
- verify final manager states and classify all six censors;
- verify the held-contract object/manifest/receipt chain and sample coverage;
- verify the final Sentinel event receipt has the correct `session` and `forDate`;
- inspect the local morning/capture publisher's final exit state;
- verify post-close day report and VB reconstruction completion;
- record R2 and Supabase storage counts and checksums;
- render an immutable, local evidence audit with exact query timestamps and source versions.

Acceptance: flat reconciliation, no unexplained active manager, no silent capture loss, every yellow item
classified, and the July 17 audit frozen before code changes.

### Gate 1 — Harden held-contract persistence

- reproduce the 4.93-sample segment fragmentation with a deterministic fixture;
- design batching that reduces receipt/object count without losing partition identity or increasing the
  execution callback's work;
- preserve retry-stable object/manifest identity and append-only receipts;
- test timer, high-water, shutdown, retry, crash-window, R2 failure, receipt failure, queue pressure, shared
  OCC fan-out, and hour/session partition boundaries;
- calculate projected Supabase and R2 volume under the revised batching;
- deploy only after a flat desk, review, full tests, worker-version bump, and manual Railway action.

Acceptance: materially fewer receipts and larger useful segments, unchanged sample/quality semantics, no
manager/execution dependency on storage, and a dark post-deploy smoke receipt.

### Gate 2 — Extend VB Bench onto exact candidate evidence

- retain the existing `not_armed` signal and `virtual_trades` lane;
- define one canonical candidate/opportunity identity from channel version, source clock, underlying, side,
  OCC, and configuration epoch;
- coalesce repeated per-minute decisions without erasing legitimate re-entry opportunities;
- emit a held-candidate ledger suitable for exact T+1 Databento retrieval;
- store content-addressed exact paths in R2 with compact Supabase receipts;
- replay preregistered manager arms using executable bid-side exits;
- retain native synthetic results as a separately labeled development basis;
- censor unavailable/invalid exact contracts rather than substituting snapshots.

Acceptance: no duplicate shadow system, no order path, deterministic candidate identity, exact provenance,
and a tested adapter from candidate receipt to manager/evidence scorecard.

### Gate 3 — Audit channel configurations

For every paper, dark, benched, and disabled channel, produce a review table containing:

- family, underlying, executor, lifecycle, source hash, deployed runtime, policy epoch;
- distinct entry hypothesis and matched opportunity clock;
- risk dollars, max contracts, family concurrency and concentration tags;
- DTE, strike, event posture and re-entry policy;
- premium/structural/catastrophic stops;
- target, bank/runner allocation, giveback, stall and EOD policy;
- current evidence basis and outcome partitions;
- classification of every mutable value: intentional, supported, baseline, arbitrary, unsafe, unresolved;
- recommended Monday baseline, shadow alternatives, and the evidence needed for the next change.

Acceptance: no placeholder performance, no guessed manager/family, no inherited account stop represented as
channel policy, and every Monday field either resolved or explicitly blocked.

### Gate 4 — Design the complementary Monday roster

- identify redundant same-clock siblings and the single executed root they can share;
- retain controlled siblings only for admission/timing/DTE/strike/contract/underlying contrasts;
- cover complementary breakout, continuation/pullback, grind, momentum, and mean-reversion hypotheses where
  evidence and operational readiness permit;
- keep SPY, QQQ, and IWM cohorts separate;
- assign family-level concurrency/risk so correlated fills do not masquerade as diversification;
- keep unqualified VB candidates dark; select at most a small, explicitly justified LAB paper set;
- estimate expected opportunity count, capital occupancy, contract count, provider load, and evidence volume.

Acceptance: each executed channel has a distinct operational reason, each sibling has a named comparison,
and redundant exit-only siblings have moved to shadow rather than multiplying paper exposure.

### Gate 5 — Preregister and seal Day 1

- freeze the Monday roster, strategy versions, manager versions, configuration values, opportunity clocks,
  family identities, and evidence endpoints;
- stamp immutable source/configuration hashes and policy epochs;
- define Monday, 2026-07-20 ET, as the prospective cohort start;
- preserve existing Phase 1K-C/1K-E contracts unchanged;
- add new tests only as new versioned contracts with later holdouts;
- require operator review of the full proposed configuration diff before applying it.

Acceptance: deterministic receipt hash, clean development/holdout boundary, no retrospective endpoint change,
and no automatic promotion authority.

### Gate 6 — Verify, deploy, and rehearse

Minimum relevant verification includes:

- `npx tsc --noEmit` and `npm run build`;
- `npm run runner-selftest`;
- `npm run manager-shadow-selftest`;
- `npm run manager-shadow-book-selftest`;
- `npm run family-admission-selftest`;
- `npm run held-contract-capture-selftest`;
- `npm run session-exit-replay-selftest`;
- `npm run channel-contract-selftest`;
- `npm run current-channel-inventory-selftest`;
- `npm run family-preregistration-selftest`;
- `npm run family-preregistered-scorer-selftest`;
- `npm run market-calendar-selftest`;
- Supabase security/performance advisors for any migration;
- browser/mobile operator smoke for any dashboard change;
- flat paper/broker reconciliation before migration or worker deploy;
- manual Railway deployment and post-deploy heartbeat/version/capture verification.

Sunday rehearsal must run the complete Monday pre-open gate against the sealed configuration without placing or
closing an order.

### Gate 7 — Monday operation

Before open, verify production web/auth, paper-only mode, worker/run-ledger freshness, stream/cron state,
market-data provenance, broker/desk reconciliation, incident state, Sentinel receipt, local capture publisher,
R2/Supabase capture readiness, and exact sealed policy identity.

During the session, monitor health and evidence only. Do not tune a parameter intraday. Operator closes remain
allowed and must retain rationale/outcome partitions. After close, render the first Day 1 family/manager scorecard
without pooling it into development evidence.

## Evidence floors after Day 1

The unit is an independent family opportunity, not contracts or sibling fills.

- capture infrastructure: at least three clean sessions before snapshot-fresh evidence informs a manager version;
- early continue/reject research: 10 complete matched opportunities across at least five sessions, or 20 exact
  paths across at least five sessions, consistent with the frozen Phase 1K-E contract;
- provisional paper-policy change: normally 30–50 independent opportunities across at least 10 sessions, with
  positive aggregate and median improvement, acceptable tails, and no one-session dependence;
- stronger paper promotion: normally 100+ independent opportunities across 20+ sessions and multiple regimes,
  followed by an untouched prospective holdout.

One catastrophic giveback can disqualify an incoherent native policy from being the baseline. It cannot, by
itself, identify the optimal replacement.

## Agent operating model

Use three parallel read-only agents and one primary owner:

1. **Evidence auditor** — July 17 reconciliation, cutoff censors, R2/Supabase integrity, Sentinel/publisher/day
   report, and storage projections.
2. **Channel/configuration analyst** — full configuration inventory, development path distributions, arbitrary
   knobs, and family-specific baseline proposals.
3. **Experimental-design reviewer** — sibling independence, complementary roster, leakage/overfitting,
   preregistration, and evidence-floor challenge.
4. **Primary owner** — resolve disagreements, write the canonical plan, create/edit the implementation branch,
   run verification, prepare commits, and control review/merge/deployment gates.

Agents return concise evidence with file/query references. They do not change Supabase/R2, edit overlapping
files, alter configuration, place/close orders, merge, or deploy. The primary agent uses Sol High for the core
program; read-heavy scans may use Terra Medium; reserve Sol Extra High for the final adversarial review rather
than the entire weekend.

## Deliverables

1. Frozen July 17 evidence audit.
2. Capture batching/efficiency implementation and storage projection.
3. Exact candidate-path extension for the existing VB Bench.
4. Full channel configuration audit and recommended Monday baseline table.
5. Complementary/controlled Monday roster.
6. Sealed Day 1 policy/preregistration receipt.
7. Verification report, deployment record, and Sunday rehearsal.
8. Monday pre-open and post-close Day 1 reports.

## Stop conditions

Stop and report rather than weaken a guard when:

- broker/desk reconciliation is not flat before a migration or worker deploy;
- July 17 evidence identity or manifest verification fails;
- exact provider evidence is refused or unavailable;
- a proposed roster/configuration field cannot be derived truthfully;
- capture batching changes quote clocks, loses samples silently, or touches execution;
- a migration lacks reviewed RLS/grants/policies/advisor results;
- tests, build, preview, heartbeat, worker version, or production smoke are not green;
- the operator has not ratified the Monday configuration/roster diff.
