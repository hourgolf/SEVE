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
**+ 61_peak_trough_at (2026-07-02, worker -02a):** `peak_at`/`trough_at` timestamps stamp on every
new-extreme ratchet write (~10s granularity; seeded at entry) → time-to-MFE/MAE is one query.
Feeds the A6b ratchet probe and exit-timing analyses; instrumentation only, same rules as A7.
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
trade; the nightly job (v2, RE-ENTRY-AWARE) walks each (channel, day)'s signal stream
sequentially — reconstruct a trade at the first quote ask, replay the channel's OWN TP/stop
(TP-before-stop within a quote, the live sweep's ordering) to the 15:25 flatten, then take the
next signal AFTER that exit — capped 6 round trips/channel/day (daily-stop latch unmodeled) —
→ `virtual_trades` → the §03 LAB panel. This matches the backtest prior's one-at-a-time +
re-enter-when-flat semantics (engine/vb-fleet-probe.ts banks that prior: all 10 specs −EV
pooled on 308 sessions; watch-cells = or-fail's chop +$44/t and ribbon-cross's trend +$3/+9/t).
- **Rules (fixed now):** virtual data is CAPITAL-BLIND + mid/ask-basis → hypothesis substrate
  ONLY, never an arm. Graduation: virtual → paper-lab draft at A1 sizing → its own
  pre-registered gate. The MINING pass over this data waits for **≥2 months of accrual or a
  regime change** — the June lesson (one month, one regime → sign-flipping levers, twice).
- **Kill (per variant):** any vb-* with <10 first-of-day signals after 30 sessions is inert —
  delete or re-spec it; no threshold tinkering in between.

## A6b · NEAR-MISS metric (pre-registered 2026-07-02 — read WITH A6, not before)
**Metric:** near-miss rate = trades whose peak_mark reached ≥70% of the channel's TP level
(`peak ≥ entry·(1 + 0.7·tp/100)`, tp>0) but closed ≤ $0, per channel. Measurable from live
10s peak/trough stamps only (era-4 data; mid-basis label applies).
**Trigger:** evaluated at the A6 read (N≥40 trades/channel or 15 era-4 sessions). **Decision
rule fixed now:** a channel with near-miss rate ≥15% at N≥40 REOPENS the arm-high-ratchet
probe (the one surviving ratchet residue) on ITS live peak/trough paths — probe first, never
a live knob from the metric alone. Below 15% → the ratchet question stays closed for that
channel. Motivating observations (2026-07-02): IWM peaked +21.7% vs TP 22 → stop; the ORB
A/B green→reds are EXCLUDED (no-TP probe spec — their fade-back is design cost, not signal).

## C1 · Correlated-bet STACK CAP (pre-registered 2026-07-02 — enforcement PENDING operator go)
**Rule (fixed now):** block a NEW entry when ≥4 positions are already open desk-wide on the same
underlying+direction (the entry would be the 5th+). Entries-only; never forces exits; blocked
entries get `blocked_reason='stack_cap'` → gate-shadow scores their would-haves automatically.
**Evidence (23 sessions, retro depth replay):** P&L by stack depth at entry is near-monotonic —
depth 1–2: +$11/+$40 per trade (n=584); depth 3–4: ≈flat (n=197); depth ≥5: −$67→−$1,944/t
(n=99, Σ −$43.4k). ⚠ Depth correlates with the 06-26/29 clone-sizing era — the mechanism and
monotonicity survive the confound; the exact dollars do not.
**Kill criterion:** if capped entries' gate-shadow would-have P&L is net POSITIVE at N≥30
blocked (the cap is blocking winners), the cap dies. **SEQUENCING (operator's word,
2026-07-02): enforcement waits until AFTER the A6 read (~Jul 22)** — era-4 stays pristine;
arm C1 as the first post-A6 action alongside the runner decision. No era footnote needed.

## B2-CLOSURE · Chop-day short-premium — CLOSED (operator's word, 2026-07-02)
Operator: not interested in multi-leg for now — drawdown appetite. The A5→B2 chain is severed;
A5's pass path is the ride-family SIZE-DOWN only. The multi-leg compiler stays unbuilt. (The
vol-risk-premium finding stays on file if appetite changes; nothing else keeps this alive.)

## PINNED · Runner/scale-out experiment (operator's word, 2026-07-02 — "a real lever")
Operator-pinned as the lever straddling take-profit vs letting winners win: **TP half at the
LOCK target + ratchet the remainder, vs the standard all-out LOCK twin** (separate accounts,
A1 sizing, N≥40, pre-register before build). Build trigger unchanged: the A6 read (either
outcome informs it — LOCK failing its bar makes it urgent; LOCK passing scopes it to the
fat-near-miss channels via A6b). Requires multi-TRANCHE exit support in the worker (partial
exits currently close the row — touches the shared-OCC ledger; sized as a real build).
peak_at/trough_at (61) now stamp the exact data this experiment's design needs.

## Calibration-change log (era boundaries for the A6/month-end reads)
- **2026-07-02 (pre-open):** (A) QQQ V3 clones (`breakout-alt-v3-qqq`, `breakout-smart-entries-qqq`)
  RISK 900→500, mc 18→6, daily stop 2000→1000 — the A1 lab-sizing standard applied (they predated
  the rule; first live trade 07-01 cost −$1,708 at 14ct). Entries/TP/stop untouched.
- **2026-07-02 (pre-open):** (B) `grind-v3-2` take_profit_pct 12→5 — DTE-scaling calibration
  parity (its 0DTE twin's TP 10 ÷ the ~2.2× 1DTE premium ratio; the 12% target sat ABOVE its own
  p90 MFE and fired 0/42 times lifetime). ⚠ Its per-channel stats are a NEW ERA from 07-02 —
  evaluate pre/post separately; do not pool across the boundary.
Both reversible by restoring the prior values; both are rule-applications, not P&L-fitted tweaks.

## B2 · Chop-day short-premium (DEFERRED — chained behind A5)
No multi-leg compiler work unless A5 passes. Inherits A5's kill. Additional standing door-check:
if modeled limit-order body-spread capture can't flip the iron-fly replay ≥ +$25/day pooled,
don't build regardless of A5.
