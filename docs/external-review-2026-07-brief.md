# SEVE — external review brief (2026-07-11)

You are being asked to review a paper-trading system as **independent second eyes**. The builders
(one human operator + Claude models over ~5 weeks) want defects, methodological holes, and design
critique — **not validation**. Nothing here is privileged; it is all paper money and the request is
explicitly "be transparent, don't be defensive." Please be blunt. If something is bad, say it plainly
and say why.

## 1 · What this is

**SEVE** is a SPY/QQQ/IWM 0DTE-1DTE options paper-trading desk:
- **Dashboard** — Next.js App Router single page, plain CSS, styled as a Roland TR-909 (a deliberate
  aesthetic; a denser "PERFORM" operator mode is mid-build on main right now).
- **Live worker** — a TypeScript process on Railway, streaming Alpaca SIP/OPRA, running ~24 strategy
  "channels" (each a single-leg directional strategy) across **3 Alpaca paper accounts** used as
  lifecycle buckets: FIRST-TEAM (earners), LAB (experiments), MORGUE (known losers kept for data).
  Market orders, single-leg only. Entries gated per-channel (cost gate, gap gate, TP/stop config).
- **Backtest engine** — portable TS, real-NBBO fills from banked option quotes (Black-Scholes is
  banned by doctrine — measured −$37/trade BS vs +$393 real on identical trades).
- **Database** — Supabase Postgres (free tier, 0.5GB): positions/signals/quotes/bars/events.
  option_quotes prune at 7 days; a nightly job archives them verbatim to local disk first.
- **Ops** — nightly `capture` chain (exports, reconcile vs broker, forensics regen, shadow
  instruments, an LLM "sentinel" digest) + a pre-market brief, both via launchd **on the operator's
  personal Mac** (a known single-point-of-failure, listed below).

**How it got here matters for your review:** the entire system was designed and written by LLMs
(Claude) directed by one human operator. That means (a) high internal consistency, (b) the real
possibility of **monoculture blind spots** — conventions that look rigorous because the same model
family both wrote and reviewed them. You are the first non-Claude eyes on this. Assume nothing is
sacred.

## 2 · Honest state (as of 2026-07-11)

**P&L reality (paper):**
- FIRST-TEAM: $989,444 on $1,000,000 start (−$10.6k)
- LAB: $983,018 on $1,000,000 start (−$17.0k)
- MORGUE: $95,599 (the original account, ~$100k start; deliberately holds known losers for data)
- **All-time: ~−$30k across 1,082 logged trades.** The desk paid ~$30k paper tuition learning.
- **Era-4 (the current configuration, since 06-30): +$9.8k over 349 trades / 9 sessions.** This is
  the only era the operators consider evidential, and it is SHORT. A key review question is whether
  our era hygiene and sample sizes justify any of the confidence expressed in the docs.

**What we believe is validated (challenge each):**
- Real-fill backtesting matters enormously at 0DTE (BS ban).
- The desk's edge concentration: IWM/QQQ V3-ALT breakout legs and the pb-ride (pullback-trend)
  family; scalpers are cost-walled; most entry-signal "improvements" failed out-of-sample.
- Judging channels by **avg peak (MFE%) × win rate + giveback** ("harvest lens") rather than P&L.
- Gap MAGNITUDE (not direction) as a regime gate for breakout channels.

**What is hypothesis dressed in infrastructure (be hardest here):**
- The virtual bench (10 signal-only "vb-*" channels × 3 indices) — mid-basis, capital-blind.
- The stairstep/runner exit experiments (R1/R1b), the win-and-done gate (A15), the arm-high ratchet
  (A13, live A/B) — all in flight, none proven.
- The LLM "sentinel" (nightly scan + LLM judge digest) — grounded via a curated context doc, but the
  judge's outputs shape operator attention, and grounding drift is a real risk.

**Incident history (all real, all in the docs — pattern-match for the next one):**
1. Runaway re-buy at launch (silent INSERT failure → worker saw itself flat → re-bought every minute).
2. Shared-OCC booking bug over-reported +$5,060 (fixed via row-primary booking + full reconcile).
3. Silent Black-Scholes fallback under DB load quantized backtests to two P&Ls (fixed: fail-fast).
4. PostgREST ~1000-row silent truncation has now bitten **three separate times** (market data, the
   gate-shadow ledger, the P&L NAV curve). A `pageAll` helper is now "the law" — verify it's used.
5. A slot-aware analysis read hardcoded a start date that aged out of the 7-day quote window and
   failed silently every night for 2 days (fixed with clamping — but the failure mode generalizes).
6. A 25-finding adversarial audit of the trade path just completed (2026-07-10, worker
   `stream-2026-07-10b`): headliners included a wrong-account order-routing hole under transient
   config-read failure (now fail-closed), more 1000-row truncations, a reconcile drift gate keyed on
   the signed net (equal-and-opposite mis-books certified "clean"), and unquotable deep-ITM exits
   booked at $0. The fixes are in; the CLASS of bug is what you should hunt.

## 3 · Self-declared weaknesses — don't burn tokens rediscovering these; go deeper

1. **Sample sizes are small everywhere.** Most registry reads trigger at N≥15–40 trades. Era-4 is 9
   sessions. We know. The question is whether the decision discipline (pre-registered thresholds,
   kill criteria) adequately compensates, or whether it's rigor theater.
2. **Multiple comparisons.** ~30 vb bench variants, dozens of probes. We guard by pre-registering
   and by demanding 5-window out-of-sample survival, but the garden of forking paths is real.
3. **Mid-basis optimism** in all virtual/bench numbers (entry at ask, exit at mid; we net an exit
   half-spread estimate of $2–5/ct). Real fills routinely disappoint bench estimates.
4. **Capital-blind and slot-blind backtests.** The engine can't fully see the one-position-per-
   channel slot dynamics; several past "wins" evaporated when replayed slot-aware.
5. **The avg-peak (MFE) lens has a hindsight flavor.** Peaks are only observable post-hoc; picking
   TPs off observed peak distributions risks fitting exits to the sample. We think era discipline
   and forward A/Bs mitigate; challenge that.
6. **Window sensitivity.** The momo ratchet A/B shadow flipped verdict when the analysis window
   slid one week. We now label windows, but any conclusion below ~4 weeks of data is fragile.
7. **Single-operator discretion** is explicitly part of the system (roster moves, sizing, go-live
   are his calls, logged but not gated). This is a chosen philosophy, not an oversight — but it
   means the registry protects experiments, not the account.
8. **The fund-level master stop is NOT enforced in the worker** (only per-channel daily stops and a
   manual kill switch). Listed in the docs as dead; still true. Correlated gap-day risk across
   channels sharing strikes is real (measured worst stack: 3 channels / 54 contracts on one strike).
9. **Ops runs on one laptop.** launchd + pmset on the operator's Mac do the nightly capture; the 7-day
   quote retention means ~5 missed days = permanent data loss (a gap-check screams, but still).
10. **Free-tier Postgres (0.5GB)** forces aggressive retention and derived-data hygiene.
11. **LLM-in-the-loop risks:** the sentinel judge and autopsy narratives are LLM outputs consumed
    daily by the operator; the grounding doc is hand-curated and could drift from reality.
12. **The UI is large and recently churned** (a §04 redesign shipped yesterday; a PERFORM-mode
    overhaul is mid-flight on main). Expect seams.

## 4 · What we want from you (in priority order)

1. **Money-path defects.** `worker/src/decide.ts → execute.ts → store.ts` (+ `exitRules`,
   `routing`, `config`, and the cycle in `index.ts`). Hunt: partial fills, order-state races,
   restarts mid-position, DST/holiday/early-close edges, symbol/OCC parsing, fail-open defaults,
   silent catch blocks, retention-window assumptions, float/rounding in P&L. The 2026-07-10 audit
   fixed 25 findings; find what it missed.
2. **Statistical methodology.** Read `docs/pre-registered-tests-2026-07.md` (the registry — our
   whole decision discipline). Is it sound? Where is it self-deceiving? Is the harvest lens
   (peak × win) a legitimate evaluation axis or survivorship in disguise?
3. **Challenge the premise.** Is long single-leg 0DTE/1DTE with market orders viable at all net of
   spread, long-run? The cost model says the spread is the tax (~$12–15/ct round trip on QQQ/IWM);
   argue the other side with our own numbers if you can.
4. **Risk architecture.** What is unbounded today? Rank the top 5 ways this desk (if it were real
   money) loses more in a day than the operator expects.
5. **System architecture.** The data seam (hooks own reads, components dumb), the 3-account bucket
   design, Supabase/Railway/launchd split, secrets handling, the 7-day quote retention with local
   archive. What breaks first at 10× scale or with real money?
6. **UX / information design.** The dashboard aims for "one number + one picture per panel, words
   behind expand." Critique the §04 room and the P&L panel implementation you'll see in the bundle.
7. **Kill list.** If you could delete or rebuild five things, what and why?

**Response format requested:** (a) findings table — severity / file:line / claim / suggested fix,
CONFIRMED vs SPECULATIVE flagged honestly; (b) methodology critique in prose; (c) premise challenge;
(d) top-5 kill list; (e) anything you'd want to see next (we'll send more files on request).

## 5 · What's in the bundle / what's deliberately omitted

The companion file (`CODE-BUNDLE.md`, generated from commit stamped in its header) contains, in
full: `CLAUDE.md` (project memory — read first, it's also the honest history), the experiment
registry, the worker money path (decide/execute/store/exitRules/routing/config/index +
runner-selftest), engine core (pageAll/cost/specEvaluate/registry), the ops spine
(capture-forward/sentinel), schema SQL, three focused specs (go-live, concentration allocator,
sentinel grounding), a real sentinel digest sample, and forensics sample rows.

**Omitted to save your context** (ask and we'll provide): the React UI components (~8k lines;
representative patterns visible via the P&L hook include), `alpaca.ts` (thin REST wrapper),
`stream.ts` (websocket plumbing), the analysis instruments (`one-account-shadow`, `ratchet-shadow`,
`stairstep-shadow`, `desk-briefing` — described in the registry), migrations 03–67, and the mobile
shell. Omission ≠ confidence — flag anything whose absence blocks a judgment.
