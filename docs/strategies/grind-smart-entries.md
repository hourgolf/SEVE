---
name: "Grinder (Smart Entries)"
strategy_id: grind-smart-entries
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum bursts"
session_window: "10:00–15:50 ET"
---

## Thesis
The Grinder channel's entry logic, run single-leg with simple premium-based risk
(no scale-out / trail management — that's backtest-only). Lean into short bursts of
clean, volume-backed momentum. NOTE: the desk's spec exits can't replicate grind's
original 5-minute time-stop, so a position is held to a premium target, a premium
stop, or the end-of-day flatten rather than scalped out on a fixed clock.

## Entries
Buy a CALL when ALL of these hold:
- momentum (close vs 3 bars ago, in ATRs) is at least +0.5
- relative volume is at least 1.1x the recent average
- the efficiency ratio is at least 0.4
- it is before 15:50 ET

Buy a PUT when ALL of these hold:
- momentum (close vs 3 bars ago, in ATRs) is at most -0.5
- relative volume is at least 1.1x the recent average
- the efficiency ratio is at least 0.4
- it is before 15:50 ET

## Exits
- Take profit at +50% of the option premium.
- Stop out at -40% of the option premium.
- Flatten any open position by 15:50 ET.
