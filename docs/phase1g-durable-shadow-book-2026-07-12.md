# Phase 1G — durable post-close manager book

Status: **1G-A plus the 1G-B dark runtime are built locally; not applied,
enabled, pushed, merged, or deployed**. Phase 1F remains the active production
paper observer.
The operator ratified the dedicated table, five-minute cutoff, retained terminal
rows, and separated economics by authorizing 1G-A on 2026-07-12. The same
authorization confirmed that go-forward paper entries will use at least four
contracts and that scaling must be modeled as executable integer lots.

## 1. Decision this phase is meant to unlock

Phase 1F can answer which registered exit manager fires first while the real
position remains open. It cannot fairly score an alternative that would have
held after the active manager or the operator closed the real trade. Those
outcomes are right-censored, which systematically favors earlier exits and hides
the exact ORB / momentum giveback problem this program is intended to solve.

Phase 1G creates a durable, observation-only **shadow book**. Each qualifying
paper entry enrolls the eight preregistered managers. Their independent clocks
continue on fresh executable option bids after the real position closes, until
each manager reaches its own stop, target, trail, or session cutoff.

The deliverable is comparable manager evidence, not a manager promotion. No
result from this phase may change an entry, size, order, active stop, active
target, or manual-close behavior.

## 2. What already exists, and what must not be confused with 1G

The repository already has two different counterfactual systems:

1. `shadow_management_state` runs the channel-specific `engine/manage.ts`
   scale / breakeven / trail simulation on the one-minute bar-close loop. It is
   restart-safe and already continues after the actual close. Its primary key is
   one row per position and it models only the management block assigned to that
   channel.
2. Phase 1F's `managerShadowState` runs all eight portable
   `engine/managerPolicy.ts` policies on the approximately ten-second
   executable-bid sweep. It produces deterministic append-only terminal
   receipts, but its working state is in memory and is deleted when the actual
   row leaves the open-position sweep.

Phase 1G extends the second system. It must not overload or reshape
`shadow_management_state`: that would merge different clocks, price models, and
manager identities into a one-row-per-position table that cannot represent
eight concurrent policies.

## 3. Hard invariants

1. **Research cannot trade.** The shadow-book module cannot import
   `executeExit`, `orderAndFill`, broker position reads, or broker order reads.
2. **Executable basis.** A manager advances only on a fresh OPRA bid carrying a
   source quote timestamp. Mid, last, and theoretical value are diagnostics.
3. **Observed fill, not threshold fill.** If a ten-second poll sees +27% after a
   +20% target was crossed, the counterfactual exit is +27%. It may not invent a
   fill at +20%.
4. **Independent clocks.** Closing or reconciling the actual position records
   the actual outcome but does not terminate any still-active shadow manager.
5. **Durable before continued observation.** A post-close manager is evaluated
   only after its enrollment and current state are durably present. A database
   failure may create missing research evidence; it may never affect execution.
6. **First terminal wins.** Terminal identity is deterministic by actual
   position, manager ID, and policy version. Retries and restarts cannot rewrite
   the first terminal observation.
7. **No stale-price fiction.** Missing, zero, crossed, or stale bids produce a
   skipped observation. They do not fire a manager and do not become a $0 exit.
8. **One policy epoch, one cohort.** Manager definitions, cutoff semantics,
   quote freshness, and economic mode are stamped. Evidence from different
   versions is never silently pooled.
9. **Paper only.** Enrollment requires a paper fund/account context. The module
   remains disabled for a non-paper desk even though it cannot place orders.

## 4. Durable model

Add a private operational table, `manager_shadow_runs`, with one row per
`(position_id, manager_id, manager_policy_version, shadow_book_version)`.

Required identity and provenance:

- deterministic `id` UUID; `position_id`, `strategist_id`, `account_id`
- `channel_slug`, `occ_symbol`, `underlying`, `option_side`
- `manager_id`, `manager_policy_version`, `shadow_book_version`, `cohort_from`
- injected `quote_max_age_ms` and fixed `cutoff_minutes_before_close`
- `entry_price`, `entry_price_basis`, `entry_at`, `original_qty`, `actual_close_at`,
  `actual_close_reason`, and `actual_realized_pnl`
- `source_boot_id` and created / updated timestamps

Required operational state:

- `status`: `active | terminal | censored`
- `manager_state` JSON object (bank crossing, armed peak, and any future state)
- `peak_return_pct`, `bank_return_pct`, `last_bid`, `last_quote_at`,
  `last_observed_at`, and consecutive quote-miss count
- terminal time, bid, return, trigger, quote age, and terminal boot ID
- `economic_mode`: `whole_lot_executable | normalized_fractional`
- optional censor code and fact when a terminal price cannot be observed

The row is mutable operational state, not the audit receipt. On transition to
terminal, Phase 1G also inserts the existing deterministic
`execution_observations` terminal receipt with `blocked_reason=observation_only`.
That append-only receipt remains the analysis ledger. The state row remains for
audit and readout rather than being deleted.

Access policy follows the Phase 1B private tables: service role owns writes;
only authenticated users with `app_metadata.seve_role=operator` may select;
`anon` receives no grant. No Realtime publication is needed for the first slice.

## 5. Enrollment and lifecycle

### Enrollment

On the first fresh bid observed for a qualifying newly opened paper position:

1. derive eight deterministic run IDs from the position and policy version;
2. upsert immutable entry/provenance fields and initial manager state;
3. stamp the actual entry price used by the position as `entry_price` and label
   whether it is a broker fill or an observation; do not mislabel a fill as bid;
4. inject and stamp the quote-freshness limit; 1G-A deliberately chooses no
   production value for this parameter;
5. do not advance a manager whose durable enrollment failed.

Boot hydration loads every `active` run for the supported cohort. A restart no
longer infers bank/arm state from the actual position's `peak_mark`; it restores
the precise first crossing and peak from its own durable row.

### Observation tick

Create a separate `shadowManagerBookTick` with its own mutex and bounded market
data request. It runs at the configured fast-exit cadence during the supported
session even when there are no open desk positions. It does not sit below
`fastExitSweep`'s current `if (!allRows.length) return` boundary.

For each fresh targeted quote, advance all active managers for that OCC in
memory, then persist only a meaningful state transition: first bank, first arm,
new armed peak, actual-close attribution, terminal, or censor. Do not write a
database row every ten seconds merely to restamp the same state.

The actual-close lineage from Phase 1E is copied into each manager run once it
is positively observed. It is context, never a shadow terminal condition.

### Session terminal

`isBell` is a research-policy cutoff, not whatever time the actual manager
happened to flatten. Phase 1G must introduce a named, versioned cutoff and use
`sessionCloseMin(date)` for regular and half days. Proposed v1:

- `shadowCutoffMinutesBeforeClose = 5`, matching the worker's wall-clock hard
  flatten and providing a realizable pre-close bid;
- the final fresh bid at or immediately before the cutoff is the terminal bid;
- if no bid fresher than the quote-age threshold exists, wait through a short
  settlement grace and then mark `censored: no_fresh_cutoff_bid`; never use a
  stale last value.

The five-minute value was ratified with 1G-A. Changing it creates a new
`shadow_book_version`; it is not a tunable dashboard preference.

The quote-freshness limit is also a stamped shadow-book input. The pure 1G-A
model requires it but does not select a live value. 1G-B must ratify that value
before runtime wiring; changing it creates a new `shadow_book_version` and
evidence cohort.

## 6. Quote path

The current underlying-chain snapshot filters strikes around current spot. A
contract can drift outside that window after an early actual close, causing a
false data disappearance. Phase 1G therefore uses a targeted OCC request for
the distinct contracts in active runs, batched to the provider limit, rather
than widening every underlying chain.

Alpaca's current official [multi-contract option snapshot endpoint](https://docs.alpaca.markets/us/v1.4.2/reference/optionsnapshots)
accepts up to 100 contract symbols per request. The adapter must retain each
latest quote's source timestamp, bid, ask, and feed. The provider response time
is not a substitute for the quote timestamp. Batches are deduplicated by OCC
across accounts and managers.

The initial load is tiny (at most the day's distinct entered contracts). Add a
hard cap and a loud degraded-health event before allowing unbounded growth. A
request failure skips the whole affected batch for that tick and leaves prior
state untouched.

## 7. Confirmed four-plus-contract scaling contract

The operating plan now confirms at least four contracts on every go-forward
paper entry. Phase 1G therefore models quantities, fills, returns, and P&L as
integer-executable lots rather than continuing the one-contract normalization.
The cohort constant is `MIN_MODELED_SOURCE_QTY=4`; a smaller source position is
ineligible for the go-forward executable cohort and cannot silently enter its
rankings.

For `BANK20/RUN50`, v1 uses a deterministic whole-lot split:

- `bankQty = floor(originalQty / 2)`;
- `runnerQty = originalQty - bankQty`;
- four contracts become 2 bank / 2 runner;
- five contracts become 2 bank / 3 runner;
- terminal return and P&L are quantity-weighted across the two fills, never a
  naive average of bank and runner returns.

Every all-out stop, target, trail, and bell manager records `exitQty` equal to
the original integer quantity. `ARM20/HALF-GIVEBACK` is an all-out exit whose
threshold is half of peak return; “HALF” does not mean half of the contracts.

Phase 1G must publish two explicit classes:

- `whole_lot_executable`: stop / all-out target / all-out trail / bell policies,
  and any multi-leg policy whose integer quantities are actually feasible for
  the source size;
- `normalized_fractional`: fractional counterfactuals such as half-bank / half-
  runner when source quantity is one. These help compare shapes and choose a
  future sizing experiment, but are excluded from executable P&L rankings.

No conviction multiplier or pyramiding policy is authorized by 1G-A. The fixed
four-plus operating size makes registered scale-outs testable, but does not let
the shadow book choose trade size. Historical one-lot normalized outcomes stay
clearly separated and may not be retrofitted as if integer fills occurred.

## 8. Failure isolation and observability

- The shadow tick owns no execution mutex and no execution state.
- Database writes are serialized/coalesced per manager run. Slow persistence
  cannot delay an order or the live fast-exit sweep.
- Hydration failure leaves the shadow book disabled/degraded for that boot; it
  does not rebuild approximate state and present it as clean evidence.
- Quote, persistence, and terminal-receipt failures have separate counters and
  rate-limited events.
- Worker health reports active runs, terminal runs today, censored runs today,
  oldest active age, quote-miss count, and last successful shadow tick.
- A deployment/restart is not a censor event. Hydrated active rows resume.
- Expiration, unsupported contract, policy-version mismatch, and missing fresh
  cutoff bid are explicit censor codes rather than $0 outcomes.

## 9. Acceptance matrix

The implementation is not reviewable without deterministic tests for at least:

1. actual closes at +12%; LOCK20 later observes +23% and terminates at the
   observed +23%, not +20% and not +12%;
2. actual closes while all managers remain active; the shadow tick continues
   when `positions.status=open` has zero rows;
3. restart after a +24% bank/arm crossing restores the exact durable crossing
   and peak, not the Phase 1F +20 recovery approximation;
4. two accounts holding the same OCC share one quote request but retain separate
   position/manager identities;
5. one position creates eight independent runs and eight deterministic terminal
   identities;
6. stale, zero, crossed, and missing bids never advance or terminate;
7. target overshoot records the observed bid and source quote time;
8. targeted OCC remains observable after moving outside the underlying chain's
   strike window;
9. regular day, early close, holiday, and DST boundaries use the market calendar;
10. no fresh cutoff bid produces an explicit censor after grace;
11. a rejected database write changes no execution call count, order payload,
    active position state, or sweep timing;
12. four- and five-contract `BANK20/RUN50` runs allocate 2/2 and 2/3; the
    five-lot return is quantity-weighted rather than averaged, while a one-lot
    allocation is labeled `normalized_fractional` and excluded;
13. duplicate/retried terminal inserts preserve the first terminal receipt;
14. deployment between actual close and shadow terminal resumes without censor;
15. non-paper mode enrolls and advances nothing.

## 10. Proposed implementation slices

### 1G-A — schema and pure lifecycle

- migration for `manager_shadow_runs`, constraints, indexes, RLS, and grants;
- pure codec/state transition model and deterministic identities;
- economic-mode classifier and the full acceptance selftest;
- no timer, quote request, or runtime wiring.

### 1G-B — targeted market-data adapter and dark runtime

- targeted multi-OCC snapshot adapter with source timestamps and batching;
- boot hydration, enrollment, independent shadow tick, persistence coalescing;
- actual-close attribution and deterministic terminal observations;
- worker health counters; still no UI and no execution reads.

### 1G-C — readout and decision gate

- authenticated read model showing completed, active, and censored outcomes;
- separate executable-whole-lot and normalized-fractional scoreboards;
- minimum sample / session coverage and censor-rate reporting;
- no promotion switch. Any manager change remains a later, explicit paper A/B.

## 11. Ratification record for 1G-A

1. Approve a dedicated `manager_shadow_runs` table rather than repurposing
   `shadow_management_state`.
2. Approve the five-minute-before-close cutoff for v1, or choose a different
   fixed research cutoff.
3. Approve retaining terminal state rows for audit (rather than deleting them
   after the append-only receipt is written).
4. Approve the hard separation between executable whole-lot rankings and
   normalized fractional research.

All four items were ratified when the operator authorized 1G-A on 2026-07-12.
That authorization is limited to the local schema and pure lifecycle slice: the
migration must not be applied, no runtime may be wired, no branch may be merged
or deployed, and Monday's production trade flow remains Phase 1F until a later
explicit review and approval.

## 12. Local 1G-A implementation receipt

Built on isolated branch `phase1ga-durable-shadow-book` with no production
mutation:

- additive, unapplied `manager_shadow_runs` migration with UUID foreign keys,
  lifecycle constraints, query indexes, RLS, explicit grants, operator-only
  authenticated reads, required source-boot provenance, and retained terminals;
- pure enrollment, integer-allocation, bid-advance, actual-close attribution,
  censor, terminal-receipt, encode, and strict hydration functions;
- deterministic run and append-only receipt identities compatible with the
  existing Phase 1F trace namespace, plus a separate versioned durable-receipt
  identity so unlike observation rules cannot collide;
- 109 deterministic checks, including 4-lot 2/2 and 5-lot 2/3 allocation,
  quantity-weighted return/P&L, overshoots, stale/crossed/out-of-order quotes,
  terminal immutability, restart recovery, provenance failures, and static
  migration security invariants.

The live database was inspected read-only to verify the referenced IDs are UUIDs
and that `manager_shadow_runs` does not exist. The migration has not been
applied. No market-data adapter, timer, persistence call, worker configuration,
or execution path was added; those remain 1G-B work requiring a separate review.
The live `quote_max_age_ms` remains intentionally unresolved until that review.

## 13. Local 1G-B dark-runtime receipt

Built on isolated branch `phase1gb-dark-shadow-runtime`; not applied, enabled,
pushed, merged, or deployed. The runtime flag defaults to false.

The 1G-B evidence cohort uses `quote_max_age_ms=15000`. This was selected from
the first full paper session's 1,706 Alpaca snapshot observations: median age
1.514s, p95 4.071s, p99 9.552s, and maximum 17.137s. Fifteen seconds admits the
normal distribution while deliberately rejecting the observed extreme tail.
The value is stamped into every run and the runtime refuses a mismatched env
override; changing it requires a new shadow-book version.

The local implementation adds:

- an official multi-contract Alpaca snapshot adapter, deduplicated and batched
  to 100 OCC symbols, with a 500-contract hard cap and independent batch-failure
  isolation;
- strict normalization of executable OPRA bid/ask plus `latestQuote.t`; response
  time, last trade, mid, zero, crossed, timestamp-less, future, and stale values
  cannot advance a manager;
- boot hydration of active and retained terminal/censored rows, deterministic
  enrollment for paper positions of at least four contracts, exact state
  restoration, and first-terminal optimistic persistence;
- a separate mutex/timer from the live fast-exit sweep, continuing after the
  actual row closes and copying the actual result as attribution only;
- regular/half-day five-minute cutoffs, a 30-second fresh-quote settlement
  grace, explicit censoring for a missing cutoff bid or a process that resumes
  after the enrolled session, and retry-safe terminal evidence receipts;
- rate-limited health output for active, terminal, censored, pending-receipt,
  quote, and last-success counts.

The module imports no execution or broker order/position functions. Database,
quote, hydration, and receipt failures only reduce research coverage. They do
not share the execution mutex, mutate a position, or alter an order payload.
