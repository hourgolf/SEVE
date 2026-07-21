# Day 1 dark-candidate freeze — July 20, 2026

Status: research preparation only. Production, Supabase, R2, the Day 1 roster, strategy configuration,
manager policy, and order paths are unchanged.

## What was built

`dark-candidate-freezer-v1` is a deterministic, SELECT-only extractor for suppressed Day 1 entry
decisions. It joins the existing `signals` policy stamp to the independently persisted
`execution_observations` decision row, validates immutable policy identities and exact OCC identity,
and produces a local content-addressed freeze plus a deduplicated Databento `OPRA.PILLAR` / `cbbo-1s`
contract manifest.

The adapter has no Supabase mutation, R2 write, migration, policy/configuration mutation, deployment,
or order API. Generated session artifacts live under the gitignored
`data/dark-candidate-freezes/<session>/` path.

## Methodology correction

The freezer retains raw decision clocks; it does **not** label them independent trades. An earlier
candidate-selection approach could have used an approximate virtual exit to suppress later re-entry
clocks. That is selection-biased because different manager arms exit at different times. The new
contract defers sequential opportunity selection and re-entry eligibility until each manager is
replayed against the exact CBBO path.

Live Alpaca snapshot prices are non-exact provenance only. A missing or zero live ask does not erase a
valid decision clock, but no entry or manager outcome may be scored until Databento establishes the
exact ask/bid path and all boundary, continuity, contract-identity, and quote-validity guards pass.

## July 20 read-only freeze

Two consecutive reads produced the same canonical SHA-256:

`1d2c55b9584a1aebdf419c34a9464f74b681f237d92aa8084332cf23b9209512`

| Evidence | Result |
|---|---:|
| Suppressed entry signals read | 1,247 |
| Decision execution observations read | 1,237 |
| Validated one-to-one raw decisions | 1,237 |
| Explicitly censored signals | 10 |
| Deduplicated exact OCC requests | 40 |
| Maximum requested one-second rows | 648,503 |
| Decisions lacking a positive live snapshot ask | 1,147 |

Validated block reasons were 1,195 `day1_dark_lifecycle`, 27 `day1_reentry_disabled`, 10 `halted`,
and five `day1_spy_same_clock_collision`.

Six legacy signal rows were censored for `missing_source_bar_clock`. Four more signals occurred about
45 seconds after a mid-session configuration refresh but pointed to the deterministic execution row
from the earlier configuration. A five-second signal/execution clock guard censors those four as
`execution_identity_mismatch`. The retained set is therefore exactly one-to-one: 1,237 candidates
backed by 1,237 unique execution observations.

## Verification

- dark-candidate freezer: 21/21
- VB candidate evidence: 37/37
- Databento exact path: 19/19
- market calendar: pass, including regular and half-day boundaries
- root TypeScript: clean
- canonical live freeze: stable across two consecutive SELECT-only runs

## Next gate

At the July 20 T+1 provider gate, request only the 40 contracts in the frozen manifest. First obtain
the provider metadata/cost quote; no cost was invented locally. Stop on provider refusal or any
missing contract, left/right boundary, internal continuity, contract identity, or valid exact quote.
Do not substitute snapshots, mids, a nearby strike/expiry, or approximate data.

Only after all exact paths pass may the eight preregistered manager arms be replayed. Sequential
opportunities must be derived independently for each manager, with configuration epoch and manager
version kept in the score key. This freeze authorizes neither a Day 1 configuration change nor a
production release.
