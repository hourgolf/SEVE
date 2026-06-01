---
strategy_id: fade
name: "The Fade"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: range-bound / high-IV chop
direction: directional
session_window: "10:00–15:25 ET"
---

# The Fade — VWAP mean reversion

> Exported from `engine/strategies/fade.ts` (`DEFAULT_FADE_PARAMS`).

## 1. Thesis
In a range-bound tape, stretches far from VWAP snap back. When price extends well
beyond the opening range AND beyond VWAP on *decelerating* momentum, buy the
reverting side (puts into an upside stretch, calls into a downside one) and target
a return to VWAP. Lives or dies on the regime gate — fading a trend is what bled
the naive version (it stopped out 64% of the time), so it only trades chop.

## 2. Signals & indicators
- **Opening range** (first 30 min) + **VWAP** + **ATR**.
- **Efficiency ratio (ER)** — the regime gate (only fade low-ER chop).
- **Momentum** — must be weak (decelerating) to enter.

## 3. Entry rules (mechanical)
```
LONG PUT  when: close > openRangeHigh AND (close − VWAP) > 1.5·ATR   (upside stretch)
            AND |momentum| < 0.6·ATR        (weak / decelerating)
            AND efficiencyRatio <= 0.4       (range regime only)
            AND opening range built AND >35 min to close
LONG CALL when: the mirror — a downside stretch below openRangeLow / VWAP
```
Strike: ATM. One position at a time.

## 4. Exit rules
- **Target** — price reverts to VWAP (the mean).
- **Stop** — the stretch extends 1.0·ATR further against us.
- **Time stop** — 20 minutes held.
- **EOD flatten** — 35 minutes to close.

## 5. Position sizing
`fund.equity × capital_pct% × aggression%`, capped at `max_contracts`.

## 6. Inputs required
1-min SPY OHLCV · session VWAP · ATR · efficiency ratio · 0/1DTE chain.

## Desk note (capability gap)
Same as The Breakout: the **efficiency-ratio** regime gate isn't in the importable
spec vocabulary yet — a re-import would flag it. The VWAP-deviation, opening-range,
and time rules map cleanly (`vwap_dev`, `opening_range`, `time_between`).
