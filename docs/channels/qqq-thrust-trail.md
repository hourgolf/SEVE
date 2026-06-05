---
name: "Trend-Thrust · QQQ (trailed)"
strategy_id: qqq-thrust-trail
underlying: QQQ
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45-11:30 ET"
---

# Trend-Thrust · QQQ (trailed) — the desk's strongest edge

> **Found while investigating grind.** grind-the-scalper is dead (−$18k, 5% win — high-freq 0DTE
> scalping can't beat the spread). But grind's momentum-thrust *entry*, gated to TRENDING tape
> (efficiency ratio) and given the chandelier trail, is the **best channel on the desk on real
> H1-2026 fills: net +$7,473, +$120.54/trade expectancy, 51.6% win, max DD $2,166** — and that's
> in a CHOP regime. It's QQQ-specific (−$5,511 on SPY): QQQ trends intraday, SPY chops. The whole
> config neighborhood is net-positive, so it's a real edge, not a fit.

## Thesis
QQQ trends hard intraday. When price thrusts in the VWAP-aligned direction on a TRENDING tape
(not chop), ride it: enter an ATM 0DTE option in the thrust direction and trail the underlying.
The efficiency-ratio gate is the key — it only fires when the tape is actually trending, which is
what separates this from a noise-chasing scalp (grind's fatal flaw).

## Entries — VWAP-aligned thrust, ON a trending tape
Buy a CALL when ALL of these hold:
- price is above VWAP (trend-aligned)
- momentum over the last 5 bars is at least +0.6 ATR (the thrust)
- relative volume is at least 1.8x (conviction)
- **efficiency ratio ≥ 0.40** (the tape is TRENDING, not chopping — the critical filter)
- it is before 11:30 ET (QQQ's trend window)

Buy a PUT on the mirror (below VWAP, momentum ≤ −0.6 ATR, rel-vol ≥ 1.8, ER ≥ 0.40, < 11:30).

## Exits
- **1.5·ATR underlying chandelier trail** (`management.trail` mode `atr_chandelier`, baseK 1.5):
  once in profit, exit when price retraces 1.5 ATR from the peak favorable price. This is the exit.
- **No premium stop, no fixed target** — let the trail run; losers exit on time/EOD flatten.
- Flatten by 15:30 ET.

> Real-fills (H1-2026 chop): 62 trades, **51.6% win, net +$7,473, +$120.54/trade**, gross +$10,058
> (only 26% cost drag — the selective entry keeps cost low), DD $2,166. This is the
> `qqq-thrust-trail` channel (21_v2_trail_channels.sql) — arm it next week. **Caveat:** 62 trades,
> one regime; the live 5-session A/B is the real test. The live cost gate (worker, non-exempt) may
> trim a few entries, but cost drag is already low so the effect should be small.
