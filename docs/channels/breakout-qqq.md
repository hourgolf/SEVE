---
name: "QQQ Breakout (ORB)"
strategy_id: breakout-qqq
underlying: QQQ
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "09:45–15:00 ET"
ab_pair: breakout
---

# QQQ Breakout (ORB) — the one QQQ edge the data backs

> **Why this channel exists.** In the H1-2026 real-fills backtest (Jan–Jun, 106 sessions,
> real `option_bars`) breakout is the **only** strategy with a *positive gross signal on QQQ*
> (+$1.8k gross, vs SPY breakout −$3.5k). The edge is real; the problem is **cost** — the 3%
> spread + slippage flipped it to −$4.9k net. So this thesis keeps v1's entry shape but
> **trades fewer, higher-conviction breakouts** and leans hard on the cost gate, because on
> QQQ the fight is won by *not* taking the marginal trade.

## 1. Thesis
The first 30 minutes set QQQ's opening range. A volume-backed break that holds the VWAP side
trends far enough for an ATM 0DTE option to expand. QQQ's wider 0DTE premiums mean each
round-trip costs more, so the bar to enter is higher than on SPY: demand a wider range, more
volume, and a clean cost-gate pass — then let the winner run further than SPY's target.

## 2. Signals & indicators (entry)
1-min QQQ OHLCV · 30-min opening range · session VWAP · ATR · momentum (close−close[3], in ATRs)
· relative volume · 0/1DTE chain + option delta (for the cost gate / expected move).

## 3. Entry rules (mechanical — STRICTER than SPY breakout to beat cost)
```
LONG CALL when ALL:
  close > openRangeHigh + 0.5·ATR
  opening-range width >= 0.30% of price        # QQQ is more volatile — demand real expansion (SPY uses 0.25)
  close > VWAP
  momentum >= 0.40·ATR                          # raised from 0.30 — only strong thrusts
  relativeVolume >= 1.5                          # raised from 1.3 — fewer, higher-conviction
  opening range built (>30 min) AND > 35 min to close
LONG PUT  when: the mirror below openRangeLow
```
Strike: ATM 0DTE (1DTE inside the close cutoff). Direction only — never both sides.

## 4. Management (cost is the killer — this block is the point)
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50                            # hard −50% premium stop
costGate:
  minMoveToCostRatio: 3.0                        # VETO entry unless expected 1·ATR premium move >= 3× round-trip cost
exits:
  profitPct: 90                                  # QQQ moves more than SPY — let the winner run past SPY's +75
  timeStop: "13:30 theta-tighten"
  eodFlattenMinToClose: 35                       # never hold 0DTE into the close
```

## 5. Live status & how it maps
- Lives today as the **code channel `breakout-qqq`** (worker base-slug resolver → ORB code on
  QQQ bars/chain). The cost gate above is **already active** in the live worker
  (`COST_GATE_RATIO = 3.0`; breakout is NOT cost-gate-exempt), which is why live (gated) bleed
  should run materially better than the ungated backtest.
- The stricter rel-vol / OR-width / momentum numbers here are the **proposed retune** — not yet
  in the code defaults. Backtest-gate before adopting:
  `npm run backtest -- --strat breakout-qqq --source real --options real` (needs QQQ
  `option_bars` re-backfilled — it's truncated between runs).

## 6. What to watch
Win rate will *fall* with the stricter filters — that's intended; fewer-but-better breakouts is
how a thin gross edge survives QQQ's cost. The success metric is **net expectancy/trade > 0
after the cost gate**, not win rate. Compare live (gated) fills vs this backtest each week.
