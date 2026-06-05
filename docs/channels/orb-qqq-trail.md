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

## Entries — SELECTIVE and AM-only (the cost-beating half of the recipe)
The trail fixes the exit; trade FEWER, higher-quality morning breakouts to beat the cost wall.
Buy a CALL when ALL of these hold:
- price breaks above the 30-minute opening-range high
- the opening-range width is at least 0.50% of price
- price is above VWAP
- momentum over the last 5 bars is at least +0.6 ATR
- relative volume is at least 1.8x the recent average
- **it is before 11:30 ET** (QQQ trends hardest in the first two hours)

Buy a PUT when ALL of these hold (mirror, below the OR low, momentum ≤ −0.6 ATR).

## Exits
- **Trail the underlying with a 1.5·ATR chandelier**: once in profit, exit when price retraces
  1.5 ATR from the peak favorable price. (Live trail — `management.trail` mode `atr_chandelier`,
  baseK 1.5.) This IS the exit — it harvests the tail.
- **No premium stop, no fixed target** — the −50% stop cuts recoverable losers (it made net
  −$3.4k → −$1.4k to drop it). The chandelier governs winners; losers exit on the time/EOD flatten.
- Flatten by 15:30 ET.

> **Real-fills (H1-2026 chop):** 88 trades, 41% win, **net −$1,439** (gross +$2,116), DD $3,786 —
> vs the live `breakout-qqq` code (−$4,936, DD $7,569). Near-breakeven in chop → net-positive in a
> trend. This is the `orb-qqq-trail` channel (21_v2_trail_channels.sql).

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
