---
strategy_id: grind-smart
name: "The Grinder (Smart)"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: liquid, normal-volatility, TRENDING intraday
direction: directional
session_window: "09:31–15:50 ET"
ab_pair: grind
management_ref: trade-management
---

# The Grinder (Smart) — cost-aware microstructure scalper

> A/B variant of `grind`. **The honest hypothesis: v1 has negative expectancy after costs** — a
> 0.6·ATR target on an ATM option (delta ~0.5 → ~0.3·ATR of premium) barely clears the round-trip
> bid/ask on a tight scalp. The single most important thing this A/B proves is whether a *cost
> gate* + *trend filter* can rescue the channel, or whether it should be retired. Either answer is
> valuable. Requires the entryMinute fix (brief Part 1) before its telemetry means anything.

## 1. Thesis
Many small momentum bursts → small directional scalps. v1 fired on raw momentum with **no
trend/chop filter** (so it bought reversals in chop and died by a thousand cuts) and **no cost
awareness** (so the bid/ask ate the thin edge). This variant only fires in a trending tape and only
when the expected premium move clears cost by a healthy margin.

## 2. Signals & indicators
- **Momentum** (close−close[3], ATRs) — trigger · **Relative volume** · **ATR**.
- **Efficiency ratio** — NEW trend gate (no scalping chop) · **Cost gate** (NEW).

## 3. Entry rules (mechanical)
```
LONG CALL when: momentum >= 0.5·ATR
            AND relativeVolume >= 1.1
            AND efficiencyRatio >= 0.40        # NEW: trend gate, kills chop-reversal bleed
            AND costGate.pass                  # NEW: expected premium move >= 3× round-trip cost
            AND >10 min to close
LONG PUT  when: momentum <= −0.5·ATR (mirror)
```
Strike: ATM.

> **`--mgmt-only`:** drops the ER trend gate and the cost gate (keeps raw-momentum v1 entries) so
> the A/B shows what management alone does — almost certainly *not enough* to save it, which is the
> point: this channel's problem is entries + costs, not exits.

## 4. Management (smart layer — tight, it's a scalp)
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 40                                   # tighter than default; scalps cut fast
  structuralStop: { kind: atr_adverse, atr: 0.5 }      # v1's 0.5·ATR stop, as structural
scaleOut:
  - { atR: 1.0, fraction: 0.50, then: move_stop_breakeven }   # bank half at 1R, free-roll the rest
trail:
  mode: premium_giveback
  premiumGivebackPct: 30
scaleIn: { enabled: false, forbidIfBelowEntryPremium: true }
costGate: { minMoveToCostRatio: 3.0 }                  # THE key gate for this channel
timeStop: { minutesHeld: 5, thetaTightenAfter: "13:30" }      # v1's 5-min stop — now on REAL entry time
eodFlattenMinToClose: 10
```

## 5. What changed vs v1
- **Entry:** added ER trend gate (≥0.40) + cost gate (≥3× round-trip). v1 had neither.
- **Bug:** depends on Part 1 entryMinute persistence — v1's 5-min stop fired on the wrong clock,
  so every v1 stat is suspect until that lands.
- **Management:** target/stop now R-based with a breakeven scale at +1R; cost applied per leg.
- **Hypothesis:** if expectancyR is still ≤ 0 after the cost gate, **retire the channel** — that's a
  legitimate, money-saving result. Don't tune a structurally-unprofitable scalper.

## 6. Inputs required
1-min SPY OHLCV · ATR · relative volume · efficiency ratio · option delta + bid/ask (cost gate) ·
0/1DTE chain · cost model · **persisted entry timestamp**.

## Desk note
Momentum still needs a spec kind (`momentum_atr`, brief Part 3a; v1 note's `ma_cross` is only an
approximation). The cost gate (`costGate`) is the highest-value addition for this specific channel.
