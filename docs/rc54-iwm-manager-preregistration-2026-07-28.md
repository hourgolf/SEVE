# RC5.4 IWM manager preregistration — 2026-07-28

Status: **LOCAL EXPERIMENT SPEC · SHADOW ONLY · ZERO CHANGE AUTHORITY**

## Question

For `breakout-alt-v3-iwm`, does the sealed `RC53-RIDE` behavior preserve enough
convexity to justify its giveback risk, or should a later release use
channel-specific profit protection?

This is not a global stop study. The 30% catastrophe stop remains fixed.

## Current evidence

The RC5.4 cohort currently contains one IWM opportunity:

- entry: July 27, 2026 at 10:11 ET;
- quantity: two paper contracts;
- actual result: approximately -31.5%;
- observed favorable excursion: approximately +191.8%;
- actual close: catastrophe stop.

All eight preregistered portable managers completed without censoring for that
source position. Selected modeled outcomes were:

| Manager | Meaning | Terminal return |
| --- | --- | ---: |
| `BELL/-30` | current ride-like comparator | -30.1% |
| `LOCK50/30` | all-out +50% target / -30% stop | +50.7% |
| `LOCK30/30` | all-out +30% target / -30% stop | +30.1% |
| `LOCK20/30` | all-out +20% target / -30% stop | +23.3% |
| `BANK20/RUN50` | bank half near +20%; runner +50% or floor | +11.6% blended |
| `ARM20/HALF-GIVEBACK` | arm at +20%; exit on half-peak giveback | +6.8% |

This proves that the observer captured the giveback. It does not prove that
`LOCK50/30` is the correct policy.

Older non-RC5.4 IWM rows have different quantities, configurations, and evidence
quality and must not be pooled into the prospective RC5.4 decision.

## Arms

No new runtime code is required. The existing observer already records:

- `BELL/-30` as the current ride-like comparator;
- `LOCK20/30`;
- `LOCK30/30`;
- `LOCK50/30`;
- `WIDE20/50`;
- `BANK20/RUN50`;
- `ARM20/HALF-GIVEBACK`;
- `BELL/no-stop` as a descriptive tail reference only.

`BELL/no-stop` is never an activation candidate.

## Evidence floors

### First review

Review after the earlier of:

- six independent RC5.4 IWM opportunities across at least three sessions; or
- Friday close, if fewer than six occur.

This review may refine the experiment but cannot activate a policy.

### Activation-quality review

Do not draft an executable change until there are at least:

- twelve independent same-configuration IWM opportunities;
- five distinct sessions;
- zero unexplained censors;
- complete immutable account routes and exit-quality receipts;
- at least two paths that cross +50%; and
- at least two paths that reach the catastrophe-stop region.

If the opportunity mix does not contain both favorable and adverse paths, the
sample is not decision-complete regardless of count.

## Primary comparisons

Evaluate manager returns normalized to original debit. Do not optimize raw
portfolio dollars across changing quantities.

Primary:

1. mean and median terminal return versus `BELL/-30`;
2. worst terminal return and catastrophe-stop overshoot;
3. fraction of paths that turn a +50% excursion into a loss;
4. profit retained as a fraction of peak favorable excursion.

Secondary:

1. win rate;
2. time in position;
3. terminal quote age;
4. sensitivity to one extreme winner;
5. interaction with entry clock, call/put side, and gap regime.

## Decision rule

A candidate may advance to a draft proposal only if it:

- improves median normalized return over `BELL/-30`;
- reduces winner-to-loser reversals;
- does not worsen the adverse tail beyond the existing -30% boundary;
- remains positive when the single best path is removed; and
- is coherent by path, not merely the pooled winner.

If no arm satisfies all conditions, keep `RC53-RIDE`.

## Guardrails

- No global TP/SL change.
- No quantity change.
- No entry-rule change inside this experiment.
- No use of mutable current configuration to relabel older evidence.
- No proposal, activation, worker restart, or order action from this document.
