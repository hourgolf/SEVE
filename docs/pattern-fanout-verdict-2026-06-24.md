# Pattern Fan-Out VERDICT — 2026-06-24

The all-channel entry/exit pattern mine, after the **rigorous re-entry-aware OOS + placebo**
filter. The discovery (capital-blind, all 21 channels) is in `pattern-fanout-discovery.md`;
this is what **survived** — and the headline is a clean, valuable **negative**.

## TL;DR
- **ENTRY axis: COMPREHENSIVELY MINED OUT.** 0 of 10 candidate gates survived `pattern-verify`
  (4 primary + 6 cross-channel/threshold). Every big dataset split was capital-blind
  mechanical/window-concentrated churn — the placebo caught it. **Stop hunting entry filters.**
- **EXIT axis (premium-peak ratchet): mostly the SAME churn mirage.** On −EV channels the
  ratchet's "expectancy lift" is more re-entries → worse total; on the convex channels (V3, PB)
  it CAPS the tail. **One genuine residue:** an arm-HIGH ratchet on **ALT** (`gb40/arm50`).
- **Net:** this is the third rigorous confirmation that the desk is **mis-aimed at the
  entry/exit axis** ([[desk-doctrine]] / [[pb-conviction-and-regime-router]]). The leverage is
  the validated channels (ride V3/ALT's convex tail), **sizing** (pyramid cap12), **cross-index**
  (IWM), and the operator's discretionary edge — not more entry/exit cleverness.

## Entry candidates — all DEAD (re-entry-aware OOS + placebo, 308 SPY sessions)
| candidate | channel | poolΔexp | win | drop-best | placebo | verdict |
|---|---|---|---|---|---|---|
| brk-early-erspike (er≥0.45 & early) | ORB(breakout) | +2.3/t | 3/5 | ✗ | 5% | FRAGILE (beats placebo but window-concentrated) |
| orb-shallow-break (orDepthAtr<1) | QQQ-ORB | −2.9/t | 1/5 | ✗ | 95% | DEAD |
| orb-shallow-break (orDepthAtr<1) | **SPY ORB** full-OOS | −2.9/t | 1/5 | ✗ | 95% | DEAD |
| power-chase (dirMom≥0.3, blocks 53%) | POWERHOUR | −4.6/t | 3/5 | ✗ | 100% | DEAD (pure mechanical) |
| power-chase stricter (dirMom≥0.5) | POWERHOUR | −2.3/t | 2/5 | ✗ | 95% | DEAD |
| grind-inside-OR (orDepthAtr<0) | GRIND v3 / base | ~0/t | 2/5 | ✗ | — | DEAD (no expectancy lift) |

The fan-out's "most promising new axis" (break-depth `orDepthAtr`) and the genuine two-feature
interaction (`brk-early-erspike`) both fail: the dataset's −$326/t and −$122/t "edges" are
capital-blind artifacts that the freed-slot re-entry erases. `power-chase` is the textbook trap
— blocking 53% of a near-breakeven book looks great pooled, but a random filter of equal
selectivity beats it **100%** of the time.

## Exit — the premium-peak ratchet (ratchet-probe, arm-high `trailExit.armPct`)
The fan-out's strongest *direction* (every archetype's MFE→giveback board shows mid-MFE [20,50)
round-trips into losers). Tested ride-to-close vs arm-high ratchet, re-entry-aware, per-window:

- **Convex-tail V3:** every config **CAPS THE TAIL** (−15…−48/t). Never ratchet V3.
- **−EV round-trip (ORB / POWERHOUR / POWER Final30):** the "expectancy lift" is a **churn
  mirage** — expectancy rises but **total worsens** (POWERHOUR −$30k→−$39k) because earlier
  exits free the slot → ~50% more re-entries on a −EV book. Same trap as the entry levers.
- **PB RIDER:** ratchet **HURTS** (−7…−18/t) — it caps the 1DTE convex ride ([[one-dte-verdict]]).
- **GRIND:** **inert** (scalper exits before the ratchet arms).
- **⭐ ALT (the one genuine signal):** `gb40/arm50` (arm at +50%, give back 40%) → **+$1,599 /
  +16.4/t / SAME trade count / 4-of-5 windows.** Same n = NOT churn — it banks the faders while a
  HIGH arm threshold preserves the convex tail (lower-arm configs cap it). Modest, single-config,
  one near-breakeven channel → **live peak_mark shadow on ALT, not an arm.**

**Separate (untested here):** `pb-premium-stop-too-tight` — the firmest *dataset* finding (7/7
premium_stop closes = 0% win, −$718/t, across 5 dates beyond the 06-24 outliers). That's the
**−50% fixed stop**, NOT the giveback ratchet → a distinct forward-test (replace −50% with an
underlying/peak_mark stop on the pullback). Watch via the live `peak_mark` column.

## Method note (reusable)
The placebo (a random filter of equal selectivity) + the re-entry-aware engine is the only lens
that catches the mechanical-churn trap — and it caught it on **both** axes this session: a gate
that "lifts pooled $ / expectancy" by freeing slots on a −EV book is churn, not edge. Any future
entry OR exit lever must clear: lifts pooled **expectancy** AND total, helps ≥4/5 OOS windows,
survives leave-one-out, AND beats the matched-selectivity placebo. Tools: `npm run forensics-mine`
(discovery), `pattern-verify` (entry gates), `ratchet-probe` (exits), `lever-shared.ts` (the
shared re-entry-aware scaffold).

## Standing caveat
ONE chop/put-tape month + modeled 0DTE options. The negatives are robust (multi-window OOS +
placebo); the one positive (ALT arm-high ratchet) and all exit hypotheses are forward-test
candidates — the live `peak_mark` shadow is the validator. Nothing here arms a channel.
