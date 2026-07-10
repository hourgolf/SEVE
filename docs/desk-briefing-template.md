# Desk Briefing — sentinel spec + baseline

**What it is.** A daily artifact generated at each close that (1) **compiles** the
session, (2) **updates** the persistent desk state, and (3) **carries it forward** as
a conditional readiness map for the next open. It is the basis the "desk sentinel"
agent implements against. `npm run desk-briefing [YYYY-MM-DD]` emits the deterministic
skeleton; the agent layer adds judgment (expected-vs-anomalous prose, the structural
read) + paging. Provenance: built 2026-07-08 out of the two-book / day-type work — see
`memory/channel-book-taxonomy.md`.

## Prime directive — conditions, never outcomes
Every forward statement is a **persistent-state carry** or an **IF-THEN trigger** — never
an unconditional "tomorrow will." The gap-half is ex-ante (known at 9:30, magnitude); the
chop-half is descriptive only (an ex-ante chop classifier is the refuted binding
constraint — `memory/regime-router-feasibility.md`). **No config changes** (the registry
governs all knob/roster changes — `docs/pre-registered-tests-2026-07.md`), **no direction
forecasts, no orders.** Readout / roster-signal / expectation only.

## Data sources (all local capture artifacts — no DB, no secrets)
| Number | Source |
|---|---|
| Per-channel P&L, per-day gaps, regime features | `data/forensics-dataset.jsonl` (nightly, clean books) |
| SPY/QQQ/IWM open spots + implied move | `data/gamma-open.json` |
| Daily RTH OHLC (auto S/R ladder: pivots·PD·round·walls) | `data/bars-archive/SPY/<date>.json` |
| Dealer positioning (atm-IV, GEX sign, gamma walls) | `data/iv-bank/summary.jsonl` |
| Event calendar (FOMC/CPI/NFP/OPEX, next-day flags) | `engine/market-events.ts` + `market-calendar.ts` (pure code) |
| Blocked (`gap_min`) signals — gate scoring | `data/gate-shadow.json` |
| Broker NAV truth (reconcile) | `data/broker-truth.json` |

## Book taxonomy (slug → book) — `memory/channel-book-taxonomy.md`
- **TREND** — `pb-ride*`, `power*`
- **GAP** — `momo-shape*`, `breakout-*alt-v3*`, `breakout-*smart-entries*` (V3/ALT = gap-gated ORB)
- **EXPANSION** — `breakout` (base), `breakout-qqq`, `orb-*`, `*thrust*` (ungated ORB)
- **NEITHER** — `grind*`, `fade*`

Order matters: classify `grind*` before the `smart-entries` rule, so `grind-smart-entries`
→ NEITHER (not GAP). The gap gate is **per-index** (SPY gap ≠ IWM gap ≠ QQQ gap) — IWM
gaps run larger, so its leg can arm when SPY's doesn't.

## The three artifacts
1. **COMPILE** — day-type stamp (gap %, cleared 0.25%?, RTH O/H/L/C), book-level P&L
   attribution, each labeled expected-vs-anomalous.
2. **UPDATE** — what the session resolved: ladder levels tested / held / broke, regime
   state, gate counters ticked.
3. **CARRY FORWARD** — next-open readiness: levels in play, per-book IF-THEN triggers
   (gap arm-threshold = close ± 0.25%), watch-list (A13 tail-watch, gate proximity,
   ungated exposures).

## Forward-context sections (added 2026-07-09 — the "prep the day" layer)
Beyond the 3 artifacts, the briefing carries **next-session terrain**, all descriptive (never a forecast):
- **Auto S/R levels** — swing pivots + prior-day OHLC + $5 round grid + dealer γ-walls, clustered into
  confluence zones with source labels (e.g. `752.08 (PDC+PDH+swing-hi)`). Replaced the hand-anchored ladder.
- **Events & calendar** — next trading day's CPI/NFP/OPEX/FOMC tags + stand-down notes + FOMC countdown.
- **Dealer positioning** — atm-IV, implied move, GEX **sign** (− short-gamma = moves amplify → breakout;
  + long-gamma = pinned → fade), and the gamma walls (which also feed the S/R ladder).
- **Regime-conditioned priors** — per-book era-4 base rates split by gap-state (≥0.25% vs flat): n · $/t · win%.
  The doctrine-primary regime axis, IF-THEN framed (tomorrow's regime is unknown until the open).

## Deterministic (script) vs judgment (agent)
The script emits all facts + **mechanical anomaly flags** (gap cleared but its book
silent; flat-open + EXPANSION traded → A9 exposure). The agent adds the structural read,
the expected-vs-anomalous prose, and the page-vs-quiet call.

## Paging rule — quiet unless anomaly
Page on: (a) gap cleared but its book **silent** (fail-closed bug / data hole — the
coil-vs-gap failure mode); (b) a ladder level **breaks with acceptance**; (c) a channel
P&L **outside its regime-expected band**; (d) **A13 KILL trip** — one genuine ≥120% tail
the ratchet caps. Otherwise log-only.

## Rollout (shadow-first, per desk doctrine)
`desk-briefing` script (done) → agent wrapper drafts the judgment layer nightly, **log-only**
→ grade ~2 weeks (was the carry-forward right? were the flags real, or did it cry wolf?)
→ then it earns standing. Never arms config; proposals phrase as "queue for the gate."

---

## Baseline — 2026-07-08 (worked example + tonight's diff reference)
Verified by hand from tonight's capture; `npm run desk-briefing 2026-07-08` reproduces it.

**Day-type:** SPY gap **−0.606%** → CLEARED 0.25% (gap book eligible) · IWM −0.83% · QQQ −0.97%.
SPY RTH: O 743.16 · H 746.15 · L 739.51 · **C 745.28**.

### ① COMPILE (2026-07-08) — day P&L **+$2,647**, 39 trades
| Book | P&L | Read (agent layer) |
|---|---|---|
| **TREND** (pb-ride ×3) | **+$3,413** | carried — trend developed intraday, pb rode it (EXPECTED) |
| **GAP** (momo ×2 +$957 · QQQ ports 🔇 −$482) | **+$475** | momo fired 12× on the −0.61% gap as designed (EXPECTED); muted QQQ ports still logged −$482, reinforcing the mute |
| **EXPANSION** (breakout-base −401 · A4 twins −1,284 · QQQ-ORB +355) | **−$1,330** | bled — false breaks, ORB's documented chop weakness (EXPECTED) |
| **NEITHER** (grind ×3) | +$89 | flat |

No anomalies — every book behaved to design. On a gap-that-trends, both eligible books ate; the ORB/expansion book showed its known false-break failure.

### ② UPDATE — what 07-08 resolved
- **739 near-arbiter tested and HELD** (L 739.51 → C 745.28) → down-tripwire *rejected*; uptrend structure intact.
- Still **undecided at 745** (closed 745.28, on the fulcrum).
- Gap regime: 2 of last 3 sessions cleared 0.25% (07-06, 07-08). **07-02 was a +0.229% near-miss** (handoff's "+0.41" corrected; `gap_min ≈ 0.25%` confirmed by momo firing only 07-06/07-08).
- A4: prem-stop control extends its lead — orb-ustop-ctl +$529 vs orb-ustop −$90.

### ③ CARRY FORWARD — 07-09 readiness map
**Levels in play:** 752.4 (range top) · 748.5 · **745.3 (fulcrum/close)** · 739.5 (support, held) · 730 · 717 (era low).
**Per-book triggers, off the 745.28 close:**
- **GAP book (SPY):** arms IFF 07-09 opens **≤ 743.42 or ≥ 747.14** (±0.25% = ±$1.86). Below → puts, above → calls (magnitude gates; break picks direction).
- **IWM / QQQ gap:** independent, on their own opens.
- **breakout-base:** fires on any 30-min range break — **ungated exposure**; flat-open chop = the A9 bleed to expect.
- **pb-ride:** needs a ribbon-stacked trend to form off the open (its lane; carried today).

**Watch-list:**
- ⭐ **A13 goes live at the 07-09 open** — momo-shape runs the ratchet (arm+50% / keep-⅔) vs momo-shape-2 control. **Ratcheted-momo session 1.** Watch the first `trail_giveback` exit; **KILL = one genuine ≥120% tail the ratchet caps.** Don't pool 07-09+ momo with pre-boundary.
- Confirm the SPY gap book arms **only** if it clears ±$1.86 — else correctly dark (don't re-make the coil-vs-gap read).

### Gate/test accrual (as of 2026-07-08)
- **A6** — 6 of 15 era-4 sessions → read ~Jul 21.
- **A13** — session 1 = 07-09 (0 ratcheted trades yet).
- **A4** — orb-ustop 12t / −$90 vs orb-ustop-ctl 13t / +$529 → control leading; → N≥40/arm.
- **FOMC #6** — 2026-07-29.
