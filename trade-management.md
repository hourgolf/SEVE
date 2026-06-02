---
doc_id: trade-management
name: "Trade Management Library (smart layer)"
instrument: SPY
role: management-primitives / shared-dependency
consumed_by: [breakout-smart, fade-smart, grind-smart, power-smart]
pairs_with: shared-signals (strategy-00)
status: thesis_v1
---

# Trade Management Library — the "smart" layer

> Reference module. Defines exit/scaling/sizing primitives **once**; the `*-smart` theses compose
> them by name. Where `strategy-00-shared-signals.md` defines *when to enter*, this defines *how to
> manage the trade after entry*. Not financial advice; improves risk framing and tail harvest, does
> not create edge. All P&L is post-cost.

The core reframe: **manage risk on premium, judge thesis-invalidation on the underlying.** The
position is a long option, so the thing that loses money is premium (delta + theta + vega). ATR
defines *where the idea is wrong*; premium defines *how much you actually risk*. The binding exit
at any moment is the **tightest** of {premium stop, structural stop, breakeven, trail}.

---

## P1. R — the unit of risk

```
R = entry_premium − premium_stop_level          // in $ premium per contract
premium_stop_level = entry_premium × (1 − premiumStopPct/100)
```
Everything downstream (scale triggers, breakeven, trail tightening, expectancy) is expressed in R.
Default `premiumStopPct = 50` → initial hard stop at −50% of premium; R = half the entry premium.

## P2. Dual initial stop

| Stop | Basis | Purpose |
|---|---|---|
| **Premium hard stop** | −`premiumStopPct`% of entry premium | Caps actual dollar loss (theta-aware) |
| **Structural stop** | underlying: `failed_break` (back inside range) or `atr_adverse` | Thesis is wrong |

Effective stop = tightest of the two. The structural stop usually fires first on a clean reversal;
the premium stop is the backstop when price stalls and theta bleeds you.

## P3. Scale-OUT ladder (harvest the convex tail)

The single highest-value primitive for convex/momentum channels.

```
scaleOut:
  - atR: 1.0   fraction: 0.34   then: move_stop_breakeven   # bank a third, trade goes risk-free
  - atR: 2.0   fraction: 0.33   then: engage_trail          # bank another third, trail the runner
  # remaining ~33% rides the trail into the tail
```
The **breakeven move at +1R** is the keystone: it converts a low-win-rate convex strategy into one
that can be wrong often and still profit, because the median outcome after +1R is now ≥ breakeven.

## P4. Adaptive trailing stop (the runner)

`mode: hybrid` → exit on the **tightest** of:

```
# a) ATR chandelier that tightens with profit AND with time-of-day
k = clamp(baseK − rTighten·R_achieved − timeTighten·(minSinceOpen/sessionMin), kMin, baseK)
atr_trail = peakFavorableUnderlying − k·ATR

# b) premium give-back cap (catches theta-bleed-at-the-peak that ATR misses)
giveback_trail = peakUnrealizedPremium × (1 − premiumGivebackPct/100)
```
Defaults: `baseK 1.5, kMin 0.6, rTighten 0.2, timeTighten 0.5, premiumGivebackPct 35`.
Early + small-profit → loose (1.5 ATR). Deep-in-profit + late-day → choked (→0.6 ATR), because
theta is accelerating and there's profit to defend.

## P5. theta tighten

After `thetaTightenAfter` (default `13:30 ET`): drop `kMin` and `premiumGivebackPct` (e.g. ×0.6).
You hold open premium into accelerating decay only on a tighter leash.

## P6. Scale-IN (pyramiding winners ONLY)

For long single-leg options there is exactly one safe form of adding:
```
scaleIn:
  enabled: true
  onlyAfterR: 1.0
  requireStopAtBreakeven: true
  addFraction: 0.5
  forbidIfBelowEntryPremium: true     # MUST be true — never average down long premium
```
Add a smaller tranche on a continuation signal *after* the first tranche is at +1R with its stop at
breakeven — risk added only with house money. **Never** add to a loser (the import validator
rejects `forbidIfBelowEntryPremium: false` on single-leg specs).

## P7. Cost gate (entry veto)

```
expectedPremiumMove ≈ optionDelta × firstTargetMove(underlying)
veto entry if expectedPremiumMove < minMoveToCostRatio × roundTripCost
```
Default `minMoveToCostRatio = 3.0`. This is what keeps a microstructure scalper from trading itself
to death across the bid/ask. Round-trip cost comes from the backtest cost model (real bid/ask when
`option_bars` has it, else modeled).

## P8. EOD flatten

`eodFlattenMinToClose` — force flat N minutes before the bell. 0DTE is **never** held to expiry.

---

## Config block (defaults — channels override)

```yaml
risk:
  defineR: premium_stop
  premiumStopPct: 50
scaleOut:
  - { atR: 1.0, fraction: 0.34, then: move_stop_breakeven }
  - { atR: 2.0, fraction: 0.33, then: engage_trail }
trail:
  mode: hybrid
  atrChandelier: { baseK: 1.5, kMin: 0.6, rTighten: 0.2, timeTighten: 0.5 }
  premiumGivebackPct: 35
scaleIn:
  enabled: false                 # opt-in per channel; momentum channels only
  onlyAfterR: 1.0
  requireStopAtBreakeven: true
  addFraction: 0.5
  forbidIfBelowEntryPremium: true
timeStop: { thetaTightenAfter: "13:30" }
costGate: { minMoveToCostRatio: 3.0 }
eodFlattenMinToClose: 35
```

## Telemetry each channel should emit (for the A/B scorecard)
`expectancyR · winRate · profitFactor · avgWinR · avgLossR · maxDrawdownR · tailCapture (top-decile
P&L share) · costDrag · acted/vetoed (incl. cost-gate vetoes)`, with every partial exit tagged by
its `atR` so tail capture is measurable.
