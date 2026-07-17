# Weekend Day 1 — Gate 5 preregistration draft

Status: **not sealed; prospective cohort cannot start until operator review and blockers are cleared**.

Prospective start, if authorized: Monday, `2026-07-20` ET. Paper only. No automatic promotion authority.
Existing Phase 1K-C and Phase 1K-E contracts remain unchanged.

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
2. All 68 channels lack complete collision/concurrency, market-input, open-limit, harvest, and EOD stamps.
3. `orb-ustop-ctl` relies on the unstamped 50% premium-stop default.
4. Cross-family SPY same-clock admission is unresolved.
5. Gate 2 receipt migration is review-only and unapplied; Supabase advisors and insert/RLS verification have
   not run.
6. Gate 1 has an in-memory abrupt-crash window bounded by the two-minute batch age plus drain phase; the
   operator must explicitly accept monitored loss bounds or require durable staging/recovery.
7. Phase 1K-E would pool pre-Monday and Monday configurations because its key omits channel/manager/config
   versions. A later versioned contract is required for changed policies.
8. The positive-share denominator discrepancy must be resolved in that later contract; existing results
   cannot be retrospectively reinterpreted.

## Seal procedure after authorization

Render the canonical JSON, validate every root against the live SELECT-only inventory, validate paper mode
and flat books, compute SHA-256, and commit the receipt before applying configuration. Then apply only the
operator-ratified diff, re-read the fleet, and require the applied identities to match the seal exactly.
Any mismatch invalidates the prospective start; it is not patched intraday.
