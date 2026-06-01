---
strategy_id: breakout
name: "The Breakout"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: trending / expansion / news days
direction: directional
session_window: "10:00–15:25 ET"
---

# The Breakout — opening-range momentum

> Exported from `engine/strategies/breakout.ts` (`DEFAULT_BREAKOUT_PARAMS`). This
> is the desk's own built-in channel described in the import format so it can be
> examined / diffed / re-tuned alongside imported channels.

## 1. Thesis
The first 30 minutes set the day's reference range. When price breaks and *holds*
beyond it with a volume expansion on a trending tape, the move tends to continue
far enough for an ATM 0DTE option to expand. Fewer, bigger trades — the trend-day
counterpart to The Fade, built to win exactly when the Fade bleeds.

## 2. Signals & indicators
- **Opening range** — high/low of the first 30 minutes.
- **VWAP** + **ATR** (1-min) for break distance and stops.
- **Efficiency ratio (ER)** — trend vs chop (0 = chop, ~1 = clean trend).
- **Relative volume** — current bar vs trailing average.
- **Momentum** — close − close[3], in ATRs.

## 3. Entry rules (mechanical)
```
LONG CALL when: close > openRangeHigh + 0.5·ATR
            AND momentum > 0.3·ATR
            AND efficiencyRatio >= 0.35      (trend gate — skip chop)
            AND relativeVolume >= 1.3        (volume expansion)
            AND opening range is built (>30 min) AND >35 min to close
LONG PUT  when: the mirror below openRangeLow
```
Strike: ATM. One position at a time.

## 4. Exit rules
- **Trailing stop** — exit if price retraces 1.5·ATR off its peak-favorable.
- **Failed break** — exit if price snaps back 0.75·ATR inside the range.
- **EOD flatten** — force flat at 35 minutes to close.

## 5. Position sizing
`fund.equity × capital_pct% × aggression%`, contracts = ⌊budget ÷ (ask×100)⌋,
capped at `max_contracts`.

## 6. Inputs required
1-min SPY OHLCV · session VWAP · ATR · efficiency ratio · relative volume · 0/1DTE chain.

## Desk note (capability gap)
The **efficiency-ratio** trend gate is core to this channel but is *not* in the
importable StrategySpec vocabulary yet (which has rel_vol / rsi / ma_cross / vwap /
opening_range / time). A re-import would flag ER as a gap — useful signal for what
the spec layer still needs.
