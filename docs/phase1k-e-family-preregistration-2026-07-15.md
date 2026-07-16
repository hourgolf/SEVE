# Phase 1K-E — PB / ORB / Grind / QQQ / IWM preregistration

Status: frozen research contract. No worker, strategy configuration, database,
dashboard, order, deployment, or production behavior changes.

## Boundary

These hypotheses were written after the July 15 paper session and therefore
cannot use July 15 as validation evidence.

- version: `phase1k-e-family-preregister-v1`;
- canonical contract SHA-256:
  `c76ee87c51fdec215b3b624c8495951ee2f74f1c4b3b6eca205e274840e1e015`;
- development evidence ends: **2026-07-15 ET**;
- untouched prospective evidence begins: **2026-07-16 ET**;
- development and holdout rows may never be pooled;
- only native closed positions with booked P&L and exact CBBO-1s paths qualify;
- operator closes, tests/corrections, incomplete paths, and invalid quotes are
  censored rather than converted to zero;
- QQQ and IWM remain separate underlying cohorts;
- every result remains review-only and has no promotion or execution authority.

This does not alter Phase 1K-D. The older MOMO/VB policy
`phase1k-c-preregister-v1` was frozen before July 15, so July 15 remains its
legitimate untouched holdout.

## Frozen tests

| ID | Question | Minimum evidence | Primary endpoint |
|---|---|---:|---|
| `PB-COLLISION-ONE-SURVIVOR` | Can one PB survivor reduce correlated cluster loss? | 10 complete collisions / 5 sessions | survivor delta vs native cluster |
| `PB-RIDE2-VS-RIDE-CAPTURE` | Does Ride-2 convert its higher observed opportunity into better realized capture? | 10 matched clocks / 5 sessions | paired realized P&L delta |
| `ORB-SPY-COLLISION-ONE-SURVIVOR` | Can one SPY-ORB survivor reduce duplicated family risk? | 10 complete collisions / 5 sessions | survivor delta vs native cluster |
| `ORB-TREND-VS-USTOP-CTL-CAPTURE` | Does Trend retain its development advantage over the u-stop control? | 10 matched clocks / 5 sessions | paired realized P&L delta |
| `GRIND-V3-VS-V3-2-CAPTURE` | Does v3 convert higher MFE into better realized capture than v3-2? | 10 matched clocks / 5 sessions | paired realized P&L delta |
| `GRIND-SMART-PATH-VIABILITY` | Do Smart entries show repeatable upside without severe adverse paths dominating? | 20 exact paths / 5 sessions | +10% touch rate |
| `QQQ-THRUST-VS-WD-CAPTURE` | Does standard Thrust outperform the wide-downside variant? | 10 matched clocks / 5 sessions | paired realized P&L delta |
| `QQQ-ORB-PATH-VIABILITY` | Do QQQ-ORB entries show repeatable executable upside? | 20 exact paths / 5 sessions | +10% touch rate |
| `IWM-ALT-VS-SMART-CAPTURE` | Does IWM alt-v3 outperform the smart-entry control? | 10 matched clocks / 5 sessions | paired realized P&L delta |

Matched clocks require the same completed `source_bar_at`, underlying, and
call/put side. Collision tests require the durable Phase 1I family observation
and a booked outcome for every candidate; partial families are censored.

## Review rules frozen before July 16

For a one-survivor arm or challenger to earn **more paper research**, not
promotion, all applicable conditions must hold:

- positive delta in at least 60% of complete groups or matched clocks;
- positive aggregate and median delta;
- no more than 50% of positive delta from one ET session;
- for paired variants, median MAE may not deteriorate by more than five
  percentage points;
- both positive and negative native outcomes must exist.

For single-channel path viability, at least 50% of exact paths must touch +10%
before native close and no more than 25% may observe MAE at or below -30%.
These are gates for continued manager/admission research, not claims of edge.

All secondary endpoints remain visible: paired MFE, MAE, realized capture,
+10/+15 touches, median time to peak, quantity, capital, and session
concentration. A favorable primary total cannot hide worse tails or one-day
concentration.

## Why this is deliberately conservative

Development evidence through July 15 is small and correlated. It showed useful
entry opportunity in places where native realized P&L remained poor, and it
showed that sibling channels can multiply the same bet. That is enough to frame
future tests, not enough to tune thresholds or choose winners.

No scale-out or stop change is introduced here. Stops remain per channel. Any
future target, runner, stop, timing, contract-selection, or survivor rule must
become a new version with a later untouched holdout.

## Machine lock

The exact test list, channel membership, evidence floors, endpoints, review
rules, provenance boundary, and safety flags live in
`lib/research/familyPreregistration.ts`. Its self-test pins a canonical SHA-256
of the complete contract so a silent edit fails verification.
