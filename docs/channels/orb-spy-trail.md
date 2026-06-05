---
name: "Breakout · SPY (trailed v2)"
strategy_id: orb-spy-trail
underlying: SPY
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45-11:30 ET"
---

# Breakout · SPY (trailed v2) — the net-POSITIVE momentum channel

> **The headline result of the trail build.** Selective AM opening-range momentum + a live
> ATR-chandelier trail. On real H1-2026 fills (a CHOP regime) it nets **+$455, +$12.64/trade
> positive expectancy**, 36% win, $2.7k drawdown — versus the live `breakout` code channel on SPY
> (−$9,853, 14% win, $9.9k DD). A ~$10,300 swing, and the first positive-expectancy channel on the
> desk. Arms live via the chandelier trail (worker `2026-06-04e`).

## Thesis
The first 30 minutes set SPY's range. A volume-backed morning break that holds the VWAP side
trends. Take ONLY the strongest, earliest breaks (most of the day's edge is in the first two
hours), enter an ATM 0DTE option in the break direction, and **trail the underlying** — let the
rare big-trend day pay for the small stops, and don't bleed cost on marginal afternoon setups.

## Entries — selective, AM-only
Buy a CALL when ALL of these hold:
- price breaks above the 30-minute opening-range high
- the opening-range width is at least 0.50% of price
- price is above VWAP
- momentum over the last 5 bars is at least +0.6 ATR
- relative volume is at least 1.8x the recent average
- **it is before 11:30 ET**

Buy a PUT on the mirror (below the OR low, below VWAP, momentum ≤ −0.6 ATR, rel-vol ≥ 1.8, < 11:30).

## Exits
- **1.5·ATR underlying chandelier trail** (`management.trail` mode `atr_chandelier`, baseK 1.5):
  once in profit, exit when price retraces 1.5 ATR from the peak favorable price. This is the exit.
- **No premium stop, no fixed target** — let the trail run; losers exit on the time/EOD flatten.
- Flatten by 15:30 ET.

> Why it beats the code: 36 trades (vs 182) → 1/4 the cost; selective AM entry filters chop; the
> trail harvests the tail fixed targets clip. This is the `orb-spy-trail` channel
> (21_v2_trail_channels.sql) — arm it next week alongside the base `breakout` to A/B live.
> Caveat: 36 trades is a small sample in one chop regime — the live 5-session A/B is the real test.
