# Weekend Day 1 — Gate 5 preregistration draft

Status: **operator-ratified local release candidate; not yet sealed in this commit**.

Prospective start, if authorized: Monday, `2026-07-20` ET. Paper only. No automatic promotion authority.
Existing Phase 1K-C and Phase 1K-E contracts remain unchanged.

## New prospective scorer contract

`weekend-day1-prospective-scorer-v2` applies only to sessions on or after `2026-07-20` ET. Every result key
contains the control and challenger channel slug/version, manager version, and configuration epoch. Rows
with different identity tuples produce separate scores and can never be pooled. Pre-cohort rows are rejected,
so the new scorer cannot reinterpret Phase 1K-C/1K-E evidence.

The prospective zero-delta rule is
`all_complete_groups_including_zero_delta`: zero deltas remain in the complete-group denominator but do not
count as positive outcomes. Thus one positive, one zero, and one negative row yield a positive share of
1/3. The prior scorer and every prior result remain byte-for-byte and semantically unchanged. The new scorer
has no policy, production, or promotion authority.

### Duplicate-safe identity and counts

A prospective comparison is canonically identified by test ID, comparison ID, completed source clock,
ET session date, control policy identity, and challenger policy identity. Each policy identity contains
channel slug/version, manager version, and configuration epoch. The receipt fingerprint separately covers
provenance ID, both P&Ls, and eligibility.

- Byte-equivalent reingestion with the same identity and fingerprint is ignored and counted in
  `exactDuplicatesIgnored`; it does not inflate complete groups or become a censor.
- The same identity with any different fingerprint is a conflict. The entire comparison identity is
  excluded from scoring, every conflicting input row is counted as censored, and the group increments
  `conflictingDuplicateGroups`.
- Distinct sibling comparison IDs at one source clock remain distinct completed groups, while
  `independentOpportunities` counts that session/clock once. `independentSessions` counts the ET session
  once per policy comparison.
- Every score emits an `opportunityClusters` metric keyed by ET session plus completed source clock. The
  invariant requires cluster comparison-group counts to sum exactly to `completedGroups`; this makes
  correlated sibling observations visible without pretending they are independent opportunities.
- The first-review evidence floor is met only when the same policy test has at least 10
  `independentOpportunities` across at least five `independentSessions`. `completedGroups` never substitutes
  for either requirement. Meeting the floor authorizes review only, never promotion or a policy change.
- Scores remain separate policy comparisons. `portfolioWeightingRule=null` and
  `portfolioClaimAuthorized=false`; sibling P&L must not be aggregated into a portfolio claim unless a
  separate prospective weighting rule is preregistered first.
- Invalid calendar dates, malformed identities, non-finite outcomes, and explicitly ineligible rows are
  censored. Valid pre-cohort dates are rejected rather than silently pooled into the new cohort.

The focused self-test covers the zero-delta denominator, channel/manager/configuration separation, exact
duplicates, conflicting duplicates, repeated ingestion, opportunity clusters and their invariant, siblings
on the same clock, invalid calendar and format dates, complete/censored group counts, the two-part evidence
floor, prohibition on unweighted portfolio claims, and the pre-cohort guard.

## Proposed immutable content

The final receipt must include only canonical decision content:

- exact executed roots and shadow/dark roster;
- strategist/source/channel versions, manager versions, configuration epochs, and worker release;
- exact opportunity clocks, source-bar lag bounds, underlying/side/OCC identity rules, re-entry policy;
- family and cross-family collision identities, concurrency, risk, open-position, and contract ceilings;
- explicit premium/structural/catastrophic stops, whole-lot harvest allocation, giveback, stall, and EOD;
- market-data/calendar provenance and freshness limits;
- Supabase receipt tables and R2 prefixes/schema/checksum rules;
- censor rules, evidence floors, prospective cohort start, and development/holdout boundary;
- paper-only and `policyChangeAuthorized=false`, `productionChangeAuthorized=false` invariants.

The canonical hash must exclude generated timestamps, local paths, usernames, environment values, query
timing, and other machine-dependent metadata. Those belong in an envelope outside the sealed content.

## Remaining release boundary

Gate 1, the six-root roster, exact two-lot/debit limits, -30% catastrophe stop, 15:25 ET behavior,
concurrency/collision guards, scorer floor, and local durable lifecycle are ratified. Gate 2 schema remains
design-approved but unapplied before T+1. The only remaining local prerequisite is full verification followed
by rendering and hashing the immutable receipt from the final code/configuration identities. Application,
migration, merge, push, and deployment remain separate operator-review boundaries.

## Seal procedure after authorization

Render the canonical JSON, validate every root against the live SELECT-only inventory, validate paper mode,
compute SHA-256, and commit the receipt before applying configuration. A later separately authorized release
must re-read the fleet and require the applied identities to match the seal exactly. Any mismatch invalidates
the prospective start; it is not patched intraday.

The receipt is rendered only in the subsequent isolated seal commit after verification succeeds.
