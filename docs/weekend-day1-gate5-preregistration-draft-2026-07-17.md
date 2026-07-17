# Weekend Day 1 — Gate 5 preregistration draft

Status: **not sealed; prospective cohort cannot start until operator review and blockers are cleared**.

Prospective start, if authorized: Monday, `2026-07-20` ET. Paper only. No automatic promotion authority.
Existing Phase 1K-C and Phase 1K-E contracts remain unchanged.

## New prospective scorer contract

`weekend-day1-prospective-scorer-v1` applies only to sessions on or after `2026-07-20` ET. Every result key
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
- Invalid calendar dates, malformed identities, non-finite outcomes, and explicitly ineligible rows are
  censored. Valid pre-cohort dates are rejected rather than silently pooled into the new cohort.

The focused self-test covers the zero-delta denominator, channel/manager/configuration separation, exact
duplicates, conflicting duplicates, repeated ingestion, siblings on the same clock, invalid calendar and
format dates, complete/censored group counts, independent session/opportunity counts, and the pre-cohort
guard: 25/25 pass.

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

## Blocking items

1. The Gate 4 roster is not operator-ratified.
2. The corrected Gate 4 values, debit admission guard, collision/concurrency, market-input, open-limit,
   whole-lot, and EOD stamps are proposed but not implemented or ratified.
3. `orb-ustop-ctl` currently relies on an unstamped 50% default; the proposal replaces it with explicit
   -30%, but no configuration change is authorized.
4. The proposed cross-family SPY order `PB > Grind > MOMO > ORB` requires operator ratification.
5. Gate 2 receipt migration is review-only and unapplied; Supabase advisors and insert/RLS verification have
   not run.
6. Gate 1 is memory-bounded but not durable. The operator must choose 24/120 with a 600-second maximum
   retained exposure, the recommended 12/60 with 540 seconds, or require durable staging/recovery.
7. The new scorer resolves version identity, duplicate behavior, opportunity counts, and zero deltas
   prospectively, but its exact test roster, evidence floors, and final configuration identities cannot be
   frozen before Gate 4 ratification.

## Seal procedure after authorization

Render the canonical JSON, validate every root against the live SELECT-only inventory, validate paper mode
and flat books, compute SHA-256, and commit the receipt before applying configuration. Then apply only the
operator-ratified diff, re-read the fleet, and require the applied identities to match the seal exactly.
Any mismatch invalidates the prospective start; it is not patched intraday.

No Day 1 receipt was rendered or sealed in this correction pass.
