---
name: "Breakout (Smart Entries)"
strategy_id: breakout-smart-entries
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "10:00–15:25 ET"
---

## Thesis
The Breakout channel's entry logic, run single-leg with simple premium-based risk.
The smart scale-out / breakeven / trail management is intentionally omitted — the
real-fills A/B showed it caps the 0DTE convex tail — so winners run to a premium
target or the close. Buy one at-the-money option on a clean, volume- and
momentum-confirmed opening-range break that holds its VWAP side.

## Entries
Buy a CALL when ALL of these hold:
- price breaks above the 30-minute opening-range high
- price is above VWAP
- momentum (close vs 3 bars ago, in ATRs) is at least +0.3
- the efficiency ratio is at least 0.45
- relative volume is at least 1.3x the recent average
- it is before 15:25 ET

Buy a PUT when ALL of these hold:
- price breaks below the 30-minute opening-range low
- price is below VWAP
- momentum (close vs 3 bars ago, in ATRs) is at most -0.3
- the efficiency ratio is at least 0.45
- relative volume is at least 1.3x the recent average
- it is before 15:25 ET

## Exits
- Take profit at +100% of the option premium.
- Stop out at -50% of the option premium.
- Flatten any open position by 15:25 ET.
