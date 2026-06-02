---
strategy_id: breakout-smart
name: "The Breakout (Smart)"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: trending / expansion / news days
direction: directional
session_window: "10:00–15:25 ET"
ab_pair: breakout
management_ref: trade-management
---

# The Breakout (Smart) — opening-range momentum with tail harvest

> A/B variant of `breakout`. **Entry logic is held identical to v1** (so `--mgmt-only` isolates the
> management lift), with one optional entry fix flagged below. The change that matters here is the
> management layer: this channel's edge is the convex right tail, and v1's single trailing stop
> could not harvest it.

## 1. Thesis
Unchanged from v1: first 30 minutes set the reference range; a held break with volume expansion on
a trending tape runs far enough for an ATM 0DTE option to expand. The smart layer adds: bank a
third at +1R, go risk-free, and let the runner ride the tail that this strategy exists to catch.

## 2. Signals & indicators (entry — unchanged from v1)
- **Opening range** — high/low of first 30 min · **VWAP** + **ATR** (1-min).
- **Efficiency ratio (ER)** — trend gate · **Relative volume** · **Momentum** (close−close[3], ATRs).

## 3. Entry rules (mechanical)
```
LONG CALL when: close > openRangeHigh + 0.5·ATR
            AND momentum > 0.3·ATR
            AND efficiencyRatio >= 0.45          # CHANGED v1: was 0.35 — see note
            AND relativeVolume >= 1.3
            AND opening range built (>30 min) AND >35 min to close
LONG PUT  when: the mirror below openRangeLow
```
Strike: ATM.

> **Entry change (flaggable):** ER gate raised `0.35 → 0.45` to make Breakout and Fade mutually
> exclusive (Fade-smart uses `ER <= 0.30`; 0.30–0.45 is a deliberate no-trade band). Under
> `--mgmt-only` this reverts to 0.35 so the A/B attributes lift to management alone.

## 4. Management (smart layer — replaces v1's single trailing stop)
Composes `trade-management.md`:
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50
  structuralStop: { kind: failed_break, insideAtr: 0.75 }   # v1's failed-break, kept as structural
scaleOut:
  - { atR: 1.0, fraction: 0.34, then: move_stop_breakeven }
  - { atR: 2.0, fraction: 0.33, then: engage_trail }
trail:
  mode: hybrid
  atrChandelier: { baseK: 1.5, kMin: 0.6, rTighten: 0.2, timeTighten: 0.5 }  # generalizes v1's fixed 1.5·ATR
  premiumGivebackPct: 35
scaleIn:                                  # pyramiding ON — this is a momentum channel
  enabled: true
  onlyAfterR: 1.0
  requireStopAtBreakeven: true
  addFraction: 0.5
  forbidIfBelowEntryPremium: true
timeStop: { thetaTightenAfter: "13:30" }
eodFlattenMinToClose: 35
```

## 5. What changed vs v1
- **Management:** fixed 1.5·ATR trail → R-ladder (scale 1/3 at +1R, breakeven ratchet, scale 1/3 at
  +2R, adaptive hybrid trail on the runner) + a premium hard stop the v1 underlying trail lacked +
  pyramiding winners.
- **Entry:** ER `0.35 → 0.45` (Breakout/Fade mutual exclusivity). Flag off under `--mgmt-only`.
- **Hypothesis to test:** higher expectancyR and **tailCapture**, lower maxDrawdownR; winRate may
  *fall* slightly (breakeven scratches) — that's expected and fine for a convex strategy.

## 6. Inputs required
1-min SPY OHLCV · session VWAP · ATR · efficiency ratio · relative volume · 0/1DTE chain ·
option delta (for cost gate / expected move) · cost model.

## Desk note
ER still needs the `efficiency_ratio` spec kind (Part 3a of the brief). Everything else maps to the
new `management` block.
