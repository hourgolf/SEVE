---
strategy_id: grind
name: "The Grinder"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: liquid, normal-volatility intraday
direction: directional
session_window: "09:31–15:50 ET"
---

# The Grinder — microstructure scalper

> Exported from `engine/strategies/grind.ts` (`DEFAULT_GRIND_PARAMS`).
> **DRAFT thesis** — backtest on real option_bars before arming. This is the most
> active channel; it turns a small per-trade edge into volume.

## 1. Thesis
Many small momentum bursts. When 1-minute momentum kicks with a volume tick, take
the directional side and get out fast — a tight ATR target, a tight ATR stop, or a
short time-stop. High trade count, small per-trade edge; steps aside near the close.

## 2. Signals & indicators
- **Momentum** (close − close[3], in ATRs) — the trigger.
- **Relative volume** — needs some participation.
- **ATR** — sizes the target and stop.

## 3. Entry rules (mechanical)
```
LONG CALL when: momentum >= 0.5·ATR AND relativeVolume >= 1.1 AND >10 min to close
LONG PUT  when: momentum <= −0.5·ATR AND relativeVolume >= 1.1 AND >10 min to close
```
Strike: ATM. One position at a time.

## 4. Exit rules (fast — it's a scalp)
- **Target** — favorable underlying move of 0.6·ATR.
- **Stop** — adverse underlying move of 0.5·ATR.
- **Time stop** — 5 minutes held.
- **EOD flatten** — 10 minutes to close.

## 5. Position sizing
`fund.equity × capital_pct% × aggression%`, capped at `max_contracts`.

## 6. Inputs required
1-min SPY OHLCV · ATR · relative volume · 0/1DTE chain.

## Desk note
The Grinder's 5-minute time-stop depends on the *real* entry time. **Fixed in
worker 2026-06-01c** — the worker now reconstructs `entryMinute` from the
position's `opened_at`, so the time-stop measures actual hold time (it used to
fire on the next evaluation, which is why this channel churned so fast). For
import, the `rel_vol` rule maps; momentum has no explicit spec kind (closest:
`ma_cross`).
