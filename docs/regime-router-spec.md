# Regime Router — design spec

**Status:** DESIGN (not built). 2026-06-18.
**One-liner:** a shared TREND/CHOP/DRIFT classifier + a per-channel posture matrix so
the desk stops running directional rides into chop and a scalper into trends.
**Verdict up front:** the *actuation* is trivial (the desk already has every lever); the
*classifier* is the binding constraint and has been the desk's dead axis. This spec defines
the interface + the shadow-first gauntlet so a classifier can be validated before it routes a
dollar — it does **not** claim a working classifier exists yet.

---

## 1. The problem (operator's framing)

> "channels fight the day's trend and walk into landmines all day."

The desk runs ~7 channels with **fixed postures**, but their edges are **regime-specific and
often opposite**: directional rides (PB, V3/ALT, ORB, Power) need a trend; a scalper (grind)
needs chop. There is no mechanism to stand down the wrong-regime channels and wake the right ones.

**06-18 is the clean receipt.** SPY closed dead flat (−0.01%) but whippy (3 reversal legs):
- Every directional channel got chopped out → desk **−$2,059** (PB both ways, QQQ-ORB breakout
  fakeout, Power shorts round-tripped from +23% to stops).
- The *disabled* raw scalper (grind base) would have made **+$1,190** (37 scalps, 65% win) —
  chop is its feeding ground.
- The *armed* disciplined scalper (grind-v3) generated **0 trades** — its efficiency-ratio gate
  correctly detected chop and stood down… which on a scalper is exactly backwards.

The day that murdered the rides was a paradise for the scalper. The desk had no way to express that.

---

## 2. What's already true — the desk is a *primitive decentralized router*

This is not greenfield. Channels already self-select on regime, each in its own way:

| existing gate | channel | what it routes on |
|---|---|---|
| `gap_min` | V3 / ALT | stand down on flat-open (no-catalyst) days |
| PB ribbon-stack | pb-ride | only fire when EMA ribbon is trend-aligned (in theory) |
| grind-v3 er-gate + 14:00 curfew | grind-v3 | stand down on low-efficiency (chop) tape |
| FOMC event stand-down | machine roster | flatten + block on the 2pm window |

So the desk is **already a decentralized router** — `gap_min` + the PB ribbon + grind-v3's er-gate
are per-channel regime decisions made independently. The router's job is to **centralize and
correct** this: make the regime call *once*, consistently, and let each channel declare a posture
per regime — instead of every channel re-deriving "is it chop?" with a different (sometimes
miscalibrated) gate. grind-v3's er-gate is the cautionary example: it's a *directional*-strategy
filter bolted onto a *scalper*, so it stands grind down on its single best day.

---

## 3. The regime taxonomy + the channel posture matrix

From `regime-attribution-probe` (channels are **strongly separable** — the feasibility result):

- **TREND** (clean directional, |move| ≥ ~0.45%, <3 reversal legs): rides pay. PB +$555/session,
  V3/ALT shine, ORB/Power lean with the move.
- **CHOP** (whippy, range-bound, ≥3 reversal legs): rides bleed (PB −$313/session), the **scalper
  harvests** (06-18: grind +$1,190).
- **DRIFT** (low-vol, no catalyst — ~48% of sessions, **all-negative** historically): everything
  bleeds slowly via theta + the cost gate.

**Posture matrix** (regime × channel → arm / mute / size). The router decides *posture*, never
*direction* (see §6 — directional reaction is refuted):

| channel family | TREND | CHOP | DRIFT |
|---|---|---|---|
| PB (1DTE pullback ride) | **ARM** | mute | mute |
| V3 / ALT (gap breakout) | **ARM** | mute | mute *(gap_min already ≈ does this)* |
| ORB / Power (directional lean) | **ARM** | mute | mute |
| grind (scalper) | mute / small | **ARM** | small |

Note the scalper row is the **inversion** of grind-v3's current er-gate: the router *arms* grind on
classified chop. That single change is the largest lever the matrix implies, and the one with the
most direct 06-18 evidence — but it is one cherry day (see §6 kill criteria).

---

## 4. The binding constraint: the ex-ante classifier (the dead axis)

**This is the whole ballgame.** Actuation is trivial; calling the regime *before the day plays out*
is the hard, repeatedly-refuted part. Status of candidate classifiers:

| classifier | knowable | status |
|---|---|---|
| morning **drift + VWAP persistence** (\|open→10:30\|, frac on one side of VWAP) | 10:30 | **FAILED OOS** as a breakout gate AND as a PB-mute (3/5 windows). A regime *label*, not a same-day signal. Dead as primary. |
| **per-bar er** (grind-v3's gate) | continuous | Worked in real time on 06-18 (stood grind-v3 down on the chop). The pb-conviction probe shows er is a real per-entry trend signal (monotonic). Untested as a *router* input across windows. Promising. |
| **realized ÷ implied** morning move | ~10:30 | Best chop *detector* found: 48% recall (vs drift's 36%), holds ex-CHOP-MIX ([[chop-day-strategy-verdict]]). Detection was never the binding constraint *for the fly* — here detection **is** the point. |
| **gamma-open clock** (implied-move / call-δ @9:35) | 9:35 | Candidate DRIFT detector. First live capture 06-17; correlate vs day-P&L after ~10 sessions. |

**Implication:** the classifier is a *research program*, not a build. This spec's deliverable is the
**interface** (so any classifier plugs in) + the **shadow harness** (so one is validated before it
routes). Do not build the actuation expecting the classifier to appear — build the harness that
tells you whether a classifier is real.

---

## 5. Architecture & interface

Keep the decentralized gates as the **fail-safe floor**; add the centralized regime signal as an
**additional posture input**, shadow-first. Mirror the `market-events` pattern (stale/absent signal
⇒ normal trading — fail-open on the signal, never force entries).

- **`regime_signal`** — computed each cycle (morning call + intraday update): `{ regime:
  TREND|CHOP|DRIFT, confidence, asof }`. **Symbol-scoped** (SPY and QQQ can diverge). Source = the
  validated classifier from §4 (until then: shadow-only, never gates).
- **`regime_policy`** per channel — `{ TREND: arm|mute|scale, CHOP: …, DRIFT: … }`. New
  `strategist_config` column (mirrors `event_policy`), default `arm` everywhere = today's behavior
  byte-for-byte.
- **Worker** reads `regime_signal` + each channel's `regime_policy`, applies posture (skip entries /
  apply a sizing scalar via the existing `convictionScalar`/sizing-model hook). **Additive** to the
  existing gates; a channel muted by `gap_min` stays muted regardless.
- **Fail-safe:** no/stale signal ⇒ all channels `arm` (normal trading). The router only ever *adds*
  stand-downs or *down-sizes*; it never creates an entry.

---

## 6. Build phases (shadow-first, the grind-v3/QQQ discipline)

**Phase 0 — classifier validation (the gating risk, do this FIRST).** New `regime-router-probe`:
classify each session **ex-ante**, apply the §3 matrix, compare **routed-desk vs always-on-desk**
P&L across the 5 windows + MC tail + the ex-CHOP-MIX confound. **PASS = routed ≥ always-on on ≥4/5
windows without gutting the TREND tail** (the inverted-gate failure mode). Fail ⇒ park, keep
decentralized gates. *(This is the same bar pb-regime-mute and chop-ride-oos faced.)*

**Phase 0.5 — grind-on-chop sub-probe.** The matrix's biggest single claim: does **arming the
disabled raw grind on classified-chop sessions** beat muting it? 06-18 is a +$1,190 anecdote; this
needs the 5-window corpus + the classifier's *real-time* calls (not hindsight `regimeOf`). The
mirror of pb-regime-mute, pointed at the scalper.

**Phase 1 — shadow.** `regime_signal` computed live; router decisions logged as shadow events
(mirror `shadowManage`/the override ledger). Accrue ~1 month of "what the router would have done"
counterfactual. **Zero trade-path impact.**

**Phase 2 — paper-lab.** Route a *duplicate* desk in a separate paper account (the multi-account
cockpit P3); live-observe routed vs the flat twin across a regime transition.

**Phase 3 — arm per-channel**, only where the routed posture beats flat over a real transition.

---

## 7. Kill criteria & failure modes

- **The classifier fails OOS** — the most likely outcome given prior evidence (drift+persistence
  already died twice). Then: park the router, keep the decentralized gates. The shadow harness is
  cheap insurance against wiring a dead signal.
- **Concentration risk.** One classifier mis-call could mute the whole desk on a good day. Mitigation:
  the decentralized gates remain the floor, and the router **only adds stand-downs / down-sizes —
  never forces an entry**. Worst case = a missed day, never a bad trade.
- **No directional reaction.** `chop-router-probe` is REFUTED — level-reversals lose **20× worse**
  on whipsaw days; chop steamrolls *both* directional shapes. The router decides **posture**
  (arm/mute/size), never **direction**. The chop play is the *scalper* (already directional-agnostic)
  or stand-down, never a cleverer lean.
- **Grind re-arm is not a free lunch.** 06-18 is one cherry chop day; the 5-window verdict is that
  machine-grind is −EV overall (it gives this back on trend days). The router may arm grind **only on
  classified chop**, and **only if Phase 0.5 passes**.
- **DRIFT is a stand-down, not a trade.** DRIFT sessions are all-negative historically; the only
  edge there is *not trading* (or min-size). Don't invent a drift strategy.

---

## 8. What 06-18 adds to the file

- A strong anecdote for the core thesis (chop day: rides −$2,059, scalper +$1,190 — the inversion is real).
- grind-v3's er-gate demonstrated **real-time chop detection that fired correctly** — a candidate
  classifier input (§4), just currently pointed the wrong way for a scalper.
- The `pb-conviction-probe`: er is a real per-entry trend signal but **can't rescue PB alone** (only
  flips +EV by cutting 95% of trades). Reinforces that regime belongs at the **router** level
  (arm/mute the whole channel by regime) — not only as an entry filter inside one channel.

**Next concrete step:** build `regime-router-probe` (Phase 0) + `grind-on-chop` (Phase 0.5) on the
5-window corpus, using the per-bar er and realized÷implied classifiers (the two that aren't dead),
scored routed-vs-flat with the standard gauntlet. Everything downstream waits on that passing.
