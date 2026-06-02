---
strategy_id: orb-momentum-scalp
name: "Opening Range Breakout Momentum Scalp"
instrument: SPY
structure: single-leg
legs: [long_call OR long_put]
dte_range: [0, 1]
regime: trending / momentum
complexity: low
direction: directional
edge_type: convexity (asymmetric payoff)
primary_session_window: "09:35–12:00 ET"
status: thesis_v1
---

# Strategy 01 — Opening Range Breakout (ORB) Momentum Scalp

> **Disclaimer:** This is a synthesis of publicly available trading research and community
> practice for use as a reference module in a trading tool. It is not financial advice and
> carries no guarantee of profit. 0DTE directional buying is a high-variance, low-win-rate
> approach where the *majority* of individual trades lose; the math only works if stops and
> position sizing are enforced mechanically. Treat capital risked as capital you can lose.

> **Desk-executable scope:** The mechanical rules in Section 4 use ONLY inputs the desk
> computes — price, session VWAP, the opening range, relative volume, and time of day. Other
> reads this strategy benefits from (NYSE TICK, dealer-gamma regime, EMA alignment) are listed
> in Section 9 as **discretionary overlays the desk does NOT automate** — they're operator
> judgment, not entry gates, so this thesis compiles to a fully runnable single-leg channel.

## 1. Thesis (the "why")

The first few minutes of the session compress overnight order flow, gap reactions, and
institutional positioning into a tight price range. When price breaks that range with
conviction, it tends to continue in the breakout direction long enough for an at-the-money
0DTE option to expand violently — same-day options carry enormous gamma. A $1–2 SPY move after
a clean breakout can double an ATM contract's value, while the maximum loss is capped at the
premium paid. That asymmetry — option can +100% on a moderate move, but you cut it at −50% — is
the entire edge. You lose more often than you win, but winners are ~2× losers.

This is **not** a high-win-rate strategy. Backtested mechanical versions land around a **~42%
win rate** with a **~2:1 winner/loser size ratio** — a classic trend-following profile. It
only survives because the stop is honored every single time.

## 2. When to deploy (regime filter)

This is a **momentum / trend** strategy. It wants a session that expands and runs, and it bleeds
in quiet, range-bound chop where most false breakouts happen. The desk-automated regime reads:

| Condition | Deploy? | Reason |
|---|---|---|
| Opening range is wide enough (≥ 0.20% of price) | ✅ | A real range to break; narrow ranges = whipsaw |
| Breakout bar shows a volume expansion (relative volume up) | ✅ | Institutional participation, not a drift |
| Break holds on the correct side of VWAP | ✅ | Trend agreement |
| Compressed, low-volume, range-bound tape | ❌ Skip | Most false breakouts live here |

The width, volume, VWAP, and time filters in Section 4 are exactly what screen the good tape
from the bad. (A discretionary operator may *additionally* skip pinning/positive-gamma days —
see Section 9 — but the desk does not gate on that.)

## 3. Signals & indicators (inputs the desk computes)

- **Opening Range (OR):** high and low of the opening range. *Desk note: the engine currently
  evaluates a fixed **30-minute** opening range (09:30–10:00 ET); a shorter 5-min OR is on the
  roadmap. Entries therefore arm once the 30-min range is set.*
- **Minimum range width filter:** OR width must be ≥ **0.20%** of SPY price. Narrower ranges
  produce too many low-conviction whipsaws — skip the day.
- **VWAP:** breakout should be on the correct side of session VWAP (long above, short below).
- **Relative volume:** the breakout bar's volume should exceed the trailing average
  (≥ **1.3×**) — confirmation of participation.

## 4. Entry rules (mechanical — what the desk runs)

```
LONG CALL  when: SPY breaks ABOVE the opening-range high
              AND price > VWAP
              AND OR_width >= 0.20%
              AND relative_volume >= 1.3
              AND time is between 09:35 and 12:00 ET

LONG PUT   when: SPY breaks BELOW the opening-range low
              AND price < VWAP
              AND OR_width >= 0.20%
              AND relative_volume >= 1.3
              AND time is between 09:35 and 12:00 ET
```

- **Strike:** at-the-money (ATM). Pick the nearest strike to spot for max gamma + tightest
  bid/ask + highest volume. (e.g. SPY at $602.40 → trade the 602 strike.)
- **No new entries after 12:00 ET.** Afternoon breakouts have too little runway before theta
  and the close erode the position.

## 5. Position construction & sizing

- **Fixed dollar risk per trade** — size by contract price, not contract count. Target ~**1–2%
  of account** at risk per trade.
  - Example: $500 risk budget, ATM call costs $1.25 → buy 4 contracts ($500/$125).
  - Same budget, ATM call costs $2.50 → buy 2 contracts.
  - This holds dollar risk constant regardless of where SPY trades or how juiced premiums are.
- **0DTE is the default.** Use **1DTE** when you want slightly less gamma whipsaw and a touch
  more time cushion (e.g. late-week entries, or to ride a move overnight on a strong trend day).

## 6. Exit rules

| Exit | Trigger | Action |
|---|---|---|
| **Profit target** | Option price = **+100%** of entry (doubles) | Close full position |
| **Stop loss** | Option price = **−50%** of entry | Close full position, no exceptions |
| **Time stop** | **15:30 ET** reached with neither hit | Close at market |

Optional refinement: scale out half at +60–70% and trail the remainder. Adds complexity; the
flat +100% / −50% / time-stop version is the cleanest to automate and backtest first.

## 7. Failure modes (when this bleeds you)

- **Chop / inside days:** false breakout, snap back through the range, −50% stop. The 0.20%
  width filter + the relative-volume filter exist to cut these; honor them.
- **Late entries:** anything after midday fights theta and the close. Don't (the 12:00 cutoff).
- **Stop drift:** the strategy's entire edge is the −50% stop. Widening it once turns a
  managed loser into an account event.

## 8. Data inputs required (for the build)

- 1-min SPY OHLCV for OR construction + breakout detection
- Session VWAP
- Relative volume (current bar vs trailing average)
- Live 0DTE/1DTE SPY option chain (ATM bid/ask, volume) for fills + P&L

## 9. Discretionary overlays — NOT executed by the desk

These sharpen the read but are **operator judgment**, not automated entry gates (the desk
ingests none of these feeds): **NYSE TICK** confirmation (e.g. > +600 for calls, < −600 for
puts), **9/21 EMA** alignment with the break, and **dealer-gamma regime** (negative gamma =
momentum tape favors this; positive-gamma pinning days favor fading instead). Use them to
size up/down or to skip a day — but the channel arms and trades on Section 4 alone.

## 10. One-line summary

Buy the ATM 0DTE call (or put) on a confirmed opening-range break in the direction of VWAP,
with a wide-enough range and a volume expansion, between 09:35 and 12:00 ET; target a double,
stop at half, flat by 15:30. Low win rate, asymmetric payoff, lives or dies by the stop.
