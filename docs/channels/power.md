---
strategy_id: power
name: "Power Hour"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 0]
regime: any tape, final hour only
direction: directional
session_window: "15:00–15:57 ET"
---

# Power Hour — final-hour 0DTE gamma lean

> Exported from `engine/strategies/power.ts` (`DEFAULT_POWER_PARAMS`).
> **DRAFT thesis** — backtest on real option_bars before arming.

## 1. Thesis
0DTE gamma is largest into the close. Sit flat until the final hour, then lean
*with* the day's established direction (price vs VWAP, confirmed by momentum) and
ride the convexity into the bell. Cap the downside with a tight stop; force flat
just before the close so a 0DTE is never held into expiry.

## 2. Signals & indicators
- **VWAP** (day direction) + **momentum** (confirmation) + **ATR** (stop).
- **Time-to-close** — the only-active-in-the-final-hour gate.

## 3. Entry rules (mechanical)
```
LONG CALL when: minutesToClose <= 60        (the power hour)
            AND close > VWAP AND momentum > 0.25·ATR
            AND minutesToClose > 3
LONG PUT  when: close < VWAP AND momentum < −0.25·ATR  (mirror)
```
Strike: ATM. One position at a time.

## 4. Exit rules
- **Stop** — adverse move of 1.0·ATR against the lean.
- **EOD flatten** — force flat at 3 minutes to close (never hold 0DTE to expiry).
- (No profit target — it rides the convexity into the bell.)

## 5. Position sizing
`fund.equity × capital_pct% × aggression%`, capped at `max_contracts`.

## 6. Inputs required
1-min SPY OHLCV · session VWAP · ATR · time-of-day · 0DTE chain.

## Desk note
Maps cleanly to the importable vocabulary: `vwap_side`, `time_between`/`time_before`,
premium/underlying stops. The "lean with momentum" is the one nuance the spec
expresses only approximately (no explicit momentum kind — `ma_cross` is the closest).
