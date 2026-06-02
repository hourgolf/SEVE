---
name: "Power Hour (Smart Entries)"
strategy_id: power-smart-entries
structure: single-leg
direction: directional
dte_range: 0-0
regime: "final hour"
session_window: "15:00–15:45 ET"
---

## Thesis
The Power Hour channel's entry logic, run single-leg with simple premium-based risk
(no scale-out / trail — backtest-only). In the final hour, lean with the day's
established direction (VWAP side confirmed by momentum) and ride 0DTE convexity into
the bell; let winners run to a premium target or the forced close.

## Entries
Buy a CALL when ALL of these hold:
- price is above VWAP
- momentum (close vs 3 bars ago, in ATRs) is at least +0.25
- the time is between 15:00 and 15:45 ET

Buy a PUT when ALL of these hold:
- price is below VWAP
- momentum (close vs 3 bars ago, in ATRs) is at most -0.25
- the time is between 15:00 and 15:45 ET

## Exits
- Take profit at +100% of the option premium.
- Stop out at -50% of the option premium.
- Flatten any open position by 15:55 ET.
