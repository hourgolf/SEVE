# Family exact-replay bridge — July 21, 2026

Status: research-only implementation prepared. No strategy configuration, roster, paper order,
Supabase/R2 data, schema, deployment, or production policy is changed.

## Why this bridge exists

The family observer now records the same-clock entry alternatives that the sealed Day 1 desk sees,
but a dark candidate has no fill and therefore no truthful outcome until its exact option path is
reconstructed. The bridge joins the observer's durable `opportunityId` to the frozen dark decision
and a checksum-verified Databento manager scorecard. It never substitutes the live Alpaca snapshot,
midpoint, nearby contract, or a made-up exit.

The paper root is deliberately different: it is not in the suppressed-candidate freezer. It may
enter the bridge only when the family receipt identifies it as `day1-paper-root` and retains the
release, configuration, OCC, and opportunity identities. Dark siblings still require their frozen
execution observation. This prevents a root from disappearing merely because it was allowed to
trade and prevents a dark sibling from bypassing the independent evidence join.

## Normalization and independence

- The eight manager policies common to every candidate are separate strata.
- The PB2-only ninth manager is retained as an explicit non-common censor; it is not silently pooled
  with the eight family-comparable policies.
- Entry is exact Databento ask and exit is executable Databento bid.
- Per-contract manager P&L is multiplied by the quantity recorded by the observer.
- The sealed candidate configuration identity and research manager-policy version remain separate.
- A later raw decision clock is censored while that channel's prior manager-specific path remains
  active. It is never double-counted as a new independent opportunity.
- Every observation keeps the all-siblings counterfactual cluster and each one-survivor arm. This is
  research comparison, not a claim that production should execute all siblings.

## Fail-closed conditions

Missing or duplicate candidates, missing paper-root provenance, candidate/clock mismatches, missing
or ineligible exact scorecards, missing manager arms, manager-policy mismatches, invalid exits,
malformed admission arms, and overlapping re-entry clocks all censor the affected comparison.

## Verification

- family exact-replay bridge: 16/16
- family preregistered receipt adapter: 12/12
- dark-candidate freezer: 21/21
- observer scorecard: 25/25
- exact VB candidate evidence: 37/37
- TypeScript: clean

## Next provider gate

After the session's exact contracts become available, the local runner consumes three immutable
inputs: the observer receipt, dark-candidate freeze, and exact manager scorecards. It emits a local
review artifact only. The first live-data run must stop on provider refusal, missing contracts,
checksum failure, boundary gaps, or any candidate that cannot be joined exactly.
