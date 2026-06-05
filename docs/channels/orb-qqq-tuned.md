---
name: "QQQ ORB (tuned)"
strategy_id: orb-qqq-tuned
underlying: QQQ
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45-15:00 ET"
---

# QQQ ORB (tuned) — the importable, arm-able cost-disciplined breakout

> **Import THIS** (not `breakout-qqq.md`) when you want the cost-disciplined retune as a
> live **compiled** channel. The slug is `orb-qqq-tuned` on purpose — a slug ending in
> `-qqq`/`-spy` would base-resolve to the breakout *code* in the worker and ignore this spec.
> It carries **no `management` block**, so it arms (the cost gate + premium stop that ARE live
> get applied automatically by the worker — they don't belong in the thesis).

## Thesis
The first 30 minutes set QQQ's opening range. A volume-backed break that holds the VWAP side
trends far enough for an ATM 0DTE option to expand. QQQ's wider 0DTE premiums mean each
round-trip costs more, so the bar to enter is higher than SPY's standard ORB: demand a wider
range, more volume, a stronger thrust — then let the winner run further.

## Entries
Buy a CALL when ALL of these hold:
- price breaks above the 30-minute opening-range high
- the opening-range width is at least 0.30% of price
- price is above VWAP
- momentum over the last 5 bars is at least +0.40 ATR
- relative volume is at least 1.5x the recent average
- it is before 15:00 ET

Buy a PUT when ALL of these hold:
- price breaks below the 30-minute opening-range low
- the opening-range width is at least 0.30% of price
- price is below VWAP
- momentum over the last 5 bars is at most -0.40 ATR
- relative volume is at least 1.5x the recent average
- it is before 15:00 ET

## Exits
- Take profit at +90% of the option premium.
- Stop out at -50% of the option premium.
- Flatten any open position by 15:30 ET (never hold a 0DTE into the close).
