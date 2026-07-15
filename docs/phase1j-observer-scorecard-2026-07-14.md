# Phase 1J — deterministic observer scorecard

Status: implementation branch only. Read-only research tooling; no database
migration, worker runtime, strategy configuration, order, or dashboard behavior
is changed by this phase.

## Why this is next

Phase 1I made the two rejected global policies measurable: it records the
channel-specific `pb-ride-2` manager candidate and every possible one-survivor
arm when PB or SPY-ORB channels collide. Raw receipts are not a decision system.
Without a preregistered grader, a later review could cherry-pick winners, ignore
missing outcomes, conflate a threshold with promotion, or accidentally sum only
part of a correlated family.

Phase 1J adds the read-only command:

```text
npm run observer-scorecard -- --from YYYY-MM-DD --through YYYY-MM-DD
```

It writes a local JSON artifact under `data/observer-scorecards/` and prints a
short terminal receipt. It uses the existing backend credential only to read
the append-only observer and outcome tables.

## Family-admission grading

For each collision group:

1. collect every candidate opportunity id stamped by Phase 1I;
2. aggregate all `position_booked` outcome rows for each opportunity;
3. censor the whole group if any candidate lacks a booked outcome;
4. compute native cluster P&L as the sum of all candidates;
5. compute each sole-survivor arm as the kept candidate's booked P&L;
6. report the arm's delta versus the native cluster.

Malformed or incomplete arm definitions are censored. A partial family is never
presented as a completed result. Channel rollups retain family identity; PB and
ORB are not pooled into a generic leaderboard.

Survivor P&L is a counterfactual admission comparison, not a capital-normalized
portfolio return. Rejecting siblings would free risk capacity, but Phase 1J does
not invent how that capacity would have been redeployed.

## PB2 grading

The scorecard reads only manager id `PB2-BANK15/HALF-GIVEBACK` and separates:

- completed paths with both terminal modeled P&L and actual booked P&L;
- bank-triggered paths, identified by a stamped bank return;
- active paths;
- censored paths and terminal rows missing either side of the comparison.

Only completed paths enter modeled-versus-native P&L. The report retains actual
winning and losing path counts so a candidate cannot pass from one-sided evidence.

## Evidence gates

The default gates preserve the Phase 1I preregistration:

- at least 20 completed PB2 staged paths;
- at least 10 completed family collision groups;
- at least five independent ET session dates;
- both native winning and native losing paths in each relevant cohort.

The scorecard can say that an evidence floor is met. It can never promote a
channel or policy. Regime concentration, quote gaps, slippage sensitivity,
native-close censoring, and the distinction between enrolled versus actually
bank-triggered PB2 paths remain mandatory review items.

## Safety boundary

- pure scoring model owns no client, timer, subscription, or persistence;
- the CLI performs SELECTs only and writes one local JSON artifact;
- no execution module imports the scorer;
- no new production table, policy, grant, or environment variable is required;
- missing evidence reduces coverage; it never becomes zero P&L.

## Verification target

- pure self-test covers native winning and losing families, duplicate booked
  rows, missing outcomes, malformed arms, ET session grouping, PB2
  terminal/active/censored states, threshold injection, and the permanent
  no-automatic-promotion invariant;
- root and worker TypeScript remain clean;
- an empty live Phase 1I cohort produces a valid zero-row scorecard with unmet
  gates rather than an error or a false conclusion.
