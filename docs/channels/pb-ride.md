# PB RIDER — pullback-continuation @ 1DTE (paper-lab draft)

**Status: DRAFT (2026-06-12) — visible, trades nothing. Arm = `update strategists
set status='armed' where slug='pb-ride';` (operator's word; small-validation
knobs already set: RISK $150 · STOP $300/day · 4-contract ceiling).**

## Thesis

In an established intraday trend (EMA9/21 ribbon stacked), price retraces to the
band, tags it, and resumes. Enter WITH the trend on the bounce bar — buy the dip,
not the stretch — and ride with the catastrophic −50% premium stop to a 15:25
flatten. **On 1DTE contracts: the edge IS the time value.** The same entries on
0DTE died at a 67% premium-stop rate (gamma stopped the bounce before it could
develop); 1DTE drops the stop rate to 30% and the shape goes +EV.

## Lineage (the full audit trail)

1. Born as the generative residue of the **ema-stretch refutation** (the
   operator's band-respect chart-read, 2026-06-12).
2. **Killed at 0DTE** (`ema-pullback-probe`): single-window mirage + 67% stop rate.
3. **Resurrected at 1DTE** (`one-dte-probe`, the operator's walk-thought):
   **+$4,632 pooled · +18.5/trade · 42% win · positive 4/5 regime windows**
   (only TREND-OOS MA25 red, −$1,471). Pre-registered inclusion, not shopping.
4. **Port golden-proven** (`pb-selftest`): the registry builtin is trade-identical
   to the winning probe evaluator (250 trades, $4,632, exact).

## Mechanics

- Entries 10:00–14:00 ET (the family-wide 14:xx finding); ribbon stacked with the
  trade; a ≥2·ATR stretch vs EMA21 within the last 30 bars; prior bar within
  0.5·ATR of the band; bounce = with-trend momentum close. No volume condition
  (volume confirms SUBTRACT at 1-min — the cross-candidate fingerprint).
- Exits: 15:25-ish flatten + the worker's catastrophic −50% premium stop. No
  target, no trail (ride family).
- **`entry_dte = 1` is LOAD-BEARING** (strategist_config): always buys the next
  session's expiry; the same-day flatten still closes it today. Never arm with
  entry_dte=0 — that variant is refuted.
- Cost gate, event stand-down, gap-blind (no gap_min — 4/5 windows without it;
  a gap-gated variant is an untested future iteration).

## Honest sizing of the edge

+18.5/t is DIVERSIFIER-grade (V3 as-armed prints +275/t). Its value, if live
receipts confirm: a second uncorrelated entry shape (pullback vs breakout) on a
different instrument profile (1DTE). The arm bar is the house standard — this
draft is the paper-lab nursery step, not a promotion.
