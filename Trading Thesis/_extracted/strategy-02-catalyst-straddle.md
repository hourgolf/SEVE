---
strategy_id: catalyst-straddle
name: "Catalyst Long Straddle"
instrument: SPY
structure: straddle
legs: [long_call, long_put]   # same strike, same expiry
dte_range: [0, 3]
preferred_dte: [1, 3]
regime: pre-event volatility expansion
complexity: medium
direction: non-directional (long volatility)
edge_type: realized > implied move
status: thesis_v1
---

# Strategy 02 — Catalyst Long Straddle

> **Disclaimer:** Synthesis of public research/community practice for use as a reference module.
> Not financial advice; no profit guarantee. A long straddle is a **debit** position — you can
> lose the entire premium if the underlying doesn't move enough. The single biggest killer here
> is **IV crush**: buying volatility that's already priced in and watching it evaporate after
> the event even when you called the direction. Read Section 4 before deploying.

## 1. Thesis (the "why")

A straddle — long an ATM call **and** an ATM put at the same strike — pays off when the
underlying makes a **large move in either direction**. You're not betting on direction; you're
betting that **realized movement will exceed the move the market has priced in**. The natural
home for that bet is a **known, scheduled catalyst**: CPI, FOMC, jobs/NFP, major index-weight
earnings. These events reliably produce outsized SPY moves, and if you're positioned *before*
the volatility fully prices in, the explosive leg can pay for both legs and then some.

ATM strikes are deliberate: they carry the **highest gamma**, so the winning leg accelerates
fastest as price runs.

Reality check from the research: a long straddle typically needs **~1.5–2× the entry cost in
underlying movement** just to break even after the losing leg and decay. This is a bet that
volatility *shows up*. When it doesn't, you bleed.

## 2. When to deploy

| Condition | Deploy? | Reason |
|---|---|---|
| Scheduled macro catalyst in next 0–3 sessions (CPI/FOMC/NFP) | ✅ Core use case | Reliable large move |
| IV still **low/normal** going in (event not yet fully priced) | ✅ Required | Avoids IV crush |
| IV already **elevated/pumped** pre-event | ❌ Skip | You're buying the top of vol → crush |
| Tight pre-breakout coil / multi-day range compression, no catalyst | ⚠️ Discretionary | Can work but lower-confidence |
| Quiet midday with no catalyst | ❌ Skip | Pure theta donation |

## 3. DTE choice — why this is usually NOT a pure 0DTE trade

0DTE straddles carry the **most brutal theta**: every hour you hold, both legs bleed, and if the
move doesn't come fast you lose on both sides at once. For a *scheduled* catalyst, **1–3DTE is
typically the cleaner expression** — you pay less theta per unit time, you have room to be early,
and you can exit into the post-event move rather than racing the same-day clock.

Reserve **0DTE straddles** for **event-day** plays where the catalyst hits *during* the session
(e.g. a 14:00 ET FOMC decision) and you enter close to the print.

## 4. IV crush — the thing that kills this trade

Before a known event, implied volatility on the relevant expiry **inflates** because everyone is
buying protection/speculation. After the announcement, that uncertainty resolves and **IV
collapses**, often within minutes. If you bought *after* IV inflated, you can call the direction
correctly and **still lose**, because the vol you paid for vanished.

**Defense:**
- Compare current IV to the recent baseline / IV rank. If IV is already rich, skip.
- Read the **expected move** = roughly the price of the ATM straddle itself. That's the market's
  implied move. You only win if realized move materially **exceeds** it.
- Prefer entering when vol is still cheap relative to the event, not the day-of pump.

## 5. Entry rules (mechanical)

```
ENTER STRADDLE when:
    a scheduled catalyst falls within DTE window (0–3 sessions)
    AND IV_rank < threshold (e.g. < 50)  // not already pumped
    AND expected_move (ATM straddle price) is affordable vs risk budget
    AND (for 0DTE) entry is within ~30 min of the catalyst timestamp

Construction:
    strike   = ATM (nearest strike to spot)
    legs     = long 1 call + long 1 put, same strike, same expiry
    quantity = sized so total debit <= per-trade risk budget
```

## 6. Position construction & sizing

- **Total debit = your max loss = your risk budget.** Size the number of straddles so the full
  premium paid sits within ~1–2% of account. There is no separate stop math — the debit *is* the
  risk. (You can still cut early; see exits.)
- ATM, single strike, single expiry. Don't widen into a strangle unless you specifically want a
  cheaper, wider-breakeven version (lower cost, needs an even bigger move).

## 7. Exit rules

| Exit | Trigger | Action |
|---|---|---|
| **Profit take** | Position +20–40% (or the winning leg runs hard post-event) | Scale or close; don't be greedy into decay |
| **IV-crush bailout** | Event resolves with no move + IV collapsing | Close immediately, salvage remaining premium |
| **Hard stop** | Position −50% of debit | Close |
| **Time stop (0DTE)** | Decay accelerating into afternoon, no move | Close before theta guts both legs |

Key discipline: **do not hold a dead straddle hoping.** Once the catalyst has passed without the
move, both legs decay simultaneously — the position only gets worse.

## 8. Failure modes

- **Bought the IV pump → crush** even on a correct directional read. (Most common loss.)
- **Move smaller than expected move** → both legs decay, net loss.
- **Holding 0DTE through midday chop** → double theta bleed.
- **Whipsaw:** price moves, you don't take profit, it reverts through your strike.

## 9. Data inputs required (for the build)

- Economic/event calendar feed (CPI, FOMC, NFP, major earnings) with timestamps
- SPY option chain with **IV per strike/expiry** + **IV rank/percentile** history
- ATM straddle price (= expected move) computed live
- Underlying spot for ATM strike selection and realized-move tracking
- Theta/decay estimate per leg for the time-stop logic

## 10. One-line summary

Before a scheduled catalyst, while IV is still cheap, buy the ATM call+put on a 1–3DTE expiry
(0DTE only for intraday-timed events); win if the realized move beats the priced-in move; bail
the instant the event resolves flat, because IV crush and dual theta will eat you alive.
