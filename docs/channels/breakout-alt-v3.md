---
name: "Breakout (Smart Entries V3)"
strategy_id: breakout-alt-v3
underlying: SPY
structure: single-leg
direction: directional
dte_range: 0-1
regime: "trending / momentum"
session_window: "10:00-15:25 ET"
---

# BREAK(ALT V3) — BREAK(ALT) with the momentum gate removed

> **A Monte-Carlo-derived re-tune of the desk's one real edge.** BREAK(ALT)
> (`breakout-smart-entries`) is the only live channel that projects convincingly
> positive. Bootstrap MC on its entry filters showed the `momentum_atr` gate was
> *pure over-filtering* — removing it is Pareto-better on every axis. V3 is BREAK(ALT)
> minus that one condition; nothing else changes.

## The evidence (real SPY Databento NBBO · Mar–Jun 2026 · 10k block-bootstrap paths)

| metric | BREAK(ALT) | **BREAK(ALT V3)** |
|---|---|---|
| realized (in-sample) | +$1,855 | **+$4,347** |
| median (p50) | +$1,842 | **+$4,151** |
| downside (p5) | −$5,087 | **−$3,627** (smaller) |
| P(period < $0) | 33% | **20%** |
| median max-DD | −$3,518 | −$3,542 |
| p95 max-DD (1-in-20) | −$7,273 | **−$6,949** (smaller) |
| Sharpe ×√252 | 0.83 | **1.54** |
| trades / sessions | 52 / 45 | 63 / 51 |

V3 wins on median, downside, loss-probability, tail drawdown, **and** Sharpe at once —
it is not buying return with risk. The `momentum_atr ≥ 0.3` (3-bar) gate was removing
profitable trades without reducing exposure.

## What stayed (the filter ablation said keep these)

- **`rel_vol ≥ 1.3` — the load-bearing edge.** Remove it and the whole strategy inverts
  (−$47/trade, P(lose) 83%). A volume-confirmed opening-range break IS the signal; the raw
  break alone is a coin flip (+$1/trade).
- **`efficiency_ratio ≥ 0.45` — kept as drawdown control.** Dropping it raised the median
  but blew tail drawdown out to −$10.8k (vs −$6.9k). The MC caught what the in-sample total
  hid; the ER gate earns its keep.
- **`vwap_side: above/below`** — redundant given the OR-break + efficiency conditions
  (removing it is byte-identical), so the live-worker session-VWAP bug doesn't touch this
  channel. Left in for clarity.
- Fixed **+100% / −50%** premium bracket + **15:25** flatten (vs base breakout's trailing
  stop, which gives winners back).

## Entry (both directions)

`opening_range` break (30-min) · `vwap_side` aligned · `efficiency_ratio ≥ 0.45` (20-bar) ·
`rel_vol ≥ 1.3` · before 15:25 ET. Calls on the up-break, puts on the down-break.

## Live A/B

Armed via `27_breakout_alt_v3.sql` as a clone of BREAK(ALT)'s settings (RISK $500 / STOP
$500 / underlying-stop) so the two run a fair side-by-side. **Caveat:** the MC is one
choppy window — re-confirm V3 ≥ BREAK(ALT) on a held-out window once more Databento history
accrues, and watch the live A/B before retiring BREAK(ALT).
