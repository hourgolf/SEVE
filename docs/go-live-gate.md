# G1 · THE GO-LIVE GATE — pre-registered graduation criteria for real capital

**Status: FRAMEWORK DRAFTED 2026-07-05 — every threshold marked ⚠ is a PLACEHOLDER the
operator overwrites. The gate becomes LAW (registry-grade, anti-threshold-shopping) only
when the operator commits the numbers — and like every registry item, the numbers must be
set BEFORE the evidence window they judge, never after looking at it.**

Why this exists: the desk is a paper organism with no defined purpose-terminal. Without a
pre-registered graduation gate, "are we ready for real money?" gets answered by recency and
mood — the exact failure mode the registry was built to kill. This document makes go-live a
MEASURABLE state, decided by rules written while nobody knows if they'll pass.

---

## 1 · What graduates (the unit is the CHANNEL-SET, not the desk)

Only a defined **live set** graduates — proposed default: the FIRST-TEAM harvest engines
that pass their own gates (A6/A10) at read time. The LAB and MORGUE never touch real
dollars by construction. The live set is frozen at gate-evaluation time; changing it
afterward = a new gate evaluation.

## 2 · Evidence gates (ALL must hold simultaneously)

| # | Criterion | Placeholder | Operator sets |
|---|---|---|---|
| E1 | Consecutive calendar months of positive desk-level forward expectancy on the live set (clean books, realized) | ⚠ 3 months | ___ |
| E2 | Regime diversity within that window (day-shape ledger must contain trend AND chop AND mixed stretches — no single-regime green light) | ⚠ ≥2 distinct regimes | ___ |
| E3 | Per-channel: every live-set member passed its own pre-registered gate (A6 LOCK bar / A10 ride rules) at its own N≥40 | fixed (not a placeholder) | fixed |
| E4 | Max peak-to-trough drawdown on the live set over the window, as % of the paper bucket | ⚠ ≤ 4% | ___ % |
| E5 | The forward expectancy survives WITHOUT the single best week (drop-the-best robustness — no one-hot-streak graduations) | fixed | fixed |

## 3 · Operations gates (ALL must hold — real money forgives nothing paper forgave)

| # | Criterion | Placeholder | Operator sets |
|---|---|---|---|
| O1 | Books tie-out streak: nightly reconcile-alpaca error < $200, unbroken | ⚠ 30 sessions | ___ |
| O2 | Zero UNRESOLVED orphans/stranded lots (2-cycle-confirmed) over the window; ORPHAN_FLATTEN armed and proven on ≥1 real detection or 30 clean days | ⚠ 30 sessions | ___ |
| O3 | Worker uptime through RTH (heartbeat gaps > 5m during sessions) | ⚠ ≤ 2 gaps/month | ___ |
| O4 | **Master account-level stop ENFORCED in decide.ts** — the dead knob MUST be wired and live-tested (paper) before any real dollar; kill-switch flatten re-proven within 30 days of go-live | fixed (build precondition) | fixed |
| O5 | Worker single-point-of-failure story accepted in writing: either a live-tested failover path or an explicit operator sign-off on single-replica risk | fixed (decision precondition) | fixed |

## 4 · The sizing ladder (graduation is a RAMP, never a switch)

- **Stage 0 → 1:** ⚠ $5,000 real, live-set only, all sizing knobs scaled to the bucket
  (RISK proportional), C1 stack cap ARMED, master stop armed at ⚠ 2% of bucket/day.
- **Stage 1 → 2:** after ⚠ 1 clean month at Stage 1 (books tie to the penny vs real fills;
  fills-quality delta vs paper documented) → ⚠ $25,000.
- **Stage 2 → 3:** after ⚠ 2 further clean months → ⚠ operator's number.
- Any RE-BENCH event (below) drops one stage minimum; two re-benches inside 90 days → back
  to paper entirely, gate re-runs from zero.

## 5 · Re-bench triggers (pre-registered exits from live — as binding as the entry)

- R-B1: live-set drawdown exceeds ⚠ 1.5× the E4 gate value → flatten + bench, same day, no debate.
- R-B2: books fail to tie (> $200 error) for 2 consecutive sessions → bench until root-caused.
- R-B3: any unresolved orphan lot in a REAL account → bench until root-caused.
- R-B4: the A6-successor read flags a live-set channel below its bar at N≥40 → that channel
  exits the live set (others continue).
- R-B5: fill-quality drift — real slippage vs the paper model worse than ⚠ 2× modeled for
  ⚠ 10 consecutive sessions → bench (the paper edge may be a fill artifact).

## 6 · Standing rules

- The gate is evaluated by script (`a6-read` pattern — mechanized before outcomes), on a
  schedule, never ad hoc. A failed gate re-arms automatically; no partial credit.
- Thresholds change ONLY by editing this doc BEFORE the evidence window opens (registry
  header rule). Once an evaluation window is running, the numbers are frozen.
- Nothing in this document is a prediction that the gate will pass. The desk may live in
  paper forever; that outcome is acceptable and this gate makes it an honest one.

**NEXT ACTION (operator):** overwrite every ⚠ placeholder, or say "placeholders stand" —
either way the numbers become law when committed, and the E-window clock starts at the
first month boundary after that commit.
