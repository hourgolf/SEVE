# QQQ strategy research — what QQQ actually rewards (H1-2026 real fills)

Goal: stop retrofitting SPY strategies and find a **QQQ-native** edge that can be uploaded as an
independent channel. Tested a span of strategy *classes* on real QQQ bars + real `option_bars`
(2026-01-02 → 06-04, 106 sessions, tf-15, modeled 3% spread). Ordered by **gross signal** (P&L
before cost — "is there an edge at all?"):

| strategy | class | exit | trades | win% | **gross** | net |
|---|---|---|---|---|---|---|
| **breakout** (code) | ORB momentum | **TRAILING** | 185 | 16% | **+$1,811** | −$4,936 |
| grind (code) | scalp | target/stop | 495 | 5% | +$1,133 | −$18,225 |
| power (code) | final-hour lean | stop | 182 | 20% | −$520 | −$6,556 |
| qqq-mom +250% (spec) | ORB momentum | fixed +250/−50 | 117 | 27% | −$1,774 | −$6,433 |
| qqq-thrust +250% (spec) | pure momentum | fixed +250/−50 | 118 | 27% | −$2,816 | −$7,515 |
| qqq-mom +150% (spec) | ORB momentum | fixed +150/−50 | 132 | 28% | −$3,202 | −$8,406 |
| orb-qqq-tuned +90% (spec) | ORB momentum | fixed +90/−50 | 156 | 33% | −$3,919 | −$9,946 |
| fade (code) | mean-reversion | — | 327 | 17% | −$4,579 | −$17,013 |
| qqq-mom +400% (spec) | ORB momentum | fixed +400/−50 | 103 | 26% | −$5,075 | −$9,179 |
| cross (code) | EMA crossover | — | 219 | 14% | −$7,700 | −$15,581 |
| qqq-vwaptrend +250% (spec) | VWAP trend | fixed +250/−50 | 116 | 25% | −$12,862 | −$17,349 |

## What the data says

1. **QQQ rewards MOMENTUM, punishes mean-reversion and whipsaw-trend.** breakout (ORB momentum)
   is the only gross-positive single edge; fade (mean-rev) and cross (EMA crossover) are deeply
   negative. This is a real, regime-robust property of QQQ — directionally the *opposite* of a
   fade-style book.

2. **The EXIT, not the entry, is the differentiator.** Every uploadable fixed-exit **spec** is
   gross-negative — the best (qqq-mom +250%) tops out at −$1,774, still below the breakout
   **code** (+$1,811). The *only* thing separating them is breakout's **trailing stop**, which
   rides the move and harvests the convex right tail that momentum's money lives in. Fixed
   targets are all-or-nothing: too tight (+90%) clips the tail; too greedy (+400%) never fills
   (1 target hit in 103 trades). There's a sweet spot (~+250%) but it still can't catch a
   give-back-protected runner.

3. **Cost is the wall on top.** Even the gross-positive breakout nets −$4.9k after ~$6.7k of
   round-trip cost. Single-leg 0DTE spreads are the structural tax; no entry tweak escapes it.

4. **Regime caveat.** H1-2026 was chop-heavy. These are momentum edges — they need a trend.
   breakout staying gross-positive *through* a chop regime is actually encouraging; a trending
   stretch is where it would shine.

## The conclusion that matters

**Within the desk's current capabilities — single-leg directional, the supported feature
vocabulary, and fixed-exit uploadable specs — `breakout-qqq` (the code channel) is the ceiling
for QQQ.** Uploading more single-leg fixed-exit strategies will not beat it; the leaderboard says
the bottleneck is **not strategy discovery**, it's two **capability gaps**:

- **(A) Live-armable trailing / give-back exits in uploaded specs.** Today a trailing exit is
  "smart management" → backtest-only, not armable (`smart-layer-real-fills-verdict.md`). That's
  exactly the lever QQQ momentum needs. **Making a give-back/trailing exit live-armable is the
  single highest-value unlock for the mixer vision** — it's what lets an *uploaded* QQQ momentum
  spec match or beat the hard-coded breakout, instead of being capped by fixed targets.
- **(B) Lower-cost structures (defined-risk spreads).** The cost wall is structural to single-leg
  0DTE. Multi-leg would cut it — but the multi-leg engine already showed no supported 0DTE
  credit/debit structure profits on real NBBO (`multi-leg-real-fills-verdict.md`), so this is a
  longer bet and unproven on QQQ.

**Recommendation:** keep `breakout-qqq` as the live QQQ channel; **don't burn cycles uploading
single-leg fixed-exit QQQ specs** (the ceiling is known). The next real progress on QQQ comes from
shipping **(A) live trailing exits** — then re-run this exact research with give-back exits in the
spec and see whether an uploaded QQQ momentum channel finally clears the code baseline.

## UPDATE (06-04): live trailing exits SHIPPED — the unlock is real (gross), cost-bound (net)

Built armable trailing exits (worker `2026-06-04e` + engine). Two trail modes; the data picked one:

| QQQ momentum, real fills | win% | **gross** | net | max DD |
|---|---|---|---|---|
| fixed +250% target (no trail) | 26.5% | −$1,774 | −$6,433 | $12,068 |
| premium-giveback trail (25–50%) | ~36% | −$6.7k to −$9.6k | worse | worse |
| **underlying ATR-chandelier trail (1.5)** | 36.8% | **+$3,946** | −$5,574 | $9,969 |
| breakout *code* baseline | 16% | +$1,811 | −$4,936 | — |

- **Premium-giveback is the WRONG trail for 0DTE** — option premium is too noisy, it exits winners
  early (gross −$6.7k). The **underlying ATR-chandelier** (what breakout's code uses) is right: it
  ignores premium noise, rides the underlying, harvests the tail → **gross +$3,946, beating even the
  hardcoded breakout**, and cuts drawdown 18%.
- **But net is still cost-bound** (−$5.6k): this entry over-trades (250 trades, $9.5k cost). The trail
  fixes the EXIT/signal; it doesn't fix the cost wall or the chop regime. A net-positive QQQ channel =
  chandelier trail **+** a lower-frequency entry **+** a trending stretch.
- **The unlock for the mixer vision is delivered:** an UPLOADED `.md` (chandelier trail) now arms live
  and out-grosses the hardcoded channel. `docs/channels/orb-qqq-trail.md` is the reference upload.
  Premium-giveback isn't worker-wired (needs a peak-premium column; it's worse anyway).

## UPDATE (06-04 pt2): the net-positive RECIPE + the trail is MOMENTUM-only

Swept entry-frequency × trail to beat the cost wall. The recipe: **selective AM-only momentum entry
(OR-width ≥0.5%, momentum ≥0.6·ATR, rel-vol ≥1.8, before 11:30 ET) + 1.5·ATR chandelier trail + NO
premium stop.** Fewer, higher-quality morning trades (cost ↓) + the trail (tail ↑):

| channel (real fills, H1) | trades | win% | gross | **net** | DD |
|---|---|---|---|---|---|
| **orb-spy-trail (SPY v2)** | 36 | 36.1% | +$1,921 | **+$455** ✅ | $2,656 |
| live `breakout` code (SPY) | 182 | 14.3% | −$3,513 | −$9,853 | $9,886 |
| **orb-qqq-trail (QQQ v2)** | 88 | 40.9% | +$2,116 | −$1,439 | $3,786 |
| live `breakout-qqq` code | 185 | 16.2% | +$1,811 | −$4,936 | $7,569 |

- **SPY v2 is NET-POSITIVE (+$455, +$12.64/trade expectancy) — the desk's first positive channel**,
  in a CHOP regime. QQQ v2 is near-breakeven (−$1,439, gross +$2,116) — net-positive in a trend.
  Both ~$10k / ~$3.5k better than their base code channels, drawdown roughly HALVED.
- **The trail is a MOMENTUM unlock — and only momentum.** Tested on SPY: it helps breakout (momentum)
  hugely, but does NOT help **fade** (mean-reversion −$11.3k→−$10.8k — nothing to ride) or **power**
  (final-hour lean −$1.4k→−$6.0k — the chandelier over-trades and hurts). Keep fade/power/grind on
  their base exits; only momentum channels get the chandelier.
- **Dropping the −50% premium stop matters** (it cuts recoverable losers): QQQ net −$3.4k→−$1.4k.
- Caveats: 36 (SPY) / 88 (QQQ) trades is a SMALL sample in ONE chop regime; some config-selection
  risk. The live 5-session A/B (base vs v2, next week) is the real test. Deploy: `21_v2_trail_channels.sql`.

_(All specs hand-authored + backtested via `npm run backtest --spec … --underlying QQQ --source
real --options real`. Reproduce: re-backfill QQQ option_bars per `qqq-desk-tracking.md`.)_
