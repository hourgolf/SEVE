---
name: "ORB Trend Rider"
strategy_id: orb-trend-rider
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45–15:00 ET"
---

## Thesis
After the first 30 minutes set the day's opening range, a volume-backed break that
holds the VWAP side tends to trend. Buy one at-the-money 0DTE option in the break
direction when the range is wide enough to be worth trading and momentum confirms,
then manage the position purely on the option premium.

## Entries
Buy a CALL when ALL of these hold:
- price breaks above the 30-minute opening-range high
- the opening-range width is at least 0.25% of price
- price is above VWAP
- momentum over the last 5 bars is at least +0.3 ATR
- relative volume is at least 1.3x the recent average
- it is before 15:00 ET

Buy a PUT when ALL of these hold:
- price breaks below the 30-minute opening-range low
- the opening-range width is at least 0.25% of price
- price is below VWAP
- momentum over the last 5 bars is at most -0.3 ATR
- relative volume is at least 1.3x the recent average
- it is before 15:00 ET

## Exits
- Take profit at +75% of the option premium.
- Stop out at -50% of the option premium.
- Flatten any open position by 15:30 ET (never hold a 0DTE into the close).
