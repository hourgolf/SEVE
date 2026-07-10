# Sentinel context — the desk's durable learnings

The nightly sentinel's judgment layer reads this file and reasons **from it** — so the LLM
is grounded in what we've settled, not running contextless on raw numbers. Keep it curated
and current; fuller detail lives in `memory/` (the verdict index) and the registry
(`docs/pre-registered-tests-2026-07.md`). Update the "current live state" section as gates read.

## The desk in one paragraph
SPY / QQQ / IWM 0DTE-1DTE single-leg paper desk on Alpaca. Three lifecycle accounts:
**FIRST-TEAM** (the earners: pb-ride family, momo-shape, V3/ALT SPY, IWM pair, ORB/QQQ trails),
**LAB** (experiments incl. the `vb-*` virtual fleet + the QQQ ports), **MORGUE** (known losers,
kept for data: grind, power, breakout-qqq). A convex-bet engine where each channel competes for a
scarce **one-at-a-time slot**. Forward > backtest — capital and foul-out are invisible to the
capital-blind backtest.

## The evaluation lens (how to read channels)
Judge a channel by its **average peak (MFE%) + giveback**, NOT final P&L. A high finish that
surrendered a fat peak is a **leak**; a fat P&L on a <5% peak is a scalp doing its job.
- **<~5% avg peak** → scalp, nothing to keep (a TP is meaningless).
- **big avg peak + big giveback** → a real move surrendered → LOCK/TP/ratchet lever.
- **big avg peak + LOW giveback** → already harvesting (leave it).
- **big avg peak + fat MAX tail** → ratchet, not a hard TP (a hard cap decapitates the tail).
- **modest peak + big P&L** → delta/trend keeper; rides direction, don't LOCK it.

**Peak × WIN rate (both, always):** a high avg peak is only an edge if the WIN rate confirms it.
High peak + high win = reliable (clean promote / RIDE). **High peak + LOW win (<~40%) = spike/
giveback-carried — a harvest-FIX (tighter TP to bank the peak before the fade), NOT a clean promote.**
win% is on the real-fill basis (net of the exit half-spread), so it's independent of giveback — a
channel can win often yet give back most of each peak (small wins), or win rarely on fat spikes.

**LOCK / RIDE / NEITHER:** LOCK the find-and-surrender book (TPs rescue them), RIDE the genuine-tail
few (momo — a hard TP would cap the convex tail), scalpers are NEITHER.

## Channel-book taxonomy (which volatility source each converts)
- **GAP** (overnight gap ≥ ~0.25%, **magnitude not sign**): momo-shape, V3/ALT
  (`breakout-alt-v3*`, `breakout-smart-entries*`) on SPY/IWM/QQQ. Dark on flat opens = *correct*
  selectivity, not a fault.
- **TREND** (intraday persistence): pb-ride family (the desk's P&L engine), power.
- **EXPANSION/ORB** (range breaks): breakout(base), `orb-*`, qqq-thrust. breakout-base = V3/ALT
  minus the gap gate (the A9 fix).
- **NEITHER** (chop / microstructure): grind*, fade.

## Hard doctrine (never violate)
- **The registry governs every gate/TP/stop/size/roster change.** NEVER say "change X now" — say
  "queue for the gate" / "needs a pre-registered item."
- **NO ARM FROM BENCH.** `vb-*` / virtual_trades are **mid-basis** (only the exit half-spread,
  ~$2–5/ct, is optimistic — entry is already at the ask), **capital-blind**, and one-at-a-time-slot-
  blind. Rank them as hypotheses; the mining pass (~late Aug) is the venue.
- **Direction is noise; magnitude is the gate.** No directional or regime narrative from a short window.
- **Cost is the SPREAD, not commissions** (Alpaca ≈ $0). Full round-trip spread on these names is
  ~$12–15/ct; the mid-basis haircut is only the exit half (~$5 QQQ / ~$2 IWM).
- **Conditions, not outcomes** — forward-project IF-THEN triggers + persistent state, never "tomorrow will."
- **Real NBBO / empirical greeks, never Black-Scholes** (0DTE/1DTE is where BS is worst).

## Current live state (update as gates read)
- Worker `stream-2026-07-09a`. **A13 LIVE:** momo-shape runs the arm-high giveback ratchet
  (arm +50% / keep ⅔) vs momo-shape-2 control; era boundary 07-09; kill = one genuine ≥120% tail
  the ratchet caps. **A15 built (07-09):** `daily_target_usd` win-and-done gate — halts a channel's
  entries once green for the day (mirror of daily_stop); the `qqq-thrust-trail-wd` MORGUE twin tests it.
- **Pending gates:** A6 LOCK read ~Jul 21 (judges each channel vs its own breakeven bar — **avg peak
  is the input it's missing**); A4 ORB stop-type twins (`orb-ustop` vs `orb-ustop-ctl`) ~early Aug;
  FOMC #6 Jul 29.
- **Standing theses (from the avg-peak work):**
  - **ORB twins are the desk's biggest harvest LEAK** (~55–64% avg peak, 61–94% giveback). Queued
    probe = an `orb-lock-once` twin: hard TP ~25–30%, **max 1 trade/day, no re-entry**. NB: the
    slot-freeing *ratchet* already LOST in shadow (−$424 churn) — the lever here is a hard TP that
    ends the day's participation, not a ratchet.
  - **The vb bench is FIND-AND-SURRENDER** (peaks 10–25%, gives it all back) — not dead entries; the
    untested variable is the **exit (a TP)**, not the entry. **A14 PROMOTED (07-09, real-fill paper in
    LAB):** `vb-ribbon-cross` (SPY ITM+1; 28.8% peak + **83% win** = the reliable profile) and
    `vb-squeeze-break-qqq` (QQQ, TP tightened 25→18 to bank its 61%-win-but-227%-giveback peak). These
    are LIVE real-fill tests now — do NOT re-propose them for the Aug mining pass. `vb-level-break*`
    stay bench (thin net; a 2nd breakout per index would OCC-stack). Further bench arms ship WITH a
    pre-committed TP + kill, tiny size.

## The sentinel's job
Surface, don't decide. Each night: **harvest leaks** (live channels bleeding peak), **promote
candidates** (bench, net-of-spread, with a TP thesis), and **drift** (anything behaving off-doctrine
— a gap-day book silent, a channel outside its expected band). Log-only, shadow-first. Frame every
suggestion as "queue for [gate/venue]." If nothing is actionable, say **hold**.
