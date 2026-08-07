# Prepared SEVE changes — 2026-08-07

These are independently reversible proposal packets against active manifest `sha256:eb54dd…71fcb`. Nothing has been applied, deployed, or written to production.

## Executing roster

| Channel | Account | Current | Prepared | Entry / exit / manager | Result |
|---|---|---:|---:|---|---|
| `breakout-alt-v3-iwm` | FIRST-TEAM | 2 contracts | 2 contracts | unchanged | stays |
| `grind-v3` | MORGUE | 2 | 2 | unchanged | stays |
| `momo-shape-2` | FIRST-TEAM | 2 | 2 | unchanged | stays |
| `orb-qqq-trail` | FIRST-TEAM | 2 | 2 | unchanged | stays |
| `orb-ustop-ctl` | MORGUE | 2 | **4** | unchanged | stays and sizes up |
| `pb-ride` | FIRST-TEAM | 2 | 2 | unchanged | stays |
| `vb-gap-drift` | PAPER-2 | 2 | 2 | unchanged | stays |
| `vb-macd-state` | LAB | 2 | 2 | unchanged | stays |
| `vb-ribbon-cross-qqq` | LAB | 2 | 2 | unchanged | stays |
| `pb-ride-2` | not executing | proposed 2 | **blocked pending registration and placement** | preserve its evidence-producing configuration | not added yet |

No executing channel is being removed. The root remains nine channels until the separately blocked `pb-ride-2` promotion is resolved and approved.

## Collector changes

| Channel | Current | Prepared | History | Executing roster |
|---|---|---|---|---|
| `breakout-manual` | collecting | **pause collection** | preserved | no change |
| `vb-gap-drift-iwm` | collecting | **pause collection** | preserved | no change |
| `vb-macd-state-iwm` | collecting | **pause collection** | preserved | no change |
| `vb-squeeze-break-iwm` | collecting | **pause collection** | preserved | no change |
| `vb-pm-trend-qqq` | already paused | preserve pause | preserved | no change |

All other collectors retain their current state. The prepared preview moves collection totals from 62 active / 6 paused to 58 active / 10 paused. It deletes nothing and can be reversed with new collection-state receipts.

## Exact sizing change

Only `orb-ustop-ctl` changes size:

| Field | Before | After |
|---|---:|---:|
| Contracts | 2 | **4** |
| Maximum debit | $400 | **$800** |
| Maximum modeled stop exposure | $120 | **$240** |
| +30% bank / A13 runner allocation | 1 / 1 | **2 / 2** |

Its signal, 0DTE ATM selector, $2 premium cap, −30% catastrophe stop, +30% bank, A13 runner, MORGUE routing, admission priority, and three-entry session cap remain unchanged. The increased debit and risk envelopes are mechanical consequences of doubling quantity, not independent tuning.

Rollback is the exact prior manifest, returning quantity/debit/risk and the bank/runner lot split to 2 / $400 / $120 and 1 / 1.

## `pb-ride-2` promotion boundary

The intended configuration that produced its evidence is 2 contracts, SPY 0DTE ATM, −30% premium stop, +20% all-out take-profit, stand-down event policy, no pyramiding, and the existing 120-minute / 25%-favorable stall rule.

It is not activation-ready for two reasons:

1. Its production research registration has no durable strategy cartridge or candidate channel spec and is currently `registered-blocked`.
2. Adding it to the control admission domain would compete with `pb-ride` because that domain permits one SPY candidate per clock and one open position per family. A different account alone does not solve the domain-level collision.

The recommended design direction is a LAB-domain/account experiment, which preserves independent `pb-ride` and `pb-ride-2` exits. That is a routing/admission configuration choice and has deliberately not been made silently. It needs a complete cartridge/spec followed by a fresh collision and capacity preview.

## Configuration summary

- Entry changes: **none prepared for existing channels**.
- Exit or manager changes: **none**.
- Routing/account changes: **none ready now**.
- Sizing changes: **`orb-ustop-ctl` 2 → 4 only**.
- Collection changes: **four reversible pauses; one existing pause preserved**.
- Retune experiments: **none activated**.
- `pb-ride-2`: configuration documented, but promotion remains blocked rather than pretending its collision placement is solved.

The local receipt records zero production writes and no order, configuration, or activation authority.
