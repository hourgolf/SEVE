# Pattern Fan-Out Discovery Brief — 2026-06-24

> **STANDING CAVEAT.** Every candidate below was mined on **ONE chop / put-tape month**
> and the forensics dataset is **capital-blind** (no foul-out / one-at-a-time slot enforced).
> Therefore **every ENTRY candidate is a HYPOTHESIS**, not a verdict — it must clear the
> **re-entry-aware OOS leverGate + placebo verify** (`pattern-verify.ts`) before anyone arms it.
> The recurring trap (the shallow-VWAP lever, [[forensics-levers]]) is **mechanical trade-cutting**:
> a gate "improves pooled $" only by removing trades on a −EV book, while per-trade expectancy
> stays flat-or-worse and the freed slot re-enters into the same loss. The OOS leverGate is the
> only lens that catches this. **EXIT candidates** are post-hoc by construction (they read
> MFE/giveback/holdMin/close_reason) → they are **management hypotheses** needing an exit backtest,
> never an entry filter.

Feeds: `data/pattern-candidates.json` (machine artifact for the verifier).

---

## Surviving candidates by archetype

### grind (scalper)
- **ENTRY — `grind-inside-or-noconfirm`** · `orDepthAtr < 0` · **moderate** · backtestable
  The only grind entry candidate to resist every kill lane. ~150t each side
  (inside −$17.4/t/148t vs deep +$21/t/141t), 13 dates, survives drop-worst-date (−17.4→−13.4).
  **NOT put-tape** — the deep>inside gap holds WITHIN both directions (calls +$32/t, puts +$51.6/t
  deep-minus-inside) and is directionally consistent across grind-base/v3/manual. The scalper's
  signature structural pathology: firing without break confirmation. **Novel vs the 3 known levers.**
- **EXIT — `grind-fast-exit-is-the-edge`** · The ≤2min fast exit IS grind's edge; held scalps decay
  monotonically (≤2min +$20.4/t/149t → (2,30] −$6.8 → (30,120] −$132 → >120 −$320). Argues a hard
  time-stop tighter than the curfew (~15-30min) — verify it doesn't amputate the ≤2min winners.
- **EXIT — `grind-giveback-ratchet`** · Mid-MFE [20,50) band (+$130/t) is salvageable; [0,20) round-trips
  (−$38.6/t, ~597% giveback). Ratchet once MFE clears ~20-30%, target the [20,50) band not the thin (5t) >=50 unicorns.

### power (final-hour lean)
- **ENTRY — `power-chase-momentum`** · `dirMom >= 0.3` · **moderate** · backtestable
  Blocking strong-momentum late leans (chasing an already-spent move). Reproduced exactly
  (−$66/t blocked n=63 vs +$76/t kept n=57). 11 dates; **direction-robust** (bad calls −$37/t AND
  bad puts −$84/t); **ATR-separable** (high-ATR alone FLIPS +$63/t once you control for signed momentum
  → momentum bleeds, not vol); negative across ALL 4 channels. **Genuinely novel vs the 3 known levers.**
  ⚠ blocks 53% of trades on a near-breakeven book → **OOS leverGate FIRST** to confirm the freed slot
  re-enters +EV (the shallow-VWAP trap).
- **EXIT — `power-peak-ratchet`** · MFE>=50% +$331/t vs [0,20) −$83/t; 6 of 18 trades reaching +30%
  MFE round-tripped to a loss. Lock a partial once a lean pops +30%, preserve the +$331/t tail.
- **EXIT — `power-stall-midhold`** · holdMin ≤2 +$55/t (clean pops), (2,30] −$41/t (wandering into chop),
  >120 +$182/t. Cut the (2,30] non-mover; complements pb-ride's 120min stall at a shorter timescale.

### breakout (ORB / momentum break)
- **ENTRY — `brk-early-erspike`** · `er >= 0.45` **AND** `minToClose >= 180` · **moderate** · backtestable
  Blocks the open momentum-spike (high-ER break in the first ~30min). n=28 (−$121.8/t) across 9 dates,
  direction-balanced 8c/20p (NOT put-tape); survives every date/trade drop. **Genuine INTERACTION** —
  er>=0.45 alone −$10/t, early alone −$32/t (neither gates), intersection −$122/t vs the complement +$74/t.
  This is why the single-axis lever probes missed it; the two-feature predicate is the whole point.
- **EXIT — `brk-peak-ratchet`** · MFE>=50 +$517.5/t (95% win) but +130-165% runners closed at 78-83% giveback.
  Floor at ~50-60% of live peak_mark once MFE>+50%; do NOT hard-target +50% (amputates the +401% monster).
- **EXIT — `brk-stall-cut`** · (30,120]=+$318.8/t (the runners), (2,30]=+$5/t churn, MFE[0,20)=−$147.8/t (32t,
  the substance). Stall-cut a breakout whose peak never clears ~+20-25% within ~30min — likely TIGHTER than
  pb-ride's 120min since breakout winners live in (30,120]min.
- **EXIT/DIAGNOSTIC — `brk-trailstop-quality`** · trail_stop −$146.4/t (7% win), stop_premium −$451.8/t (0% win)
  vs ride +$107.6/t (52%). ⚠ Sound as a DIAGNOSTIC ONLY — only 6/19 toxic-exit rows fall in the entry-toxic
  region, so "fix the entry, the trail bleed disappears" is **NOT supported**. Cross-tab vs brk-early-erspike in OOS.

### orb (trend-ride family)
- **ENTRY — `orb-shallow-break-block`** · `orDepthAtr < 1` · **moderate** · backtestable
  The cleanest entry survivor on the board. Blocked <1 region n=18, −$326/t, 22% win — **NOT put-tape**
  (holds within calls −$380 vs +$77, within puts −$260 vs +$222). Robust to leave-one-date-out AND
  leave-one-channel-out; the worst single trade (−$2085, 06-24, orDepthAtr=0.01) falls INSIDE the block.
  Monotonic across all 3 channels. Edge concentrates in <0.5 (n=10, −$534/t, 0% win) → **tighten to <0.5
  for highest conviction**. orb-qqq-trail is the one armed slug in the OOS set (n=12, thin).
- **EXIT — `orb-premium-peak-ratchet`** · The atr_chandelier rides the UNDERLYING, so a 0DTE option that pops
  then mean-reverts gives the whole pop back before the underlying trail fires. MFE[0,20) round-trip n=18/10 dates
  (−$388/t). Lock a giveback floor once MFE>+20-25%. **The strongest, most actionable signal in this archetype is
  on the EXIT side** — it attacks the same false-breakout-that-round-trips population as the entry gate, from the other end.
- **EXIT — `orb-stall-cut-mid-hold`** · (30,120]min −$133/t (n=17/11 dates, 47% win — large faders), (2,30] +$13/t.
  Stall timer (~30-45min) on these short-fuse rides; +EV mass is in (2,30].

### PB RIDER (pullback-in-trend) — pb-ride (1DTE) + pb-ride-2 (0DTE)
- **NO ENTRY SURVIVORS.** Aggregate n=32, exp −$103/t. The two 06-24 call trades (−1296 + −1956 = −$3,252)
  are **ONE bet placed twice** (identical entry context across the 1DTE + 0DTE channels) and account for
  **98% of the month's net loss**. They sit in the bad bucket of all four entry candidates simultaneously,
  so every entry split is the same two trades re-labeled → all four entry candidates **KILLED** (see appendix).
- **EXIT — `pb-premium-stop-too-tight`** · **The firmest finding on the entire board.** 7/7 premium_stop closes
  are 0% winners (exp −$718/t); the pattern holds across 5 dates/contracts BEYOND the two 06-24 outliers
  (06-17/18/22), all stopping out with MFE only 3-10% (barely moved favorable, then full −50%).
  Replace/widen the −50% fixed premium stop with an underlying-based or peak_mark ratchet stop.
  Forward-watch via live peak_mark; **do NOT arm a flat premium-stop change blind on one month.**

### qqq-thrust
- **NO ENTRY SURVIVORS** (all killed — thin n + corrupt orHi=0 feature stamps + selection-on-outcome; see appendix).
- **EXIT — `qqqthrust-smallmfe-giveback-ratchet`** · Round-trip mechanism real and visible (06-05 gave back 488%
  of peak, 06-09 200%, 06-12 645%). ⚠ TRIGGER THRESHOLD is load-bearing — MFE[0,20) n=6 but 2 are winners (+$12, +$116);
  too-tight a ratchet clips the +$116 manual:reversal winner; the worst row (−$402) has a corrupt orHi=0 stamp.
  Folds in the **operator-beats-machine-exit** observation (every operator manual exit beat every machine exit; the
  lone underlying_stop −$218/gb645% is the worst on the board) as the SAME managed-exit forward-test — n=1/cell,
  confounded by selection-on-the-trade, NOT an independent edge.

---

## Confirmed vs contradicted vs the known lever verdicts

**Known levers ([[forensics-levers]] / [[forensics-pattern-brief-2026-06-24]] / the lever-probe inversion):**
shallow-VWAP-displacement (mechanical), MACD-hist-against (the REAL edge on V3/ALT), whipsaw-zone (inert),
stall-exit (armed at 120min on pb-ride).

- **CONFIRMED — whipZone is INERT.** orb, grind, power, and PB all surfaced whipZone-style blocks; **all were
  killed** (single-date / two-trade driven). No archetype produced a surviving whipZone entry. This re-confirms
  the desk verdict against whipZone under the rigorous test — and pb-whipzone-block is the textbook trap
  (disagreeing with "whipZone inert" on the strength of two duplicated trades).
- **CONFIRMED — shallow-VWAP is mechanical / lever-duplicative.** grind-thin-vwap-notch and orb-vwap-midband-block
  both KILLED as refinements of the known shallow-VWAP lever with no independent expectancy (single-date dominance /
  64% overlap with break-depth). The new orDepthAtr break-depth gates (`grind-inside-or-noconfirm`,
  `orb-shallow-break-block`) are a **distinct displacement axis** (OR-break depth, not VWAP distance) — they must
  still pass the OOS leverGate to prove they're not the same mechanical trade-cut wearing a new feature.
- **CONFIRMED — stall-exit doctrine (cut dead money to free the slot).** Independently re-derived across grind, power,
  breakout, and orb exit candidates at SHORTER timescales than pb-ride's 120min (grind ~15-30min, power (2,30], orb
  ~30-45min). NOTE grind-stall-cut is **inert for the machine** — grind/grind-v3 have ZERO machine trades past 30min;
  the entire >30min tail is operator-discretionary holds. Carry as forward observation only.
- **CONTRADICTED — `qqqthrust-operator-beats-machine-exit` vs the ustop-hurts-momentum desk finding: AGREES,
  not contradicts.** The single underlying_stop trade (06-12, −$218, gb645%) is the worst exit on the board and
  fires at the worst moment — mirroring the desk-wide "ustop is the chop murder-weapon" verdict, here on qqq-thrust.
- **NO MACD-align candidate surfaced in any archetype.** The fan-out mined the awareness-lever features
  (dirVwapAtr/histRel/whipZone/orDepthAtr) + the raw entry features, but **no histRel/MACD-hist-against entry
  survived** — qqqthrust-bighist-overextend (the one histRel candidate) was KILLED (the edge rested on ONE +$213
  trade and the block list contained the channel's two best winners). This is **consistent** with the lever-probe
  finding that MACD-hist-against is **channel-specific to V3/ALT** — and V3/ALT were not in this archetype fan-out.
  The absence of a MACD survivor here is the expected null, not a contradiction: don't generalize the V3/ALT MACD
  edge to grind/power/breakout/orb/qqq/PB on the strength of this dataset.

**Net read:** the fan-out produced **4 backtestable entry hypotheses** — two break-depth gates (orDepthAtr, the
genuinely novel structural axis), one momentum-chase gate (dirMom, power), one two-feature interaction
(er×early, breakout). The **single most promising NEW (non-lever) pattern** is the **break-depth / no-confirmation
family** (`orb-shallow-break-block` + `grind-inside-or-noconfirm`): same orDepthAtr axis, two archetypes,
direction-robust within calls AND puts, monotonic across channels, survives every leave-one-out. The
**brk-early-erspike interaction** is the most interesting because it's invisible to any single-axis probe.

---

## Killed appendix (what got cut and why)

**grind**
- `grind-weak-dirmom` — calendar-clustered artifact (89/92 bad-bucket trades on 06-01..06-04), other channels ~zero in band, ~80% overlaps C3. Fails kill (2)/(4).
- `grind-deadvol-atr` — same first-week regime cluster (all 95 atr<0.20 trades in 5 dates, 06-04 actually +$95), 75/95 overlap C2, grind-manual ZERO. Regime-proxy not edge.
- `grind-thin-vwap-notch` — single-date driven (06-09 = −$1172 of −$2027; ex-06-09 → −$31.7/t/27t); self-flagged novelVsLevers:false, duplicates shallow-VWAP lever #1.
- `grind-late-no-runway` — anecdote-grade (n=30; drop-worst-date → −$21.2/t); overlaps the existing curfew/late-day exit, not a new entry feature.

**power**
- `power-highatr-late` — put-tape (call side +$4/t) + dominated by dirMom (atr>=0.40 & dirMom<0.3 FLIPS +$63/t). ATR is a correlated put-side confirmation, no independent expectancy.
- `power-overextension` — put-tape (call side +$4/t) + non-backtestable (power builtin runs no orDepth-gated spec) + dominated by dirMom; nothing added over the surviving chase gate.

**breakout**
- `brk-shallow-or` — n=7 (anecdote), single-date driven (3/7 on 06-10), direction-skewed 6p/1c = put regime not OR-depth edge; author confidence 'weak'.
- `brk-weakmom` — n=7 (anecdote), backtestable:false, overlaps shallow-OR + early×erHi; re-discovers the toxic shape from a third angle, folds into brk-early-erspike.

**PB RIDER** (all four entry candidates are the two duplicated 06-24 calls re-labeled)
- `pb-whipzone-block` — drop top-2 trades → breakeven; the 6 non-call in-zone trades net ~flat. Two duplicated bets, not an edge.
- `pb-high-atr-block` — drop the two calls → near-breakeven; the 12 remaining are ALL PUTS (put regime re-discovered). KILL #2 + #4.
- `pb-strong-mom-chase-block` — drop the two calls → literally breakeven (n=10); 4 of 12 'bad' trades were profitable 06-16 puts. dirMom also not in lever vocab.
- `pb-mid-gap-regime-block` — drop the two calls → −44; self-flagged put-tape/chop confound; re-discovers the regime.
- `pb-stall-dead-money` — DEMOTED not killed: overlaps the armed 120min stall knob; (30,120] magnitude leans on the two calls; the (2,30] +$69 bucket is 14/14 puts (regime). Do NOT retune to 30min on this evidence (would cut the (30,120] put winners).
- `pb-mfe-ratchet` — FOLDED into pb-premium-stop-too-tight (the MFE<20% give-back trades ARE the premium_stop full-losses; same mechanic viewed from MFE).

**orb**
- `orb-vwap-midband-block` — 64% overlaps the break-depth block (same displacement axis); the novel inversion rests on an n=2 [0,2) bucket. Kill #5 + #1.
- `orb-smallgap-block` — n=5 (below floor); −$491/t driven by the single −$2085 06-24 trade (other 4 avg −$92/t); self-flagged anecdote + re-validates armed gap_min.
- `orb-whipzone-block` — n=7 (anecdote), known-inert whipZone, not backtestable (slugs not in OOS set).
- `orb-premium-stop-overshoot` — pure diagnostic (n=7), exit-reason is not an entry signal; subordinate to the ratchet, not a separate candidate.

**qqq-thrust**
- `qqqthrust-inside-or` — n=3 + data integrity: qqq-thrust is NOT an ORB strategy so orDepthAtr is garbage; the worst row (−$402) has a corrupt orHi=0 stamp → the cut only 'flips the residual' by removing the corrupt row.
- `qqqthrust-deep-vwap-overextend` — n=3, really 2 distinct setups (06-09 put appears twice); deep-VWAP inversion unsupported at this n.
- `qqqthrust-bighist-overextend` — the 'good' side is a SINGLE +$213 trade; the block list contains the channel's two BEST winners (+$219, +$116); negative exp dragged by the corrupt −$402 + an exit-driven −$218. Self-defeating, outlier-driven.
- `qqqthrust-stall-midhold` — selection-on-outcome: the (2,30] 'bad band' contains the best winners (+$219 hold 17min, +$116 hold 26min); 'good' buckets are 1-2 trades; redundant with the ratchet. The real lever is peak-based, not a fixed-time stall.
