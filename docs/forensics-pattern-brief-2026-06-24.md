# SEVE — Forensics Pattern-Mine Brief (2026-06-24)

Source: `forensics-pattern-mine` workflow (45 agents, 35 candidates, **13 survived** adversarial
verification) over `data/forensics-dataset.jsonl` (n=592 closed trades, 2026-06-01→06-24). Every
headline re-derived independently via node; verification scripts were `/tmp/verify*.js`.

> ⚠ **STANDING CAVEAT — applies to ALL of it.** ONE month, mostly whipsaw/chop, a documented
> **put-tape regime** (calls −$39.9/t vs puts +$21.6/t). NOTHING here is armable. Everything is a
> forward-test HYPOTHESIS, ranked by how hard it resisted being killed. Re-run this aggregate weekly
> as the durable dataset accrues a non-chop regime — June alone certifies nothing. The entry context
> (VWAP/MACD/etc.) is now stamped live (worker 24d) + backfilled (592), so the dataset keeps growing.

## The 3 entry levers worth real shadow-time (all NEW vocab, all shadow-log-don't-block)

### ⭐ LEVER 1 — Shallow-VWAP-displacement deadband (STRONGEST)
- **Condition:** directional VWAP displacement `|dirVwapDist|/atr` in **[0, 4)** = price drifted off
  VWAP in the bet's direction but never committed. (calls use `vwapDist/atr`, puts `−vwapDist/atr`.)
- **Effect:** n=129, **−$46.6/t** vs +$10.3 complement (this one bucket carries ~5× the dataset's net
  loss); MFE 11.7%, 75% never reach +20% MFE. Monotonic: [0,4) −$46.6 → [4,∞) +$16.7 → [6,∞) +$36.6.
- **Robustness:** survives dropping the biggest channel (ORB) AND day (06-12) → still −$31.9/t. Strongest
  among NON-scalpers (−$74.7 in-bucket). Confirmed on V3/ALT (shallow −$74.3 vs deep +$24.5) and pb-ride.
- **Vocab:** NEW — `vwap_dist` deadband normalized by ATR (require `|dirVwapDist|/atr ≥ ~4–6`). Distinct
  from `vwap_side` (sign alone is INERT, −1.7/t ≈ baseline). The lever is **magnitude, not sign**.
- **Forward-test:** shadow-log every would-be entry `dirVwapAtr<4` (and `<6`) WITHOUT blocking; 4–6 wks
  across a non-chop regime; 5-window OOS the shallow/deep split per channel (non-scalpers first).

### ⭐ LEVER 2 — MACD-histogram-against guard
- **Condition:** histogram opposite the trade — call+`macdHist<0` / put+`macdHist>0` (`histRel<0`).
- **Effect:** n=136, −$44.8/t vs +$10.7 with-side; **MFE collapses 13.4% vs 24.5%** — an at-entry quality
  tell (permutation p=0.008 for MFE, the cleaner signal vs p=0.025 for $).
- **Honest weakness:** the *dollar* shrinks to ~−$5/t once the 3 worst chop days also leave → **forward-test
  the MFE/peak-suppression, not the −$44.8.** Survives drop PB+06-24 (−$21.2); holds within relVol terciles.
- **Vocab:** NEW — `macd_hist_align` (require `histRel ≥ 0`). `momentum_atr`/`vwap_side` don't encode slope.
- **Forward-test:** shadow on momentum channels; **primary metric = MFE% of taken vs would-block**.
- ⚠ The mirror (MACD-fully-aligned "helps") is correctly graded WEAK — 99.7% collinear with the existing
  `momentum_atr` (`momRel>0`); +$7,194 is BREAK-base+06-05 alone (drop both → −$0.1/t). Don't arm it.

### ⭐ LEVER 3 — Whipsaw-zone size-down (regime gate)
- **Condition:** `er ∈ [0.10, 0.20)` **AND** `atr ≥ 0.40` — enough vol to take a big swing, no follow-through.
- **Effect:** n=50, **−$127.4/t**, MFE only 6%. NOT "low er = bad": the *deadest* chop (`er<0.10 & atr≥0.40`)
  WINS +$20.9/t — it's the specific middle band.
- **Robustness (decisive):** on the exact dates the zone trades, the **rest of the book is +$9.1/t** (rules
  out bad-days confound). Survives drop PB+06-24 (−$69.2, 7 ch / 8 dates).
- **Vocab:** NEW — two-sided `efficiency_ratio` band `[0.10,0.20)` AND a `momentum_atr` `atr≥0.40` gate. A
  single `er≥0.20` floor won't work (it would cut the `er<0.10` winners).
- **Forward-test:** shadow flag in computeLevels (same path as gap_min); **size-down, never hard block**.

## Lever 4 (weak) + Lever 5 (exit)

- **LEVER 4 — Shallow OR-break depth (ORB-family ONLY).** Shallow break (<0.5·ATR past the 30-min OR) =
  **0% wr, −$527/t, n=12**; deep +$96/t. **INVERTS on grind/power (shallow +71% wr) → exempt them.** NEW
  `or_break_depth_min` (~0.5·ATR), ORB/breakout-scoped. Graded WEAK (n~8–10 clusters). Shadow-flag only.
- **LEVER 5 — Stall/time-stop on the scalp book (EXIT, the loudest signal).** TARGET exits 93.8% wr /
  +$164 / 15min vs STOP **1.4% wr / −$254 / 174min**; ride-to-close gives back median **74% / $236** of peak.
  ⚠ The "hold≤1min edge" is **selection-on-outcome** (hold==0 = instant-target artifact; entry features
  identical fast-vs-slow) — NOT an entry rule; the ~10s fast-target sweep is already deployed. **Actionable
  residue:** field the existing **stall-exit knob** (`stall_minutes`/`stall_max_favor_pct`, migration 43,
  doctrine strand-4) on grind/power **shadow-first** — cut loser magnitude without sacrificing fast winners.

## Per-channel notes

- **V3 / ALT — NOT validated *in this window*** (−$14.3/t, n=19) — but that's the single-window mirage the
  desk's prior warns against (gap_min stood them down on flat opens → only the marginal fired). **Do NOT
  re-litigate their armed status on this month**; their multi-window backtest validation stands. Levers 1+2
  apply cleanly (shallow-VWAP −$74.3 vs deep +$24.5; hist-against −$37.6 vs +$8.1).
- **pb-ride — the biggest $ bleeder this month (−$103.2/t, n=32, tot −$3,303)** and the worst tenant of
  nearly every bad bucket. 1DTE leg (−$137) worse than 0DTE (−$73). Chop/put month + pullback-*buy* = partly
  regime, but most exposed to shallow-displacement + against-histogram traps. **Cleanest place to shadow
  Levers 1+2+3.** Regime warning, not a verdict.
- **grind** — base is a coin flip (−$0.3/t, n=147); the manual ✋ twin is the edge (+$8.4/t, 61% wr).
  Power-hour decay verified → extend grind-v3's ~14:00 `time_before` curfew to base `grind`/`grind-manual`.
- **power** — POWERHOUR base (+$23/t) and ALT (+$17/t) were among the month's few WINNERS (trendy early
  days); Final30 bleeds (−$106/t). "Stand down power when atr>0.30" REFUTED (65% of the loss is 06-05 alone;
  atr>0.30 is a gap/chop proxy → maps to existing `momentum_atr`/`gap_min`). **Don't arm an atr cap on power.**
- **QQQ-ORB** — −$48/t with high MFE (32%) = an **exit/giveback** problem, not a no-edge entry. Subject to
  Lever 4 + the stall-exit thread.

## Generative residue — real-looking shapes our vocab CANNOT express

1. **Premium-peak ratchet (exit).** The asymmetry (target 22% giveback vs ride 74%) + high-MFE-but-negative
   channels (QQQ-ORB 32%, PB 24%) = trades that reach a real peak and surrender it. The desk has premium
   stops + an *underlying* ATR chandelier but **no premium-peak-giveback exit** ("lock when given back X% of
   a ≥+Y% peak"). `peak_mark` now stamps live → first honest chance to test it (premium was deemed too noisy
   at 0DTE, but durable peak capture is new). **Named shape: premium-peak ratchet.**
2. **Unresolved-range suppression.** "Inside-OR-chop" (close in OR mid/upper third = −$55/t, MFE 9.5%) → a
   NEW `or_position`/`within_range` condition to suppress fresh directional entries while price sits inside
   the opening range. Lower priority (≈80% re-expresses Lever 1's near-VWAP state).
3. **Regime-conditional directional curfew (likely mirage).** "Morning calls bleed" (−$127/t) decomposes
   into the put-tape regime + a worse-morning effect — not knowable ex-ante. Only real if it survives a
   non-put month. Flagged, not pursued.

## Bottom line
Shadow-time the 3 entry levers (**shallow-VWAP deadband > MACD-hist-against > whipsaw-zone size-down**) +
field the **stall-exit knob** — all NEW vocab, all computable from the `entry_features` already flowing,
all **shadow-logged not armed**. Prioritize on **pb-ride and the V3/ALT smart channels**. Re-run weekly.
