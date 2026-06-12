# Next week's menu — roster proposal for 2026-06-15 (operator review)

The operator asked for the post-everything synthesis: every probe, every verdict, every live
receipt rolled into one preferred roster for the week of 06-15, with head-to-head pairs where a
second recipe is justified and a cull list for the rest. **EXECUTED 2026-06-12 evening on the
operator's word ("run it chef")** — the cull + the QQQ ustop alignment are applied via MCP and
verified: armed roster = the 7 menu channels (all stream) + 4 muted twins; desk flat, nothing
stranded.

## Live receipts used (DB, per-channel realized attribution)

Attribution is RELATIVE (shared-OCC netting; NAV is truth — account ≈ +$6.1k since 06-01).
"Clean era" = since 06-10, after the 06-09 booking fixes (manual-close sellQty + 09c actual-qty)
— the only window where per-channel numbers are trustworthy. Week-1 numbers are inflated.

| channel               | since 06-01 | clean era 06-10+ | W-L     | note |
|-----------------------|------------:|-----------------:|---------|------|
| breakout (base)       |      +3,704 |             −492 | 11-8    | week-1 print is pre-clean-era |
| orb-qqq-trail         |      +2,470 |              +16 | 5-1     | the QQQ star |
| grind-manual          |      +2,118 |              +78 | 50-27   | twin (operator) |
| power (base)          |      +1,972 |           −1,368 | 22-20   | 2 daily-stop latches this week |
| power-smart-entries   |      +1,389 |             +731 | 16-11   | best clean-era SPY machine |
| breakout-smart (ALT)  |        +976 |             +669 | 4-3     | gates armed 06-11 |
| breakout-qqq          |        +661 |             −382 | 6-7     | entry triple-refuted |
| grind-v3              |        +571 |             +606 | 8-8     | green both chop days |
| breakout-manual       |        +252 |             −174 | 8-4     | twin |
| breakout-alt-v3 (V3)  |        +244 |             +244 | 2-2     | gates armed 06-11 |
| orb-spy-trail         |         +24 |             −780 | 2-3     | |
| orb-trend-rider       |        −545 |           −1,651 | 7-8     | worst clean-era on the desk |
| qqq-thrust-trail      |        −648 |             −218 | 1-4     | n=5, low sample |
| power-manual          |        −683 |             −472 | 9-6     | twin |
| grind-smart-entries   |        −691 |             −791 | 8-11    | |
| power-final30         |        −887 |             −214 | 0-4     | already muted 06-11 |

Knobs: everything standardized RISK $350 / STOP $350 (06-11 morning sweep); pb-ride $400/$450
(06-12 evening). All machine channels executor=stream as of tonight; twins on cron.
**All 4 manual twins muted by the operator 06-12 15:20 ET** (mute blocks entries; exits/backstop
still run) — treated below as a deliberate pause.

## THE MENU — 7 machine channels + the (paused) manual book

### Breakout/ride family — the franchise. TWO recipes, head-to-head (already armed)
1. **breakout-alt-v3 (V3)** — *the house special, unchanged.* OR-break + vwap_side + rel_vol≥1.3
   + ER≥0.45 + **gap_min 0.25** + **entries→14:00**, ustop 0, ride +100%/−50%, 15:25 flatten, 0DTE.
   Evidence stack: only clearly +EV config family (MC Pareto-best); as-armed print +$20,053/+275·t
   (ema-stretch probe, strongest ever); gap-gate table V3 ≥0.25% = +275/t with 4/5 windows green;
   both armed gates passed the 5-window bar (the only entry-side levers that ever did).
2. **breakout-smart-entries (ALT)** — *the control.* Identical except + momentum_atr ±0.3. The live
   A/B answers the one open question (is momentum_atr over-filtering live like it was in MC?).
   Clean era: ALT +669 vs V3 +244 — close, which is exactly why the A/B runs to month-end.
   **Month-end verdict folds the loser into the winner**; the freed seat goes to V3-AM (bench).
3. ~~breakout (base)~~ — CUT (below).

### Grind family — ONE recipe (deliberately no pair)
4. **grind-v3** — *the workhorse, untouched.* er-gate + 14:00 curfew + fast fixed-target exits;
   the stream's ~10s premium sweep is load-bearing (cron quantization would erase its 1-2m
   target pops). Clean era +606; the only machine channel green on BOTH whipsaw days (06-10,
   06-12). Why no second variant: the only candidates are a risk-knob clone (= shared-OCC mirror
   churn, the power/power-smart lesson) or scalp-exit variants (structurally cost-walled —
   reconfirmed three times). Don't touch the one working machine.
5. ~~grind-smart-entries~~ — CUT (below).

### Power family — ONE survivor on probation (no valid pair exists)
6. **power-smart-entries** — *dead man walking, stay of execution.* Unchanged through month-end;
   clean-era attribution is the yardstick. The case FOR: best clean-era SPY machine (+731), day's
   best channel 06-11 (+1,151), two mfe-drift live-runs-HOT flags (62% live win vs 28% model).
   The case AGAINST: MC cut-list, the family's graveyard. This is the live-A/B-decides doctrine
   working as designed — the backtest can't rank the power family (proven), so the live book gets
   the last word. Why no second recipe: every power fix ever probed is refuted — breakeven (hurts
   4/5), late-gate (mirage), confirmation-delay (the best entry filter ever tested and STILL −EV
   4/5), rescue hours (none exist). There is no validated variant to pair.
7. ~~power (base)~~, ~~power-final30~~ — CUT (below).

### QQQ family — TWO recipes, head-to-head (the two trail anchors)
8. **orb-qqq-trail** — *the QQQ star, unchanged.* ORB entry + ATR-chandelier trail, ustop 0.
   +$2,470 / 5-1 live, MC mildly + (the only non-SPY-ride channel MC liked). First stream session
   Monday (flipped tonight after the shadow proof).
9. **qqq-thrust-trail** — *pair B, one optional tweak.* Thrust entry + chandelier trail. Live
   1-4 (−$648) but n=5. It still carries **ustop 0.20%** — the sweep showed underlying stops
   whipsaw trail/ride channels out and cap the tail (that's why the SPY rides run ustop 0), and
   its winning sibling orb-qqq-trail runs ustop 0. Proposal: **zero its ustop** so the QQQ A/B is
   clean (two entry anchors, same exit/stop posture). SPY-validated mechanism, QQQ-untested —
   reversible one-liner. On the month-end clock either way.
10. ~~breakout-qqq~~ — CUT (below).

### Pullback family — the debut (solo by design)
11. **pb-ride** — *the new dish.* 1DTE EMA pullback-continuation ride (entry_dte=1 — the time
    value IS the edge; 0DTE variant refuted), $400/$450, stream, standdown. First generative
    candidate to survive the bar (+$4,632, 4/5 windows). Watch Monday: first signals; if
    `blocked: insufficient_capital` appears, the 1DTE ask ran past ~$8 and the risk knob needs a
    nudge. pb-scalp stays buried (cost-walled — the third fingerprint).

### Manual twins — paused by the operator (his book, his call)
All 4 (breakout/grind/power/qqq-thrust-manual) muted 06-12 15:20 ET. Muted = no entries; exits +
bell backstop intact. If the pause is intentional (e.g., until the entry-push → stream migration
ships), nothing to do — they stay armed+muted. Receipts to weigh on re-engage: grind-manual
+$2,118 (the real edge), breakout-manual +$252, qqq-twin +$25, **power-manual −$683** (selection
doesn't rescue power signals either — consider dropping that twin when the machine family goes).
Note the participation/close_reason dataset pauses while muted.

## THE CULL — 7 channels meet their maker

Mute = `status='draft'`: open positions still wind down (exits/reconcile run for draft), entries
stop. Rollback any: `update strategists set status='armed' where slug='…';`

| channel | epitaph |
|---|---|
| **power-final30** | Operator-named. 0-4, −$222/t live; MC P(lose) 92–100%; the "least-bad power" claim died in the live A/B. Already muted 06-11 — this formalizes it. |
| **power (base)** | Clean era −$1,368 with two daily-stop latches in one week. Every rescue refuted: breakeven ✗, late-gate ✗, confirm-delay real-but-insufficient ✗, no rescue hour, gate-exemption removal already done. The +$1,972 lifetime is week-1 inflated attribution. |
| **breakout (base)** | Dominated by ALT in MC since 06-07; lacks both armed 5/5-window gates (gap_min, →14:00); clean era −$492. Counter-receipts noted honestly (+$3.7k lifetime mostly pre-clean-era week 1; one mfe-drift HOT flag) — but keeping it means triple-stacking every break signal (the 06-10 cluster lesson: correlation, not direction, was the loss). The gates question it would "control" for already passed the 5-window bar. |
| **orb-trend-rider** | Worst clean-era on the desk (−$1,651). The 111-min ER-0.01 entry + re-lean on 06-12 is its signature failure. MC worst tail DD; ustop-zeroing didn't save it. |
| **orb-spy-trail** | Clean era −$780. The family's one rescue lever (raise or_width_min) FAILED the 5-window bar (gap-gate-probe: every floor ≥0.30% keeps ≥1 window ≤−$4.9k; MA25 red at every floor) — and the gap signal that DID pass is already armed on V3/ALT, which is where SPY morning momentum now lives. SPY ORB's job is done by better-gated channels. |
| **breakout-qqq** | Entry triple-refuted (H1-2026 verdict; tier2 "entry is the disease"; QQQ-V3 probe re-confirm −$8,817/71 sessions). Clean era −$382. orb-qqq-trail IS the QQQ ORB done right. |
| **grind-smart-entries** | Clean era −$791. The smart layer was flat-EV on real fills from day one (smart-layer verdict); grind-v3 is this family's validated form. |

```sql
-- THE CULL — APPLIED 2026-06-12 evening (draft = exits wind down; rollback = status='armed')
update strategists set status='draft'
 where slug in ('power','power-final30','breakout','breakout-qqq',
                'orb-spy-trail','orb-trend-rider','grind-smart-entries');

-- APPLIED 2026-06-12 (QQQ pair alignment): zero qqq-thrust-trail's underlying stop to match orb-qqq-trail
update strategist_config c set underlying_stop_pct=0
  from strategists s where c.strategist_id=s.id and s.slug='qqq-thrust-trail';
```

## Post-cull risk shape (by design, not accident)

13 machine channels → 7. Worst-case daily machine bleed (Σ per-channel STOP) drops ~$4.6k →
~$2.6k. On flat-open days V3/ALT now stand down via gap_min — expect LOW activity on chop days;
that's the chop verdict working (no directional shape survives chop; selectivity is the edge),
not a malfunction. The book: gap/trend-day SPY momentum (V3+ALT) · all-day scalper (grind-v3) ·
final-hour lean on probation (power-smart) · two QQQ trails · 1DTE pullback diversifier (pb-ride).

## Bench — next research seats (not armed)

1. **V3-AM (morning-only V3)** — the named successor for the seat month-end frees: positive all
   5 windows on half the trades, same total. Never run it ALONGSIDE V3 (mirror-clone OCC churn) —
   it replaces the ALT/V3 loser.
2. **MA-cross × gap compose** — oldest validated signal (15m crossover = trend-regime edge) ×
   newest gate (gap_min = ex-ante trend filter). Backtest-first; live-blocked on tf>1 worker
   support (`tf_unsupported_v1`).
3. **FOMC resolution trade** — post-14:30 re-entry after the binary settles. Timely: first live
   stand-down is Wednesday 06-17; the FOMC-day data is already bought.
4. **Chop premium fly** — still the best "make chop pay" candidate (+$20/day on known-chop);
   blocked on the chop classifier + multi-leg/limit doors (Phase-B W-list).

## PROJECTIONS — menu vs current roster (added on operator request, same evening)

### 1. Live replay, 06-08→06-12 (the all-13 era; machine book only, twins excluded)
Menu = the 7 keepers' actual fills; current = keepers + the cut group. Attribution is relative,
but the clean-era days reconcile to NAV almost exactly (06-11 Δ$4, 06-12 Δ$172).

| day        | current (13) | menu (7) | cut group | menu Δ |
|------------|-------------:|---------:|----------:|-------:|
| Mon 06-08  |         +517 |     +554 |       −37 |    +37 |
| Tue 06-09  |       +2,915 |   +1,641 |    +1,274 | −1,274 |
| Wed 06-10  |       −2,598 |     −107 |    −2,491 | +2,491 |
| Thu 06-11  |       +1,241 |   +2,844 |    −1,603 | +1,603 |
| Fri 06-12  |       −2,273 |     −689 |    −1,584 | +1,584 |
| **Σ week** |     **−198** | **+4,243** | **−4,441** | **+4,441** |

Menu wins 4 of 5 days; the cut group's one green day (06-09, +$1,274) is dwarfed by its bleed.
Partial circularity disclosure: clean-era receipts informed the menu — BUT the cut list itself
is the 06-09/06-11 standing list (named BEFORE Thu/Fri): on 06-11+06-12 the pre-named cuts went
−$3,187 while the menu group went +$2,155. That two-day stretch is genuine out-of-sample
validation of the cull.

### 2. Forward model — 5-window real-NBBO pooled (probe corpus, ~62 weeks of sessions)
Model-valid seats (consistent one-dte verdict run, as-armed configs):

| seat                  | pooled 5-window | per-week ≈ | worst window (MA25) |
|-----------------------|----------------:|-----------:|--------------------:|
| V3 (as-armed)         |        +$15,291 |      +$247 |                +645 |
| ALT (as-armed)        |        +$12,096 |      +$195 |                +645 |
| pb-ride @1DTE         |         +$4,632 |       +$75 |              −1,471 |
| **menu model core**   |    **+$32,019** |  **+$517** |            **−181** |

Cut group, model (gated/live-faithful runs; sizing varies by probe — signs and windows are the
signal): power −$15,348 · BREAK base −$15,948 · ORB family −$1.8k…−$10k (every variant red
pooled) · breakout-qqq −$5,829 (64 sessions) · grind-smart all-windows-negative (MC) ·
orb-spy-trail ≈0-to-red. **Cut drag ≈ −$650…−$940/week** (model) vs the −$888/day it actually
ran this week. Worst-window stress (MA25): menu model core ≈ flat (−$181) vs the cut group's
≈ −$25k extra bleed — the cull is mostly a tail-removal operation.

### 3. The honest asterisks
- **grind-v3 and power-smart are model-RED / live-GREEN** — the two seats where live receipts
  override the model. Mechanisms: grind-v3's edge is the stream's ~10s premium sweep (bar-close
  models quantize it away; proven 06-11); the power family is formally unrankable by backtest
  (orderings scramble across windows — the 06-07 lesson). Model says power-smart MA25 −$6,736 =
  the menu's worst-case seat; that's exactly why it's on probation with the clean-era yardstick,
  not tenured. A pure-model menu would cut it (8th cut) and project higher still.
- **QQQ pair**: thin (orb-qqq-trail +$2,470 live but n=6; thrust 1-4 live, n=5). Month-end clock.
- Projected machine stop-exposure halves: 13×$350 ≈ $4.6k/day worst case → $2.55k/day.

**Bottom line: identical upside capture (every +EV print is kept), minus a measured
−$650…−$940/wk model drag (−$4.4k actual this week), with the worst-regime tail cut ~4×.**

## Monday watch (06-15) — unchanged from the handoff, plus the cull

No pre-open WARN flood (idle beat's first morning) · first QQQ stream session (worker `stream:`
fills on the QQQ pair, cron defers) · pb-ride first signals (insufficient_capital check) ·
Monday gap = Monday open vs FRIDAY close · BAR_HISTORY 2400 holds full Friday. If the cull is
applied: cut channels wind down clean (day-report coverage stays ✓, no orphans). Wednesday 06-17:
first live FOMC stand-down 13:50–14:30 (machine roster fully covered post-flip; twins muted).
