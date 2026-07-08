# Pre-registered tests & decision rules — July 2026 (phase-4, approved 2026-07-01)

> **GO-LIVE (reframed 2026-07-06, operator's word): capital on/off is the OPERATOR'S
> DISCRETIONARY call — no binding gate.** `docs/go-live-gate.md` is an ADVISORY readiness
> checklist only. The registry's rigidity governs experiments/measurements, never his
> capital-allocation comfort. Do not propose binding gates on go-live/sizing decisions.
> **A6 AUTOPILOT (live 2026-07-05): `npm run a6-watch`** runs nightly in the capture chain —
> T-1 heads-up push, and at the 15-session trigger auto-generates the decision memo (the full
> a6-read + pre-filled SQL for C1/A9/A10/R1 + LOCK verdicts) to `docs/a6-decision-memo-<date>.md`.
> It decides nothing; every block waits for the operator's word.

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

## A6 · Era-4 LOCK/RIDE evaluation (WAITING — trigger: 15 era-4 sessions; per-channel verdicts at own N≥40)
**TRIGGER AMENDED 2026-07-03 (operator-approved, BEFORE the window opened — legal per the header rule):**
was "N≥150 era-4 trades or 15 sessions"; the trade-count leg hit 147 in just THREE sessions (ride/grind
churn runs ~5× the ~10/day the estimate assumed) and would have fired the read 07-06 with ZERO
verdict-grade channels (best per-channel era-4 N = pb-ride-2 at 19; V3/ALT/MOMO at 0) while prematurely
unlocking C1 enforcement. New trigger: **15 era-4 sessions (~2026-07-21); a channel gets its verdict only
at its own N≥40** — a channel short of N≥40 at the read gets a deferred read when it arrives. C1 stays
sequenced behind this read. No other A6 rule changed.
Era 4 = trades opened ≥2026-06-30 (LOCK/RIDE + stop-aware sizing live).
Per LOCK channel at trigger: win% with 95% CI, green→red rate (peak≥+20% → close ≤0),
TP-harvest total vs stop total.
- **Decision rule — BAR AMENDED 2026-07-03 (pre-trigger, operator-approved):** the bar is each
  channel's OWN breakeven win rate = stop/(tp+stop) before costs — the same arithmetic that
  produced 58% for the +22/−30 pair, applied to the channel's actual pair. (The LOCK roster spans
  breakevens 58%→89% — e.g. grind-v3-2 at TP 5/stop 50 needs 89% — so the original flat 58% gave
  false passes to high-bar channels; `npm run a6-read` exposed this on its first progress run.)
  Rule otherwise unchanged: a channel whose win% CI *upper* bound < its own bar at its own N≥40 →
  flag for RIDE mode or bench. CI *lower* ≥ its bar with green→red ≈ 0 → LOCK stands. No
  mid-window knob changes. The read is mechanized in `scripts/a6-read.ts`.

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

## A9 · gap_min on breakout(base) (pre-registered 2026-07-03 — DARK BUILD DEPLOYED, decision at A6)
Base is the one breakout-family member without the validated overnight-gap gate (gap_min 0.25,
5/5-window gap-regime verdict, armed on the V3/ALT specs since 06-11). Base's own lifetime split
(entry_features.gap, n=46, 100% stamped): **gap-days (|gap|≥0.25) +$2,322 / +$97/t / 63% win /
49% avg MFE vs flat-open −$881 / −$40/t / 36% / 20%** — live out-of-sample AGREEMENT with a
pre-validated verdict (confirmation, not mining; distinguishes this from the sign-flipping
awareness levers).
- **Reading rule (fixed now):** base's A6 LOCK evaluation is computed ON the gap/flat split
  (|entry_features.gap| ≥/< 0.25) — so the gate question can't confound the LOCK question, and
  base can't fail its 58% bar on trades the pending gate would have excluded.
- **Decision rule (fixed now):** if era-4 flat-open expectancy < 0 at n≥15 AND era-4 gap-day
  expectancy ≥ 0 (the lifetime pattern reproducing) → the gate is validated for base. The A6
  action is then ONE roster decision — arm gap_min 0.25 on base, OR consolidate the SPY gap-day
  slot (base vs V3 vs ALT: three channels firing the same gap mornings, and cross-index says SPY
  is the marginal index for this edge) — taken alongside C1 + the runner decision.
- **Kill:** era-4 flat-open expectancy ≥ 0 at n≥15 → base keeps trading ungated; item closes.
- **Mechanism (DARK-BUILT 2026-07-03, `62_gap_min_knob.sql` + worker `stream-2026-07-03a`):**
  per-channel `strategist_config.gap_min` — 0 = off for ALL channels (byte-identical), >0 =
  entry blocked `gap_min` when the worker's |gap| < knob, FAIL-CLOSED on uncomputable gap
  (mirrors the spec condition). Arming at A6 = a config flip, no deploy. Blocked entries stamp
  signals → gate-shadow (A2) scores their would-haves automatically.

## A10 · Ride-family gate (pre-registered 2026-07-03 — rides previously had NO gate at all)
Covers armed tp=0 channels (today: momo-shape, qqq-thrust-trail, orb-qqq-trail; orb-ustop/-ctl
excluded — A4 owns them). A6 evaluates LOCK channels only, which left the rides — including the
desk's largest single bet (momo-shape, RISK $1,800 on 23 lifetime trades) — with no pre-registered
evaluation or sizing review. Read at the A6 trigger (15 era-4 sessions), then at each month-end
until each channel reaches its own N≥40 (rides accrue slowly — deferred reads expected).
- **Expectancy rule (fixed now):** era-4 expectancy ≤ $0 at own N≥40 → flag for bench or
  LOCK-conversion review.
- **MFE-capture rule (fixed now):** capture = Σ realized ÷ Σ peak-potential (peak_mark basis,
  mid-label; potential = max(0, (peak−entry)·100·qty)) < 25% at own N≥40 → the ride is
  finding-and-surrendering → reopen the ratchet/LOCK question for that channel (the
  giveback-takeprofit mechanics).
- **Unvalidated-size rule (fixed now — the A1 principle applied to rides):** at the FIRST A10 read,
  a ride WITHOUT a passing expectancy verdict carries max RISK $1,000; any ride above that is
  resized down as a logged rule-application (today that is momo-shape at $1,800). Passing the gate
  → sizing back up is a normal operator call. Prevents evidence-inverted sizing (size ∝ recency,
  not validation) from persisting unexamined.
- **Pass:** expectancy > 0 AND capture ≥ 25% at own N≥40 → ride config + size stand; the item
  recurs monthly as N accrues.

## A11 · Counter-trend-side gate on the ride family (pre-registered 2026-07-06 — OFFLINE PROBE ONLY)
Motivated by an n=1 (2026-07-06 PM: five counter-trend puts fired mid-uptrend, −$2,922 — the day's
whole loss) — DISCLOSED as such; the probe corpus (5 windows, NBBO ends 2026-06-01) excludes that day
entirely. Hypothesis: on the ride family, entries whose DIRECTION opposes the intraday trend state
(`trend_align` ribbon, EMA9-vs-EMA21 — existing armable vocab) are the loss engine; gating ONLY the
counter-trend side improves per-trade expectancy re-entry-aware (a gated entry frees the slot).
- **Design (fixed before any result):** channels momo-shape (live spec, 0DTE, ride/−50) and pb-ride
  (registry builtin, 1DTE, live +14/−30); faithful harness (lever-shared: RISK/gate/1-tick, real
  NBBO); treatment **B** = block entries opposing the ribbon; control **C** = block entries ALIGNED
  with the ribbon (the anti-mechanical check — if "fewer trades" is the whole effect, C improves too).
- **PASS requires ALL FOUR:** (1) B pooled exp/t > baseline A per channel; (2) B non-degrading in
  ≥4/5 windows; (3) B's pooled improvement survives dropping A's best window; (4) C's improvement
  < half of B's (else the effect is mechanical thinning, not signal).
- **On PASS:** NOT armable from this — next step is a forward item at/after the A6 read (stamped
  shadow split or paper twins). **On FAIL:** closed and banked; don't re-litigate without new data.

## A12 · Counter-DAY-trend gate, OPEN-anchored (pre-registered 2026-07-06 — the A11 residue, OFFLINE PROBE ONLY)
A11 failed and named its residue: the ribbon is too FAST a clock (pb-ride's entries are ribbon-aligned
by construction — 0 gate fires; the 07-06 killer puts were with-ribbon at entry because the pullback
had flipped it). A12 tests the SLOW anchor: day trend = sign(close − session open). Constants FIXED
now, not tuned: neutral deadband |close−open| < 0.05% of open (never blocks), gate inert before
minute 30 (no established day trend inside the opening range).
- **Design:** identical to A11 in every other respect — same channels (momo-shape live spec 0DTE
  ride/−50; pb-ride builtin 1DTE +14/−30), same faithful re-entry-aware harness, same 5 windows,
  same B (block counter-day-anchor side) vs C control (block aligned side).
- **PASS/kill: the same four gates as A11**, verbatim. On PASS → forward item at/after A6, not
  armable from this. On FAIL → the counter-trend thread is CLOSED at two anchors; no third variant
  without genuinely new evidence (anti-anchor-shopping rule: two anchors is the budget).

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

## R1 · Runner/scale-out A/B (pre-registered 2026-07-05 — mechanism DARK-BUILT, experiment configured at A6)
The PINNED lever's execution plan, registered before any era-4 LOCK outcome is readable.
- **Mechanism (worker `stream-2026-07-05b` + 64_runner_tranche.sql — DARK, both knobs 0):**
  per-channel `runner_frac` (fraction retained at the take-profit) + `runner_giveback_pct`
  (the remainder's peak ratchet: exit when mark ≤ peak×(1−pct/100)). SPLIT-ROW design: the
  parent row closes on the banked qty (`target_tranche`), the remainder becomes a NEW row
  (`runner_of` = parent, same entry basis + opened_at, carried peak/trough) that skips all
  take-profit checks and exits via `runner_ratchet` / stop / stall / EOD. Preserves the
  row-primary invariant (each row books once, full share, status-guarded); an insert-failure
  remainder is deliberately the ORPHAN class (sweep pages it). Hermetic selftest in CI
  (worker/src/runner-selftest.ts, 23 checks). **Adversarially reviewed pre-deploy** (14-agent
  panel, 6 confirmed findings fixed, 1 refuted): tranche only on a whole undrained share
  (sellQty===row.qty, drained lots → the proven all-out path); deterministic per-row tranche
  coid + late-fill recovery (idempotent retry); reconcileExitPx excludes tranche sells (a
  runner can never "reconcile" at its parent's TP price); runner peak floored at the tranche
  fill (ratchet always armed); sweep peak/trough maps rekeyed by row id (kills a pre-existing
  same-day-re-entry staleness the ratchet would have amplified).
- **Experiment (configured at the A6 read, not before):** per PINNED — runner twin
  (runner_frac 0.5 + a giveback chosen from the A6b near-miss data) vs the standard all-out
  LOCK twin; SEPARATE accounts (lot isolation), A1 sizing, N≥40 each. Kill: runner twin's
  expectancy < the all-out twin's at N≥40 → knobs back to 0, mechanism stays for a future
  channel. Pass: runner ≥ all-out at N≥40 → propose promotion to the live channel.
- **No channel may run runner_frac > 0 before the A6 read** (same era-4-purity rule as C1).

## PINNED · Runner/scale-out experiment (operator's word, 2026-07-02 — "a real lever")
Operator-pinned as the lever straddling take-profit vs letting winners win: **TP half at the
LOCK target + ratchet the remainder, vs the standard all-out LOCK twin** (separate accounts,
A1 sizing, N≥40, pre-register before build). Build trigger unchanged: the A6 read (either
outcome informs it — LOCK failing its bar makes it urgent; LOCK passing scopes it to the
fat-near-miss channels via A6b). Requires multi-TRANCHE exit support in the worker (partial
exits currently close the row — touches the shared-OCC ledger; sized as a real build).
peak_at/trough_at (61) now stamp the exact data this experiment's design needs.

## Instrumentation log (log-only additions — never gates; A7-style rules apply)
- **2026-07-05 (holiday weekend, worker `stream-2026-07-05a`):** (i) **eventDay day-tags** — CPI/NFP/
  OPEX/FOMC labels stamp `entry_features.eventDay` (engine/market-events `dayTags`; CPI/NFP dates
  BLS-verified, OPEX computed 3rd-Friday). LOG-ONLY: enables the catalyst-vs-newsless-gap forensics
  split; no stand-down semantics added or changed. (ii) **iv-bank** — nightly dealer-positioning
  snapshot from the desk's own feed (OI × gamma GEX proxy + ATM IV, SPY/QQQ/IWM → data/iv-bank/,
  capture-forward tier 2). Starts the IV-rank clock; this is the named "new FEATURE" the
  conviction-sizing closure requires before that thread may reopen — reopening still requires its
  own pre-registered item at ≥2 months of accrual. (iii) **C1 mechanism DARK-BUILT** (64_stack_cap.sql,
  `fund_state.stack_cap_n`=0 desk-wide): arming remains sequenced post-A6, now a config flip.
  (iv) **A8 fleet expanded cross-index** (63_vb_cross_index.sql): the 10 vb-* specs cloned to QQQ +
  IWM (drafts, signal-only). Same A8 rules per variant; clocks start at first session 2026-07-06;
  inert-kill applies per clone. **Priors BANKED pre-forward** (vb-fleet-probe --underlying, docs/
  vb-fleet-prior-{qqq,iwm}-2026-07-05.txt): ALL 10 specs −EV pooled on BOTH indices (IWM 310
  sessions full 5-window; QQQ 70 sessions 2026-only, un-OOS-able) — unlike SPY, no watch-cells
  (SPY's or-fail-chop / ribbon-cross-trend cells do NOT reproduce cross-index). Forward-vs-prior
  divergence is the only readable signal; macd-state is worst-or-near-worst on all three indices. (v) **weekly rituals scheduled** — mfe-drift + override-scorecard now
  run Fridays inside capture-forward (were memory-dependent); nightly evening-digest push + off-site
  archive backup (data-archive branch) added to the same chain.
- **2026-07-08 (post-entry-window, mid-session):** (vi) **ratchet-shadow — the A4 twins' virtual
  third arm** (`npm run ratchet-shadow`, nightly in the capture close pass → data/ratchet-shadow.json).
  Replays each CLOSED twin trade's real option_quotes mid path under a FIXED arm-high ratchet:
  pre-arm policy −50% premium stop · arm at +50% · once armed exit at entry + (peak−entry)×⅔
  (keep two-thirds of the peak gain, ratcheting) · else flatten at the session's last quote.
  **Params fixed BEFORE any results were computed** (the pattern-fanout residue; do not tune
  post-hoc). Purpose: the A4 read gets a three-way comparison (prem-stop vs u-stop vs ratchet)
  on identical trades. LOG-ONLY, never a gate; per-trade counterfactual with the slot-path caveat
  stated in-file (a live ratchet frees the one-at-a-time slot differently — the +75%-cap churn
  lesson); A4's own two arms and read criteria are unchanged. **v2 (same day):** sample extended
  to the predecessor spec's June trades (orb-trend-rider, epoch-labeled — its actuals were lived
  under the cap/trail-era policy, so epochs don't pool as one baseline) with pruned days replayed
  from the verbatim quotes archive; summary published into the forensics payload → the §03
  Shadow & Override panel (beside the pyramid shadow). Same fixed params, unchanged.

## Calibration-change log (era boundaries for the A6/month-end reads)
- **2026-07-02 (pre-open):** (A) QQQ V3 clones (`breakout-alt-v3-qqq`, `breakout-smart-entries-qqq`)
  RISK 900→500, mc 18→6, daily stop 2000→1000 — the A1 lab-sizing standard applied (they predated
  the rule; first live trade 07-01 cost −$1,708 at 14ct). Entries/TP/stop untouched.
- **2026-07-02 (pre-open):** (B) `grind-v3-2` take_profit_pct 12→5 — DTE-scaling calibration
  parity (its 0DTE twin's TP 10 ÷ the ~2.2× 1DTE premium ratio; the 12% target sat ABOVE its own
  p90 MFE and fired 0/42 times lifetime). ⚠ Its per-channel stats are a NEW ERA from 07-02 —
  evaluate pre/post separately; do not pool across the boundary.
Both reversible by restoring the prior values; both are rule-applications, not P&L-fitted tweaks.
- **2026-07-03 (holiday weekend, desk flat):** (C) the six BENCHED SPY clones (`breakout-alt-v3-ctl/-er40/-itm`,
  `breakout-smart-entries-ctl/-er40/-itm`) RISK 2000→500, mc 12/10→6, daily stop 2000→1000 — the A1 retrofit
  applied while dark (mirrors the 07-02 QQQ-clone precedent; these six predated A1 and owned the −$26.6k
  June driver). Zero live effect (status=draft); a future re-arm now starts at lab sizing by default.
  Entries/TP/stop untouched.
- **2026-07-03 (same session):** accounts re-bucketed to lifecycle (FIRST-TEAM/LAB/MORGUE, 7 channels moved,
  no knob changes) — noted here because per-account rollups re-label retroactively; per-bucket reads that
  span 07-03 should use the strategist join, not the account, as the stable key.
- **2026-07-03 (same session):** (D) the six BENCHED SPY clones' exits re-synced to the live pair's LOCK:
  take_profit 0→22, premium_stop null(−50)→30. Rationale: the clones ran tp=0 ride-to-−50 during 06-25→29 —
  their trades peaked +22..+41% MFE (er40 4/4 reached +22) and surrendered everything to full stops (22
  stop_premium closes, −$43.3k family-wide); ctl was also no longer a valid control for the LOCK-configured
  live pair. Zero live effect (status=draft). A re-arm now restarts at A1 size + LOCK exits.
- **2026-07-07 (post-close):** (E) `breakout-qqq` MUTED (operator's discretionary roster call, config
  untouched). Era-4 forward record −$1,765 over 21t (−$84/t) on a MORGUE known-loser kept only for data —
  the data tax judged no longer worth the bleed. No registered test reads it (A4 owns the orb-ustop pair
  only); montecarlo already ruled the backtest can't rank it, so the 21t forward sample is the verdict
  input, now frozen. ⚠ Its era-4 accrual STOPS at 21t — an A6-style read on it stays deferred unless
  re-unmuted. Reversible via the MUTE pad.
- **2026-07-07 (post-close):** (F) QQQ V3/ALT ports (`breakout-alt-v3-qqq`, `breakout-smart-entries-qqq`)
  RISK 500→250 (operator's discretionary sizing; entries/TP/stop untouched — NOT the A1 rule, a
  tuition-halving on a thin sample). Rationale: −$2,140 combined on FOUR era-4 trades contradicts the
  +$111/t cross-index backtest — exactly the forward-validation question the ports exist to answer, so
  they stay ARMED with the verdict clock running at half cost. ⚠ Per-trade DOLLAR stats blend across
  07-07 — pool per-contract/rate metrics only, or split eras at this boundary. Reversible by restoring 500.
- **2026-07-08 (mid-session ~13:00–13:20 ET, operator's discretionary calls; logged post-close):**
  (G) `momo-shape` RISK 1800→1200 + max_contracts ≥24→12 (24-lot fills printed that morning; now
  capped at its twin's 12). A discretionary two-thirds step toward the REGISTERED A10 rule
  ($1,800→$1,000 unvalidated-size at the A6 read) — A10 still adjudicates the remainder at the read;
  this entry does NOT retire it. Post-close true-up (operator-confirmed): daily_stop 4500→3000,
  restoring the 2.5×RISK convention the RISK cut had loosened to 3.75×. ⚠ Per-trade DOLLAR stats
  split at the 07-08 intra-session boundary (morning trades ran 2× size); rate/per-contract metrics
  pool. Reversible (1800/24/4500).
- **2026-07-08 (after 11:27 ET):** (H) QQQ V3/ALT ports (`breakout-alt-v3-qqq`,
  `breakout-smart-entries-qqq`) MUTED — supersedes (F)'s armed-at-half-tuition posture. Trigger: their
  first trades since (F) sized correctly at $250 (3ct, the resize verified live) and both stopped out
  (−$221/−$261); era-4 book −$2,622 over 6 trades. ⚠ Accrual STOPS at N=6 — the cross-index QQQ-port
  question stays formally OPEN (thin sample, not a refutation); the backtest-vs-forward contradiction
  is unresolved evidence, not a verdict. Reversible via the MUTE pads; config (RISK 250, TP/stop)
  preserved for a clean re-arm.

## B2 · Chop-day short-premium (DEFERRED — chained behind A5)
No multi-leg compiler work unless A5 passes. Inherits A5's kill. Additional standing door-check:
if modeled limit-order body-spread capture can't flip the iron-fly replay ≥ +$25/day pooled,
don't build regardless of A5.
