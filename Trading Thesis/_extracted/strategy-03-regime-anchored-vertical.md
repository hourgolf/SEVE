---
strategy_id: regime-anchored-vertical
name: "Regime-Anchored Vertical Credit Spread"
instrument: SPY
structure: vertical-spread
legs: [short_option, long_option]   # same type, same expiry, defined risk
dte_range: [0, 2]
regime: positive_gamma / range-bound (pinning)
complexity: low-medium
direction: neutral-to-directional (premium selling)
edge_type: theta + level-anchored probability
status: thesis_v1
---

# Strategy 03 — Regime-Anchored Vertical Credit Spread

> **Disclaimer:** Synthesis of public research/community practice for use as a reference module.
> Not financial advice; no profit guarantee. Credit spreads have an **asymmetric risk profile**:
> you win small and often, but a single unmanaged loss (when a short strike is breached near
> expiry under 0DTE gamma) can wipe out many winners. The defined-width wing caps the absolute
> loss; the stop and the "close-by-3pm" rule cap the realistic one. Honor both.

## 1. Thesis (the "why")

Most of the trading day, SPY is **not** trending — it's chopping inside a range, and on
**positive-gamma days** that range-bound behavior is actively *reinforced* by dealer hedging
(market makers sell rallies and buy dips, dampening moves and pinning price near heavy
open-interest strikes). A vertical **credit spread** monetizes that: you **sell** a closer-to-money
option and **buy** a further-out one as a wing, collect the net premium, and win as long as price
**stays on the right side of your short strike**. Theta works *for* you, and the long wing
defines your max loss.

The edge multiplier is **anchoring the short strike to a meaningful structural level** — a gamma
wall, VWAP, or the opening-range boundary — rather than picking a strike by delta alone. When the
level and the delta agree, you get the highest-probability entries.

Win-rate profile: short premium structures win **~60–70%** of the time. The catch — *when they
lose, they lose fast*. Risk management is the whole game.

## 2. When to deploy (regime filter)

| Condition | Deploy? | Reason |
|---|---|---|
| Net **positive** gamma (above zero-gamma flip) | ✅ Best | Dealers dampen moves → range holds, pinning |
| Price near a strong **gamma wall** (call wall above / put wall below) | ✅ Strong | Wall acts as support/resistance to sell against |
| Range-bound, low-realized-vol session (10:30–14:00 "chop window") | ✅ Good | Theta-friendly, directionless |
| Net **negative** gamma / trending tape | ❌ Avoid | Moves get amplified → short strike breached → use Strategy 01 |
| Into a scheduled catalyst | ❌ Avoid | Gap risk through your short strike |

## 3. Two entry variants

### Variant A — Gamma-wall fade (positive-gamma pinning day)
- **Sell a put spread below the put wall** (betting the put wall holds as support), or
- **Sell a call spread below/at the call wall** (betting the call wall caps upside).
- Short strike sits just beyond the wall; long wing is the defined-risk leg.

### Variant B — Opening-range credit (mechanical)
- On a break **above** the OR high → **sell a put spread below the OR low** (betting the low
  holds as support now that price is above the range).
- On a break **below** the OR low → **sell a call spread above the OR high** (betting the high
  caps it).
- This is the "fade the failure" complement to Strategy 01's "ride the breakout." Backtests of
  ORB-anchored 0DTE credit spreads have used ~$15-wide wings on SPX-equivalent and a minimum
  range-width filter; the direct SPY analog is a narrower dollar wing scaled to SPY's price.

## 4. Entry rules (mechanical)

```
PRECONDITION: net_gamma > 0  (positive-gamma regime)  // hard gate

VARIANT A (wall fade):
    identify put_wall and call_wall from GEX
    SELL put_spread:  short strike ≈ just below put_wall, long wing N points lower
        ENTER if price holding above put_wall AND time before 14:00 ET
    SELL call_spread: short strike ≈ just below call_wall, long wing N points higher
        ENTER if price rejecting call_wall AND time before 14:00 ET

VARIANT B (ORB credit):
    on break ABOVE OR_high  -> SELL put_spread anchored below OR_low
    on break BELOW OR_low   -> SELL call_spread anchored above OR_high
    require OR_width >= 0.20%

Short-strike selection: anchor to the structural level, THEN confirm delta is
    in a sane band (commonly ~0.15–0.30 short delta). Level + delta must agree.
```

- **Wing width:** fixed and narrow (defined max loss = width − credit, per spread). Start
  conservative and size by that max loss.

## 5. Position construction & sizing

- **Max loss per spread = (wing width × 100) − net credit received.** Size the number of spreads
  so total max loss ≤ ~1–2% of account.
- Sell enough credit that the reward is worth the defined risk, but don't chase fat credits by
  jamming the short strike at-the-money — that's where the 60–70% win rate collapses.
- **DTE:** 0DTE for same-day theta capture; **1–2DTE** when you want the short strike further
  from a same-day gamma whipsaw and a bit more cushion.

## 6. Exit rules

| Exit | Trigger | Action |
|---|---|---|
| **Profit take** | Capture **~50%** of credit (or 20–30% for quick scalps) | Close, redeploy |
| **Stop loss** | Position loss = **2× credit received** | Close |
| **Tested-strike rule** | Short strike within **~$2** of being breached | Close, don't "wait and see" |
| **Hard time rule** | **15:00 ET** with any spread still open | Close all — 0DTE gamma in the final hour can blow through a tested strike faster than you can react |
| **No new entries** | After **14:00 ET** (unless experienced) | Don't open fresh 0DTE short premium late |

## 7. Failure modes

- **Wrong regime:** selling premium in negative gamma → trending move steamrolls the short
  strike. The `net_gamma > 0` gate exists for exactly this.
- **Final-hour gamma:** a short strike that looked safe at 2:30 gets tested at 3:30 as 0DTE
  gamma explodes. The 3:00 close rule is non-negotiable.
- **Catalyst gap:** holding short premium through CPI/FOMC → gap straight through the wing.
- **Over-sizing on the high win rate:** the 60–70% win rate seduces traders into too much size;
  one 2× loss erases several winners.

## 8. Data inputs required (for the build)

- **GEX / dealer-positioning feed** (shared with Strategy 01): net gamma, **zero-gamma flip**,
  **call wall**, **put wall**, **peak GEX strike** (price magnet), max pain. Treat walls as
  *zones of influence*, not exact lines — a wall at $600 does not mean price stops at $600.00.
- SPY option chain: per-strike bid/ask, **delta**, open interest, IV
- Opening-range high/low + VWAP (for Variant B)
- Event calendar (to *exclude* catalyst days)
- Clock for the 14:00 / 15:00 ET rules

> **Shared GEX note:** GEX predicts the *volatility character* (mean-reverting vs trending), not
> direction. Positive gamma → expect dampened, pinning moves (this strategy). Negative gamma →
> expect amplified, trending moves (Strategy 01). With 0DTE now a large share of SPX/SPY volume,
> the relevant gamma levels are driven heavily by *same-day* positioning and shift intraday — so
> the feed must refresh through the session, not just at the open.

## 9. One-line summary

On positive-gamma, range-bound days, sell a defined-risk vertical credit spread with the short
strike anchored to a gamma wall (or opening-range boundary) the tape should respect; take ~50%
of credit, stop at 2× credit, and close everything by 3pm before final-hour gamma can run
through your short strike.
