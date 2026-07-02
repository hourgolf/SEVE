# Pre-registered tests & decision rules — July 2026 (phase-4, approved 2026-07-01)

Paper trading only. Every item below is a diagnostic or a hypothesis with a test plan —
**no profitability or edge claim is made or implied anywhere in this document.** The point of
this file is to fix thresholds and kill criteria BEFORE outcomes are visible, so month-end
decisions can't be threshold-shopped after the fact. Rules here are changed only by editing
this file BEFORE the evaluation window opens, never during it.

## A1 · Paper-lab sizing rule (standing process rule — ACTIVE)
Any newly-armed draft/clone runs at **RISK ≤ $500, max_contracts ≤ 6** until it passes its own
pre-registered gate. Enforced as the `duplicateChannel` clone default (hooks/useDeskWrite.ts);
manual SQL arms must follow it too. Context: the 06-26 clones inherited RISK $2,000 unvalidated
and owned the month's largest loss driver (−$26.6k / 20 trades).

## A2 · Cost-gate calibration (gate-shadow ledger — COLLECTING)
`npm run gate-shadow` (nightly via capture-forward) banks each cost_gate / stale_chain blocked
entry's would-have outcome (mid-basis UPPER BOUND) → `data/gate-shadow.json` + `gate-shadow:`
events.
- **Evaluation gate:** ≥30 scored blocks on the current roster.
- **Decision rule (fixed now):** if blocked setups' would-have expectancy is materially positive
  net of round-trip at n≥30 → run a K-sensitivity probe (offline) before any knob discussion.
  If flat/negative → K=6.0 stands, item closes.
- Never a live change from this ledger alone.

## A3 · IWM gap_min calibration parity — RUN 2026-07-01, CLOSED (premise refuted)
IWM's |gap| distribution is LARGER than SPY's (median 0.460% vs 0.277% full-archive;
P(|gap|≥0.25): IWM 72.9% vs SPY 54.4%; stable across 2026 YTD and Apr–Jun windows).
So gap_min=0.25 is *looser* on IWM, not tighter — parity would RAISE the threshold to ~0.40–0.42,
i.e. change a validated config in the wrong direction. Additionally, the IWM channels have
**zero signal rows** — entries never co-fired at all (selectivity upstream of every gate;
matches the 06-30 feat-diag "healthy + selective" verdict). **No threshold change. Closed.**
(Method: scratchpad iwm-gap-calibration over bars-archive, RTH first-open vs prior last-close,
SPY n=540d / IWM n=321d.)

## A4 · ORB stop-structure A/B (orb-ustop vs orb-ustop-ctl — LIVE, armed 2026-07-01)
56_orb_ustop_twins.sql. Identical probe-spec entries; control = policy −50% premium stop
(paper-main); variant = premium stop OFF + 0.30% underlying stop (Resurrected). Different
accounts by design (shared-OCC isolation). A1 sizing.
- **Run to N≥40 trades each.** No mid-test knob changes.
- **Kill (any one):** variant stop-out RATE > control's at N≥40 · variant expectancy < control's
  at N≥40 · any session where the u-stop provably fails to fire on a >0.30% adverse move
  (mechanical fault ⇒ immediate bench + audit).
- Success ≠ arming elsewhere; success = a follow-up proposal.

## A5 · Gamma-open implied move as ex-ante day-shape tag (WAITING — earliest ~mid-July)
Runs when ≥20 sessions of the 9:35 `gamma-open` shadow log exist (started 06-17).
- **Pre-fixed thresholds:** monotone ride-family P&L across impliedMove terciles AND ≥60%
  chop-tercile classification accuracy on the held-out half of sessions.
- **If passed:** propose a size-down (not stand-down) SHADOW on the ride family in
  predicted-chop; shadow-logged ≥1 month before any arm proposal.
- **Kill:** thresholds missed at N=20 → one re-check at N=40 → then closed permanently.
  No threshold adjustment between checks.

## A6 · Era-4 LOCK/RIDE evaluation (WAITING — trigger: N≥150 era-4 trades or 15 sessions)
Era 4 = trades opened ≥2026-06-30 (LOCK/RIDE + stop-aware sizing live).
Per LOCK channel at trigger: win% with 95% CI, green→red rate (peak≥+20% → close ≤0),
TP-harvest total vs stop total.
- **Decision rule (fixed now):** the +22/−30 pair implies a ≥58% win-rate bar before costs.
  A channel whose win% CI *upper* bound < 58% at its own N≥40 → flag for RIDE mode or bench.
  A channel above the bar with green→red ≈ 0 → LOCK stands. No mid-window knob changes.

## B1 · FOMC-resolution follow (fomc-follow — DRAFT, arm-per-event only)
57_fomc_follow_channel.sql. ⚠ The spec has no fomc_day vocab — it would fire any day in
14:30–14:45 with momentum. Operating procedure: **arm on FOMC mornings only, disarm after the
close.** Next event 2026-07-29; re-run `npm run fomc-resolution-probe` after each.
- **Graduation:** standing arm only at pooled n≥10 AND largest single day ≤50% of total P&L.
- **Kill:** expectancy ≤0 at n=10, or concentration never dissolves by n=12 → delete the channel.

## A7 · trough_mark MAE instrumentation (approved 2026-07-01 — COLLECTING from worker -e)
58_trough_mark.sql + worker stream-2026-07-01e: the fast sweep ratchets a durable running MIN
mark beside peak_mark (NEW-low-only, seeded at entry, restart-safe). MAE% = (entry−trough)/entry,
mid-basis (a LOWER bound on bid-side adverse excursion — label it). Instrumentation only; no
exit reads it. **Purpose:** makes stop calibration a measurable question (noise-stop rate vs
stop level per channel). **No stop change from this data before ~N≥100 stamped trades per
channel-family AND an offline replay agreeing** — same anti-shopping rule as the rest of this file.
The related flagged-but-not-approved items stay parked: grind-v3-2's unreachable TP (12% > its
p90 MFE, the 1DTE %-scaling misfit) and breakout(base)'s LOCK-22 vs its ride-verdict tail —
both deferred to the A6 era-4 read unless separately approved.

## A8 · Virtual bench fleet (approved 2026-07-01 — COLLECTING; §03 LAB panel)
59_virtual_bench_fleet.sql (10 mechanism-diverse `vb-*` DRAFTS: vwap-revert · rsi-revert ·
level-break · or-fail · macd-state · curl-reversal · squeeze-break · pm-trend · gap-drift ·
ribbon-cross) + 60_virtual_trades.sql + the gate-shadow extension: drafts signal but never
trade; the nightly job reconstructs each FIRST-signal-of-day's would-have outcome (entry ask →
own TP/stop → 15:25 flatten) from the quotes tape → `virtual_trades` → the §03 LAB panel.
- **Rules (fixed now):** virtual data is CAPITAL-BLIND + mid/ask-basis → hypothesis substrate
  ONLY, never an arm. Graduation: virtual → paper-lab draft at A1 sizing → its own
  pre-registered gate. The MINING pass over this data waits for **≥2 months of accrual or a
  regime change** — the June lesson (one month, one regime → sign-flipping levers, twice).
- **Kill (per variant):** any vb-* with <10 first-of-day signals after 30 sessions is inert —
  delete or re-spec it; no threshold tinkering in between.

## B2 · Chop-day short-premium (DEFERRED — chained behind A5)
No multi-leg compiler work unless A5 passes. Inherits A5's kill. Additional standing door-check:
if modeled limit-order body-spread capture can't flip the iron-fly replay ≥ +$25/day pooled,
don't build regardless of A5.
