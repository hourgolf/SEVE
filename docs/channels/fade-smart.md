---
strategy_id: fade-smart
name: "The Fade (Smart)"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: range-bound / positive-gamma pinning
direction: directional
session_window: "10:00–15:25 ET"
ab_pair: fade
management_ref: trade-management
---

# The Fade (Smart) — VWAP mean reversion, theta-defended

> A/B variant of `fade`. v1's deepest problem isn't management — it's **theta posture**: buying
> long premium to play mean reversion in chop is the worst decay environment in the book. This
> variant fixes the regime gate and IV posture, tightens the target, and adds management. Read the
> desk note: the *structurally correct* fade is a credit spread (out of scope here).

## 1. Thesis
In a pinning tape, stretches far from VWAP snap back. v1 used efficiency ratio as a *proxy* for
"range regime"; this variant gates on the **actual** positive-gamma regime (dealers dampen moves →
reversion pays), requires IV to **not** be elevated (so you're not buying rich premium for a small
target), and takes profit at the **halfway point** to VWAP rather than the full mean — because a
long option won't capture the whole reversion before theta and spread eat it.

## 2. Signals & indicators
- **Opening range** (first 30 min) · **VWAP** · **ATR**.
- **Gamma regime** (`POSITIVE` required) — replaces ER as the regime gate.
- **IV rank** (must be low/normal) · **Momentum** (must be weak/decelerating).

## 3. Entry rules (mechanical)
```
LONG PUT  when: close > openRangeHigh AND (close − VWAP) > 1.5·ATR     # upside stretch
            AND |momentum| < 0.6·ATR                                   # decelerating
            AND gamma_regime == POSITIVE                               # CHANGED v1: was ER <= 0.4
            AND ivRank <= 50                                           # NEW: don't buy pumped IV
            AND opening range built AND >35 min to close
LONG CALL when: the mirror — downside stretch below openRangeLow / VWAP
```
Strike: ATM.

> **`--mgmt-only` behavior:** reverts the regime gate to v1's `ER <= 0.4` and drops the `ivRank`
> filter, so the A/B can separate "better entries" from "better management."

## 4. Management (smart layer)
```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50
  structuralStop: { kind: atr_adverse, atr: 1.0 }     # v1's stop, kept as structural
scaleOut:
  - { atR: 1.0, fraction: 0.50, then: move_stop_breakeven }   # take half early — reversion is low-convexity
trail:
  mode: premium_giveback                               # ATR chandelier is wrong tool for a fixed-target revert
  premiumGivebackPct: 30
scaleIn: { enabled: false, forbidIfBelowEntryPremium: true }   # NEVER average a fade
target: { kind: vwap_fraction, fraction: 0.5 }         # CHANGED v1: exit at halfway-to-VWAP, not full mean
timeStop: { minutesHeld: 20, thetaTightenAfter: "13:30" }      # keep v1's 20-min theta guard
eodFlattenMinToClose: 35
```

## 5. What changed vs v1
- **Entry:** ER proxy → true `gamma_regime == POSITIVE`; added `ivRank <= 50` (the theta/IV fix).
- **Target:** full VWAP revert → **halfway** (long options rarely capture the full mean pre-decay).
- **Management:** take half at +1R + breakeven; premium-giveback trail (not ATR chandelier); explicit
  no-scale-in.
- **Hypothesis:** higher winRate stays, but **expectancyR turns/stays positive after costs** because
  you stop paying full freight for partial reversions and stop buying pumped IV.

## 6. Inputs required
1-min SPY OHLCV · VWAP · ATR · **gamma regime feed** · IV rank · 0/1DTE chain · cost model.

## Desk note (the real fix is structural)
The correct expression of a mean-reversion / pinning thesis is a **defined-risk credit spread**
(short premium → theta works *for* you), per `strategy-03-regime-anchored-vertical.md`. That needs
a **multi-leg position model**, which is out of scope in the brief (flagged "next frontier"). Until
then, `fade-smart` is the least-bad single-leg version; if the A/B still shows weak expectancyR
after these fixes, that's the signal to prioritize multi-leg support rather than tune this further.
