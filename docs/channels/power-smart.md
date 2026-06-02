---
strategy_id: power-smart
name: "Power Hour (Smart)"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 0]
regime: any tape, final hour only
direction: directional
session_window: "15:00–15:57 ET"
ab_pair: power
management_ref: trade-management
---

# Power Hour (Smart) — final-hour 0DTE lean, without the round-trip

> A/B variant of `power`. v1's "no profit target, ride the convexity into the bell" is asymmetric
> the **wrong** way on a 0DTE: gamma round-trips a winner to near-zero in minutes. This variant
> keeps the convexity ride but ratchets to breakeven and scales, and replaces the too-loose 1.0·ATR
> stop with a premium catastrophic stop inside it (final-hour gamma can vaporize premium before a
> 1 ATR underlying move completes).

## 1. Thesis
0DTE gamma is largest into the close; lean *with* the day's established direction (price vs VWAP,
confirmed by momentum). Unchanged. What changes: you no longer give the winner back at 15:55.

## 2. Signals & indicators
- **VWAP** (day direction) · **Momentum** (confirmation) · **ATR** (stop) · **Time-to-close** gate.

## 3. Entry rules (mechanical)
```
LONG CALL when: minutesToClose <= 60                   # the power hour
            AND close > VWAP AND momentum > 0.25·ATR
            AND minutesToClose > 15                     # CHANGED v1: was 3 — no gamma-lottery entries
LONG PUT  when: close < VWAP AND momentum < −0.25·ATR (mirror)
```
Strike: ATM.

> **Entry change:** new-entry cutoff moved `3 min → 15 min` to close — entering with 3 minutes left
> is a coin-flip with no time to work. The 3-min **force-flat** (below) is unchanged.
> `--mgmt-only` reverts the cutoff to 3 min.

## 4. Management (smart layer — replaces "no target, ride into bell")
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50                                   # NEW catastrophic premium stop (v1 had none)
  structuralStop: { kind: atr_adverse, atr: 1.0 }      # v1's stop kept, now as the OUTER bound
scaleOut:
  - { atR: 1.0, fraction: 0.34, then: move_stop_breakeven }   # lock breakeven — kills the round-trip
  - { atR: 2.0, fraction: 0.33, then: engage_trail }
trail:
  mode: hybrid
  atrChandelier: { baseK: 1.2, kMin: 0.5, rTighten: 0.25, timeTighten: 0.8 }  # tighter + heavy time-decay weight
  premiumGivebackPct: 30
scaleIn: { enabled: false, forbidIfBelowEntryPremium: true }   # no adding in the final hour
timeStop: { thetaTightenAfter: "15:30" }               # final-hour theta is brutal; choke hard
eodFlattenMinToClose: 3                                # NEVER hold 0DTE to expiry (unchanged)
```
Note: `timeTighten 0.8` and `kMin 0.5` are deliberately aggressive — into the last 30 minutes the
trail chokes toward 0.5·ATR because 0DTE decay + gamma dominate.

## 5. What changed vs v1
- **Management:** "no target" → breakeven ratchet at +1R + two scale-outs + adaptive trail. This is
  the core fix — v1 could ride a +3R winner back to zero at the bell.
- **Risk:** added a −50% premium catastrophic stop *inside* the 1.0·ATR underlying stop (gamma can
  destroy premium before 1 ATR completes).
- **Entry:** new-entry cutoff 3 → 15 min to close.
- **Hypothesis:** expectancyR and tailCapture up, **maxDrawdownR down sharply** (no more round-trips);
  this should be the cleanest A/B win of the four.

## 6. Inputs required
1-min SPY OHLCV · session VWAP · ATR · time-of-day · option delta + premium (stops/scales) · 0DTE
chain · cost model.

## Desk note
Maps almost entirely to the new `management` block + existing `vwap_side`/`time_before`. Momentum
lean still wants `momentum_atr` (brief Part 3a). Best candidate to validate the state machine on —
the scale/ratchet/trail behavior is most visible here.
