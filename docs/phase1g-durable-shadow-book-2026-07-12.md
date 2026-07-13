# Phase 1G — durable post-close manager book

Status: **design only; implementation not started**. Phase 1F remains the active
paper observer. This specification requires operator ratification before a
migration or runtime change.

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

Add a private operational table, tentatively `manager_shadow_runs`, with one row
per `(position_id, manager_id, manager_policy_version)`.

Required identity and provenance:

- deterministic `id` UUID; `position_id`, `strategist_id`, `account_id`
- `channel_slug`, `occ_symbol`, `underlying`, `option_side`
- `manager_id`, `manager_policy_version`, `cohort_from`
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
4. do not advance a manager whose durable enrollment failed.

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

The five-minute value is **[INFERRED — requires ratification]**. Changing it
creates a new policy version; it is not a tunable dashboard preference.

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

## 7. The one-contract / fractional-manager fallacy

`BANK20/RUN50` mathematically averages a half bank and half runner. That is a
useful normalized policy experiment, but it is not executable when the source
position contains one contract. Calling that outcome “tradable” would repeat
the old mistake of turning a research convenience into an operational claim.

Phase 1G must publish two explicit classes:

- `whole_lot_executable`: stop / all-out target / all-out trail / bell policies,
  and any multi-leg policy whose integer quantities are actually feasible for
  the source size;
- `normalized_fractional`: fractional counterfactuals such as half-bank / half-
  runner when source quantity is one. These help compare shapes and choose a
  future sizing experiment, but are excluded from executable P&L rankings.

No conviction sizing or scale policy is authorized by 1G. After evidence grows,
a later preregistered paper experiment may deliberately enter two or more lots
to test integer scale-outs. It must not retrofit fractional history as if those
fills occurred.

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
12. a one-contract `BANK20/RUN50` result is labeled
    `normalized_fractional` and excluded from executable ranking;
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

## 11. Ratification required before 1G-A

1. Approve a dedicated `manager_shadow_runs` table rather than repurposing
   `shadow_management_state`.
2. Approve the five-minute-before-close cutoff for v1, or choose a different
   fixed research cutoff.
3. Approve retaining terminal state rows for audit (rather than deleting them
   after the append-only receipt is written).
4. Approve the hard separation between executable whole-lot rankings and
   normalized fractional research.

Until those four items are ratified, Phase 1G is a spec only and Phase 1F keeps
collecting right-censored paper evidence without changing Monday's trade flow.
