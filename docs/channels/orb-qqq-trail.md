---
name: "QQQ ORB (trailed)"
strategy_id: orb-qqq-trail
underlying: QQQ
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45-15:00 ET"
---

# QQQ ORB (trailed) — momentum with a live ATR-chandelier trail

> **This is the trail unlock in action.** Same ORB-momentum entry as `orb-qqq-tuned`, but the
> exit is an **underlying ATR-chandelier trail** instead of a fixed target. On real H1-2026
> fills that flips the QQQ-momentum **gross from −$1.8k (fixed +250%) to +$3.9k** — it
> out-grosses even the hardcoded breakout code. The trail rides the move and exits on a k·ATR
> retrace from the peak, harvesting the convex tail that fixed targets clip. It ARMS live
> (worker `2026-06-04e`): the chandelier is the armable subset; only scale-outs / scale-in /
> vwap-target stay backtest-only.

## Thesis
After the first 30 minutes set QQQ's opening range, a volume-backed break that holds the VWAP
side trends. Enter an ATM 0DTE option in the break direction; then DON'T cap the winner — trail
it on the underlying so the rare big-trend day pays for the many small stops.

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
- **Trail the underlying with a 1.5·ATR chandelier**: once in profit, exit when price retraces
  1.5 ATR from the peak favorable price. (This is the live trail — `management.trail`,
  mode `atr_chandelier`, baseK 1.5.)
- Hard stop at -50% of the option premium (loser guard — the trail handles winners).
- No fixed profit target (let the trail run); flatten by 15:30 ET.

## Management
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50
trail:
  mode: atr_chandelier
  atrChandelier: { baseK: 1.5, kMin: 0.6, rTighten: 0.2, timeTighten: 0.5 }
eodFlattenMinToClose: 30
```

> **After importing, verify** the compiled spec's `management.trail.atrChandelier.baseK` is set
> (that's what arms the chandelier). The gate now backtests it on real QQQ sessions. Real-fills
> truth: the trail makes the SIGNAL gross-positive and cuts drawdown, but net is still cost-bound
> in a chop regime — this is a *trending-regime* channel. Watch it live (gated) vs a clean trend.
