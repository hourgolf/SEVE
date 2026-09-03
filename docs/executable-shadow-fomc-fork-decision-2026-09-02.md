# Executable-shadow architecture and FOMC fork decision · 2026-09-02

This is a local decision packet. It creates no strategist, registration, manager assignment, roster membership, migration, order, position, or production write. The proposed SQL migration is intentionally unapplied, and the pilot output is publication-ineligible because the current `fomc-follow` research registration is `registered-blocked`.

## Executive decision

Do not promote or reinterpret the existing `fomc-follow` channel as an event strategy. It currently implements a generic 14:30–14:45 ET momentum rule and has no FOMC-calendar predicate.

Prepare two explicitly different observe-only forks:

1. `pm-momentum-follow` preserves the generic afternoon entry hypothesis. Its primary executable-shadow manager should be `FULL-R35-K67` with the canonical -30% pre-arm stop and a 15:25 ET force exit. Its matched control is `REFERENCE-NO-TP-S30`; the legacy -50% reference remains a diagnostic arm only.
2. `fomc-event-follow` implements the event hypothesis with a sealed calendar or explicit manual-arm receipt. It should begin with `REFERENCE-NO-TP-S30` as the primary manager and shadow `FULL-R35-K67`. The generic afternoon evidence must not be used to select its native manager.

Neither fork is ready for paper execution. The manager recommendation above is a research assignment, not evidence of a profitable channel.

## What the executable-shadow layer changes

The existing `virtual_trades` ledger asks what every hypothetical path did. The executable-shadow ledger asks what a stateful channel or portfolio could actually have admitted and closed from retained quotes.

```text
signal decision
  -> freeze first post-decision provider chain snapshot
  -> select wrapper without later-snapshot look-ahead
  -> require fresh ask, spread, and displayed size
  -> apply channel debit and stop-risk limits
  -> apply one-open-position and filled-entry limits
  -> optionally apply account, family, OCC, and collision limits
  -> enter at ask
  -> manage chronologically from executable bids
  -> emit immutable filled / blocked / censored receipt
```

The new local engine keeps exploratory virtual paths separate and models:

- ask entry and bid exit rather than midpoint execution;
- provider-clock freshness, spread, displayed size, and force-exit quote gaps;
- one open position per channel, filled-entry caps, and unresolved positions that continue to block later entries;
- per-channel debit and stop-exposure envelopes;
- account buying power, concurrent debit, concurrent stop exposure, underlying capacity, family protection, collision domains, and same-OCC protection;
- frozen channel priority for same-clock opportunities;
- cross-account same-OCC freedom;
- full-position all-out and full-position ratchet managers; and
- exact contract-selection, configuration, manifest/registration, and source provenance.

The proposed database tables are append-only and carry `execution_authority=false`, `runtime_mutation_authorized=false`, and `order_authority=false`. Only exact receipt-bound active configurations or paper-eligible immutable research registrations may be published. Mutable strategist state can be studied locally but cannot enter the durable ledger.

## FOMC evidence split

### Observed facts

- The current strategist is draft and not in the active receipt-bound manifest. It has no paper order authority and no actual fills.
- Its rule is ordinary-day afternoon momentum, not an FOMC-event rule. Recent signal rows have `eventDay:null`.
- The broad historical virtual cohort is negative: 46 paths across 44 sessions, median -$27.50 per contract, with 8 positive and 38 non-positive paths.
- Earlier virtual manager studies repeatedly favored an arm-at-35%, keep-two-thirds ratchet by about 19–20 percentage points, but those paths were not stateful executable fills.
- Retained provider-timestamped quotes currently support only two strict recent sessions, August 31 and September 1. They contain 32 repeated signals, 72 relevant contracts, and 24,394 quote rows.
- Quote rows in this retained window have no observed option delta. Delta-target wrapper claims are therefore unavailable. More-ITM arms are selected by same-expiry executable strike steps from the first post-decision chain poll.

### Supported inference

The generic entry logic often found a large intratrade favorable move in the two strict sessions, but the reference manager failed to monetize it. A ratchet is therefore the strongest manager hypothesis for the generic fork. That does not establish a positive entry edge: a manager can improve a losing entry family without making the family investable.

### Hypothesis

`FULL-R35-K67` may convert the generic afternoon channel's favorable excursions better than a no-target reference. One executable strike more ITM may reduce wrapper convexity/friction without exceeding the proposed envelope at two contracts.

### Missing evidence

- More than two strict independent sessions.
- Any multi-date, quote-complete FOMC-event cohort.
- A chronological holdout large enough to separate a stable manager effect from two favorable paths.
- A without-best-session result that is meaningful with more than two sessions.
- A live-roster portfolio replay; this pilot makes no portfolio collision or displacement claim.
- Observed chain delta or another retained Greek source for delta-target wrapper comparisons.

## Strict recent manager comparison

All figures below are ask-entry/bid-exit, same-opportunity, one open position per channel, two contracts, maximum debit $350, maximum stop exposure $105, provider clock required, displayed size required, maximum spread share 25%, and 15:25 ET force exit.

| Manager · signal-selected contract | Scored sessions | Result / contract | Change vs matched -30 reference | Improved |
|---|---:|---:|---:|---:|
| `REFERENCE-NO-TP-S50` | 2 | -$45 cumulative | -$11 | — |
| `REFERENCE-NO-TP-S30` | 2 | -$34 cumulative | control | — |
| `FULL-R35-K67` · -30 pre-arm stop | 2 | +$100 cumulative | +$134 | 2 / 2 |

The two `FULL-R35-K67` outcomes were +$40 and +$60 per contract. The same entries under the matched -30 reference were -$9 and -$25. There were no unmatched admissions in this comparison.

Strongest counterargument: both sessions had unusually large favorable excursions and both ratchet outcomes could be a two-session selection artifact. The evidence chooses a forward research arm; it does not justify promotion.

## ITM and capacity result

The contract selector freezes the first post-decision provider chain poll for every arm. It does not choose a later snapshot when the first snapshot is stale, illiquid, lacks delta, or lacks the requested strike.

| Quantity | Signal-selected fills | +1 ITM fills | +2 ITM fills | +3 ITM fills | Interpretation under $350 / $105 envelope |
|---:|---:|---:|---:|---:|---|
| 1 | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 | All wrappers fit; not the proposed operating size |
| 2 | 2 / 2 | 2 / 2 | 1 / 2 | 0 / 2 | +1 ITM is the deepest consistently admissible arm |
| 3 | 2 / 2 | 1 / 2 | 0 / 2 | 0 / 2 | +1 ITM changes the admitted opportunity set |
| 4 | 2 / 2 | 0 / 2 | 0 / 2 | 0 / 2 | Only signal-selected fits |
| 5 | 2 / 2 | 0 / 2 | 0 / 2 | 0 / 2 | First September 1 signal is debit-blocked; a later signal fills |
| 6 | 1 / 2 | 0 / 2 | 0 / 2 | 0 / 2 | One session is lost to debit/displayed-size limits |

At two contracts, `FULL-R35-K67` produced +$100 per contract cumulatively on the signal-selected wrapper and +$124 on +1 ITM, a +$24 same-opportunity difference with improvement on one path and a tie/rounding-equivalent result on the other. +2 ITM has only one matched scored session; +3 ITM has none.

Conclusion: keep the signal-selected wrapper as the primary arm so the manager comparison remains isolated. Add +1 ITM as a paired wrapper shadow at two contracts. Do not make +1 ITM native and do not infer that deeper is better. +2 and +3 ITM are capacity diagnostics under this envelope, not viable two-contract arms.

## Proposed fork specifications

### Generic afternoon fork: `pm-momentum-follow`

| Field | Proposed research setting |
|---|---|
| Posture | observe-only |
| Entry | exact current 14:30–14:45 ET momentum logic, renamed honestly |
| Filled-entry cap | 1 per session |
| Modeled quantity | 2 |
| Debit / stop-risk envelope | $350 / $105 |
| Primary wrapper | signal-selected near-ATM contract |
| Wrapper shadow | one executable same-expiry strike more ITM, frozen from the same first chain snapshot |
| Primary manager | `FULL-R35-K67`, -30% pre-arm stop, 15:25 ET force exit |
| Matched manager control | `REFERENCE-NO-TP-S30` |
| Legacy diagnostic | `REFERENCE-NO-TP-S50` |
| Evidence status | local-only until a paper-eligible immutable registration exists |

Minimum review gate: at least 10 independent strict sessions and 10 scored primary/control pairs, plus chronological half-window stability, without-best-session stability, wrapper admission/censor analysis, and portfolio capacity/collision/displacement replay. Passing the gate permits a promotion decision; it does not make promotion automatic.

### Event fork: `fomc-event-follow`

| Field | Proposed research setting |
|---|---|
| Posture | observe-only |
| Entry gate | sealed FOMC calendar or explicit manual-arm receipt; no ordinary-day signals |
| Filled-entry cap | 1 per event session |
| Modeled quantity | 1 initially; size is diagnostic until event liquidity exists |
| Primary wrapper | signal-selected contract with exact observed quote provenance |
| Primary manager | `REFERENCE-NO-TP-S30` |
| Manager shadow | `FULL-R35-K67`, -30% pre-arm stop |
| Evidence boundary | never pool generic afternoon sessions with event sessions |

Initial checkpoint: five quote-complete independent FOMC dates to evaluate feasibility and effect size. No manager promotion decision should occur before that checkpoint. A later sample-size gate should be set from the observed event effect rather than borrowed from the generic strategy.

## Lifecycle recommendation for the old root

Keep the existing `fomc-follow` collector unchanged only until both fork registrations, signal routing, and ledger provenance are verified. Then pause the mislabeled root to prevent continued contamination and preserve its history under its original name. Do not rename it in place; that would make old ordinary-day evidence look event-specific.

## GO / NO-GO

- **GO:** finish the local executable-shadow infrastructure and prepare immutable observe-only registrations for the two forks.
- **GO:** primary generic research arm `FULL-R35-K67` versus matched `REFERENCE-NO-TP-S30`, with +1 ITM as a separate paired wrapper arm at two contracts.
- **NO-GO:** paper promotion, native trading authority, deeper-than-+1-ITM at two contracts, or any claim that FOMC-event behavior has been validated.
- **NO-GO:** applying the migration, publishing receipts, creating forks, pausing the old collector, committing, pushing, merging, or deploying without separate approval.

## Confidence

- High: the event and generic theses must be separated, and the current root must not be treated as an event strategy.
- Moderate: `FULL-R35-K67` is the correct primary executable-shadow manager for the generic fork.
- Low: the generic entry family is profitable, +1 ITM is superior, or either fork deserves paper execution.

## Next implementation phase requiring approval

1. Apply the append-only executable-shadow migration.
2. Wire the SELECT-only nightly runner to publish only provenance-eligible receipts.
3. Create immutable observe-only registrations for `pm-momentum-follow` and `fomc-event-follow`.
4. Add the two manager controls and +1 ITM paired arm without execution authority.
5. Surface one concise dashboard status per fork: admitted/scored/censored, primary-versus-control result, next evidence gate, and explicit `OBSERVING` label.
6. Verify account-policy portfolio mode against the current receipt-bound roster before making any collision or displacement claim.

These steps add research storage, nightly computation, registrations, and dashboard reads. They do not authorize broker actions, but a later merge to `main` can automatically redeploy both Vercel and Railway and must be approved as a coupled release.
