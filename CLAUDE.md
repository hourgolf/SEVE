# SEVE — project memory / session handoff

SEVE is a SPY 0DTE/1DTE paper-trading "desk": a Next.js dashboard over a Supabase
Postgres DB, a backtest engine, and a live paper-trading worker. This file is the
durable context for a new session. Read it first.

- **Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE
- **Supabase project ref:** `xvdfsxwwedltvdktqdac` (free tier — mind the 0.5 GB cap).
- Deploys auto on `git push` to `main` (Vercel; SSH deploy key already configured).

> ⚠ CLAUDE.md handoffs lapsed 06-19→06-24 — the 06-22 (nakamoto vocab) + 06-23 (cockpit/doctrine) work
> lives in **memory/** (read `desk-doctrine.md` FIRST, then `cockpit-p3-multi-account.md`,
> `doctrine-drift-and-forward-validation.md`). The block below re-anchors the convention.

## ⚡ SESSION UPDATE — 2026-07-10 EVE · FABLE WEEKEND MISSION 1 (READ FIRST)

**Trade-path audit DONE.** 7-finder adversarial fan-out → 25 CONFIRMED findings, ALL fixed
(`f83ea2f`→`8673074`); **worker `stream-2026-07-10b` deployed + heartbeat/boot-verified**. Headliners:
a CRITICAL wrong-account routing hole (transient `accounts` read failure → every channel traded via the
DEFAULT account's keys while real lots rode unmanaged — now fail-closed two ways, selftest-covered in
`worker/src/routing.ts`); the 1000-row truncation class in SIX more readers incl. **a6-watch** (the A6
autopilot was counting era-4 sessions on a capped read) — **`engine/pageAll.ts` is now THE law** for any
possibly->1000-row fetch (+ `.order(id)` tiebreak); reconcile's drift gate keyed on the SIGNED net
(equal-and-opposite mis-books certified "clean" — now Σ|per-OCC Δ|); backtest booked unquotable deep-ITM
exits at $0 (phantom −100% on the biggest winners feeding promote reads — now defer + `:intrinsic` tag);
the quotes archive got its first golden check (`npm run verify-quotes-archive`, 7/7 days tie 100%).
Fail-closed law: daily stop/target gate now blocks (`daily_gate_unreadable`) instead of failing open;
FOMC window got its wall-clock flatten twin. `npm run runner-selftest` = 41 checks, the pre-deploy gate.
Deferred residue in memory/trade-path-audit-2026-07-10.md. **Next: Mission 2 (PERFORM-mode mocks).**

## SESSION UPDATE — 2026-07-10 (supersedes 07-08 below where they conflict)

**Worker `stream-2026-07-10a`** (adds `daily_target_usd` win-and-done + skips is_active=false channels —
the grind tape-spam fix). **Books/data clean.** **NEXT SESSION = the FABLE WEEKEND** — read
memory/fable-weekend-plan.md FIRST (agreed missions: trade-path audit → PERFORM-mode UI → sentinel
analyst v2; mock-first for all UI — the operator approves mocks before builds, the §04 pattern).

- **⭐ §04 TAPE v2 SHIPPED (mock-first, operator-approved):** 5 glance panels — P&L (hero number +
  diverging channel bars + **windowed pk·win columns** from peak_mark; era-4 lens in the tooltip),
  Autopsy (DAY⇄WEEK merged), Shadow Book (row-per-instrument + expand breakdowns; Lab MERGED in — VB
  rows show **avg $/ct**, the Σ-labeled-as-/ct mislabel misled a promote call and is fixed), Brief
  (arm-band strip), Sentinel (verdict chip first, scan behind expand). **SENT chip on the §01 chart**
  draws the brief's PER-INDEX ladders (γ-walls amber / PD·swing grey / gap-arm green;
  `brief.sentLevels` = SPY+QQQ+IWM, each from its own bars — `rth()` was SPY-hardcoded, fixed).
- **Sentinel = a full loop:** nightly + pre-market (launchd `com.seve.morning` 06:00 PT; `pmset` wake
  05:55 weekdays) → ONE artifact (forward brief + backward scan + LLM judge verdict) → events →
  §04 panels; **drift baselines** (diff vs prior session snapshot) + **shadow-first paging**
  (`SENTINEL_PAGE=1` flips live after ~2wk of graded WOULD-PAGE logs); per-channel **lens map**
  (era-4 pk/win) published in meta for the P&L tooltips.
- **Registry:** **A14 armed** (vb-ribbon-cross SPY ITM+1 · vb-squeeze-break-qqq QQQ ATM — first
  sentinel-sourced promotes; kill = revert at N≥15 real net<0). **A15 armed** (win-and-done gate live;
  `qqq-thrust-trail-wd` MORGUE twin @ target $250). **A16 armed 07-10** (vb-curl-reversal TP-fix probe
  tp 20→15; corrected basis net −$1.2/ct recorded pre-arm). **R1b registered + BUILT**
  (`npm run stairstep-shadow`, nightly in capture — 3 arms LOCK/runner/stairstep on identical as-lived
  sequences; reads behind R1 at A6). **Concentration-allocator spec**
  (docs/concentration-allocator-spec.md) + **cap-scenario grid live nightly** in one-account-shadow
  (grade ~2wk → operator picks caps → DARK worker build post-A6).
- **Fixes w/ lessons:** the slot-aware ratchet read was silently DEAD since ~07-08 (hardcoded `--from
  2026-07-01` aged out of the 7d quote window → engine fail-fasted nightly; now trailing-window
  clamped. Fresh read: A4 ratchet still LOSES; **momo ratchet now TRAILS ride** on this window —
  window-sensitive, A13 live A/B is the arbiter). useWindowedPnl hit the **PostgREST ~1000-row cap**
  (`.limit(6000)` silently truncated → Week==Month identical curves; now paginated + an honest
  "NAV since <date>" label — per-account NAV history starts 06-24). **Pagination has bitten twice —
  every possibly->1000-row fetch must paginate + verify.**
- **54ct is NOT an Alpaca cap** — it's our own measured worst per-OCC stack (3ch/54ct, 07-02). Broker
  limits don't bind at desk size; concentration is the self-imposed risk cap the allocator will manage.
- **Promote playbook settled:** promote = status flip in LAB at A1 size + a registry entry with the
  standard kill; disarm→draft returns the channel to VIRTUAL tracking (nothing lost); MUTE = soft off;
  strike lanes = measurement hygiene, not hard walls (row-primary booking keeps shared-OCC books clean).
  LAB's IWM lane is EMPTY (no vb candidate clears); the sentinel pages when one does.

## SESSION UPDATE — 2026-07-08 (superseded above where it conflicts)

**Worker was `stream-2026-07-08a`.** **Books/data clean.**

- **Data integrity (all fixed this session):** the quote-fetch two-state flicker (statement-timeout → silent
  Black-Scholes) is FIXED — engine `--options quotes|real` now retries pages 4× + verifies row counts +
  fail-fasts, no silent fallback ([[quote-fetch-two-state-flicker]]); `idx_oq_keyset` applied
  (2,368→3ms). gate-shadow's blocked-signal fetch was silently 1000-row-truncated (froze virtual_trades/
  LAB) → now paginated+count-verified. **Lesson: any signals/quotes fetch must paginate + count-verify.**
- **Capture retimed to a CLOSE PASS** (launchd 13:03 PT): today's day-report + gate-shadow run FIRST →
  §03 totals land ~16:05 ET beside the autopsy; §03 panels now self-refresh (`useRefreshTick`). Safe post-
  flicker-fix. [[data-capture-automation]]
- **Instrument suite BUILT (all shadow/log-only, nightly):** ⭐ **one-account shadow** (dream-team through ONE
  cash pool — `npm run one-account-shadow`; +rescale/maxDD/`--hands-off`/`--cross-audit`/`--target-sweep`;
  §03 dream-team section) — first read: CONCENTRATION not buying power is the constraint; hands-off keeps
  ~57%+ of the edge (machine ≫ manual) [[one-account-shadow]]. **ratchet shadow** (`npm run ratchet-shadow`
  [`--slot`]) — per-trade OVERSTATES; slot-aware is ground truth: A4 ratchet LOSES (churn), **momo ratchet
  WINS +$416** (churn cleared); §03 panel leads with slot-aware, per-trade demoted [[orb-tightening-runway]].
  **docs/go-live-infra.md** blueprint (item-0 cross-audit DONE: self-cross 0, coalescing ~$287 → item-1
  deferred; allocator/master-stop/reliability sequenced).
- **Roster/registry (calibration log E–I):** breakout-qqq MUTED (E); QQQ V3/ALT ports RISK 500→250 (F)→
  MUTED (H, N=6, cross-index QQQ question OPEN not refuted); momo-shape RISK 1800→1200/mc12 + daily-stop
  3000 (G, discretionary partial toward A10). ⭐ **A13 ARMED (I): momo-shape now runs the arm-high giveback
  ratchet LIVE** (arm+50%/keep-⅔, per-channel `GIVEBACK_TRAIL` map in worker/src/config.ts; power
  byte-identical). Live A/B vs momo-shape-2 (unchanged control) + shadow ride baseline; A/B started 07-09
  open. Kill = ONE genuine ≥120%-tail cap. **DISARM = delete the momo-shape line from GIVEBACK_TRAIL + push.**
  momo-shape has an ERA BOUNDARY 07-09 (pre/post ratchet — don't pool). See registry A13.
- **Operator calls 07-06** ([[operator-calls-2026-07-06]]): benched clones HOLD to the A6 read; A6 memo =
  registered decisions ONLY (advisory sections REJECTED — don't extend a6-watch); UI circle-back queue CLOSED.
- **Market state:** gaps RETURNED (gap_min gate reopened 07-02 +0.41 / 07-06 +0.52 / 07-08 −0.61 after the
  flat-open era) → the gap-gated book (V3/ALT, momo) is active again. Daily = mature uptrend showing first
  distribution, undecided at ~745 (739 the near arbiter, 717 macro shelf). ⚠ DIRECTION IS NOISE (doctrine +
  the mixed 3 gap days) — don't build directional/regime narratives from 1-day splits; magnitude is the gate.
- **Next gates (autopilot):** A6 read ~Jul 21 (a6-watch memo) — carries A9/A10, C1 unlock, clone re-arm;
  A4 (ORB stop A/B) ~early Aug; A13 momo ratchet accruing; FOMC #6 Jul 29.

## CURRENT STATE — 2026-07-03 (superseded above where they conflict; still the roster/bucket + doctrine base)

**The desk in one paragraph:** 3 Alpaca paper accounts as LIFECYCLE buckets (re-bucketed 2026-07-03) —
**FIRST-TEAM** (acct 2, $1M, cred_ref '2'): the earning roster — pb-ride / pb-ride-2 / pb-ride-itm +
momo-shape / momo-shape-2 (the harvest engines), breakout(base), V3/ALT SPY (LOCK +22/−30, cold streak,
also the clone-A/B live controls), the IWM pair, orb-qqq-trail, qqq-thrust-trail. **LAB** (acct 3, $1M,
cred_ref '3'): experiments — QQQ V3/ALT ports, orb-ustop (the A4 variant), six benched SPY clones
(A1-sized + LOCK-synced 07-03 — safe to re-arm), fomc-follow (arm-per-event only), the vb-* virtual
fleet (signal-only, day 1 accrued). **MORGUE** ($50k, default keys): known losers kept for data —
grind ×3, breakout-qqq, orb-ustop-ctl (the A4 control, lot-isolated from its twin by account), the
power/orb drafts, and the disabled manual twins (soft-deleted 07-03; all history intact).

**⚖ THE REGISTRY GOVERNS ALL KNOB CHANGES: `docs/pre-registered-tests-2026-07.md`** (A1–A10 + C1 +
R1 + the calibration/instrumentation logs). Check it BEFORE proposing any gate/TP/stop/size change —
thresholds and kill criteria are fixed pre-outcome and changed only pre-window. The A6 era-4 read
triggers at **15 era-4 sessions (~Jul 21)** — **`npm run a6-read`** is the whole evaluation locked in
code (A6 own-breakeven bars · A6b near-miss · A9 base gap-split · A10 ride gate incl. the momo-shape
$1,800→$1,000 unvalidated-size rule), and **`a6-watch` (nightly, capture chain) is the AUTOPILOT** —
T-1 push, then the auto-generated decision memo (read + pre-filled SQL per registered decision) at
trigger. **Go-live/capital on-off = the operator's DISCRETIONARY call** (his word 2026-07-06 — no binding
gates on capital; `docs/go-live-gate.md` is an advisory readiness checklist only). **`docs/
index-expansion-kit.md`** = the codified one-day new-index playbook.

- **Era 4** = trades opened ≥ 2026-06-30 (LOCK/RIDE strip + stop-aware sizing live). Keep it
  pristine — config changes only as logged rule-applications in the registry's calibration log.
- **Worker `stream-2026-07-03a`** (Railway auto-deploys main; verify live code via
  `select note from worker_heartbeat` — Railway deploy titles are image digests, not git SHAs):
  gap_min config knob DARK (migration 62 — all channels 0; arming breakout(base) is the A9 decision
  at the A6 read, a config flip not a deploy). KILL = FLATTEN. The cron is exit-only failover.
- **Books: CLEAN** — reconcile-alpaca 2026-07-03: +$0 booking error across 319 OCCs, 3/3 accounts.
  Nightly `npm run capture` = the data ritual (quotes/bars export + reconcile drift-gate +
  gate-shadow + forensics regen) — verify it stays alive; option_quotes prune at 7d and are NOT
  reconstructable.
- **Backtest input integrity (2026-07-06, merged a5c5726):** the engine's `--options quotes|real`
  path now FAILS HONEST — quote/bars pages retry 4× then hard-exit, per-day rows verified against
  the server's own count, NO silent Black-Scholes fallback (was: a statement-timeout under
  capture-window DB load quantized closed-day runs to two P&Ls, e.g. power/07-02 −144.96 real vs
  −487.31 modeled — and benched-sim banked the modeled one as "real NBBO"). quotes mode refuses
  zero-quote days (`--allow-modeled-days` = the explicit escape); benched-sim/lastweek notes carry
  the fail reason. forensics_reports benchedVsLive payloads generated pre-fix are suspect — audited:
  07-01/07-02 clean, 07-06 was degraded (power 3t/−352 → true 2t/−103) and re-banked clean.
- **Vercel env COMPLETE** (ALPACA_KEY_2/3 + SECRET_2/3 since 06-26) — UI-close works on all three
  accounts; any older "pending Vercel env" note is stale.
- **The breakout-family diagnosis (2026-07-03, clean data):** three separate causes, not one —
  (1) V3/ALT/MOMO are gap-gated by validated design and era 4 has had ZERO ≥0.25% SPY gaps → their
  dark streak is correct selectivity (verified not-halted via live gap stamps; IWM traded its 0.411%
  gap the same day); (2) the 06-25→29 −$39k bleed = TP-less clones at $2k risk surrendering +22–41%
  peaks to −50% stops (fixed: benched + A1 + LOCK-synced); (3) breakout(base) bleeds the flat-open
  days it was never gated against (→ A9). PB is the desk's flat-open trend coverage; that's its lane.
- **Retro-attribution caveat:** per-account rollups re-label history through the strategist→account
  join (broker NAV history stays put) — per-bucket reads spanning 2026-07-03 should key on the
  strategist, not the account.
- **Next-session watch (Mon 07-06):** the 7 moved channels' orders land in acct 2; worker 03a
  beating; V3/ALT's first-ever LOCK trades arrive on the next ≥0.25% SPY gap day.

**Archived session handoffs (2026-06-03 → 2026-06-25): `docs/handoffs/2026-06-handoffs.md`** — the
durable verdicts live in `memory/` (MEMORY.md is the index); the archive is narrative history, not
current state. The DESK-CONTROLS MAP below remains the strip/knob reference (note: its account names
predate the 07-03 re-bucket — Core→FIRST-TEAM, Resurrected→LAB, paper-main→MORGUE).

## DESK-CONTROLS MAP — 2026-06-30 (CHANNEL-STRIP REDESIGN: knobs → real TP/stop/risk)
**Operator's complaint: the strip knobs were "mostly inert/counterintuitive" and didn't map to real-world TP/stops.
Rebuilt the ChannelStrip around what the worker ACTUALLY exits on. Shipped in 5 slices, all on `main` (commits
`25595d3`→`5d60e63`), UI-only (no worker/trade-path change), reversible. The whole redesign is in
`components/console/ChannelStrip.tsx` + `components/console/RosterTable.tsx` + the `.ch-fires`/`.chm`/`.ch-shape`/
`.roster*` rules in `app/console.css`.**

**THE NEW STRIP (top→bottom):** `executor · DTE` sub → **FIRES readout** (`fires −30% +22% EOD`, reads the live
config the worker exits on: `premium_stop_pct ?? 50` / `take_profit_pct` / EOD flatten) → **LOCK/RIDE mode toggle**
→ **trade-shape bar** (to-scale red stop | entry | green target, drag handles, `0.73R` label) → **two-dial sizing**
(`STOP/day` knob = `daily_stop_usd` + `RISK` fader = `capital_pct`) → MUTE/BOOST pads.
- **FIRES pills are click-to-edit** (`FiresPill`, exported): take (0 = ride) + premium-stop (clamped 10–90%). The
  premium stop had NO knob before — it's the binding downside, now surfaced + editable.
- **⚠ ORDER CONVENTION (operator's call, don't re-flip): stop·take left→right EVERYWHERE** — FIRES text, shape bar,
  AND roster-table columns all read stop (red, left) → take (green, right), the number-line convention (loss left /
  gain right) so the bar's drag stays intuitive (drag right = bigger take). Keep the three in sync.
- **LOCK/RIDE writes the MATCHED PAIR** in one move: LOCK = take (keep tuned, else default 22) + tight −30% stop;
  RIDE = no take + loose −50% stop. Mode is read from `tp>0?lock:ride`. This encodes the giveback doctrine
  ([[giveback-takeprofit-split]]): LOCK the find-and-surrender book, RIDE the genuine tails (MOMO).
- **Shape bar** = the same tp/premium_stop as pills, visual + draggable (live dispatch on drag, persist on release).
- **Declutter:** removed the redundant TP knob (→ pill/shape bar) + inert U-STOP knob (→ flagged `uS·off` when
  `ustop*180≥premStop`; lives in the flip "advanced" editor). `aggression` shows in NO view (retired).
- **ADVANCED = the flip-card editor** (pencil icon): executor · entry_dte · event_policy · **u-stop %** · take-profit
  % · **max-contracts** · pyramid + lifecycle (bench/duplicate/delete). Everything secondary lives here.
- **ROSTER TABLE (slice 5b, DESKTOP only):** a `strips ⇄ table` toggle in the Mixer (§02) label swaps the strips for
  a fleet grid — Channel · Mode · Take · Stop · Risk/tr · Stop/day · Day P&L, every cell inline-editable (reuses
  FiresPill + the LOCK/RIDE pair). Mobile keeps its Mix carousel (got slices 1–4, not the table).
- **Anon = read-only** everywhere (pills/mode/shape → static text/labels; same as pre-redesign). Editing gates on
  `canWrite` from `useDeskWrite`; writes = optimistic `dispatch(SET_CONFIG)` + `persistConfig` (RLS-guarded).
- ⚠ **Desktop Mixer-room screenshots return blank cream when scrolled** (a preview-harness rasterizer quirk, not a
  bug) — verify desktop strips/table via DOM eval or a tall-viewport (`height:2680`) capture at scroll 0.
- **⚙ SIZING (two-dial, made honest 2026-06-30):** live qty = `min( floor(RISK ÷ (premium_stop_pct·ask·100)),
  max_contracts )`. STOP-AWARE since worker `stream-2026-06-30c` (decide.ts base entry + pyramid wouldQty) — reads
  each channel's real stop so **`RISK $` = the same real dollars on every channel** (was hardcoded 0.5 = −50%, which
  under-sized the −30% channels to 0.6× their stated risk). Then reconciled RISK↔caps so **RISK governs day-to-day and
  max_contracts is a true safety ceiling** (before: caps bound at typical asks → RISK was inert). Per-account ≈$/trade:
  paper-main $600 · Core $750 (incl. IWM — the strongest edge, bumped to parity, cap 30) · Resurrected $720–1,800
  (MOMO the ride). daily_stop set ≈2.5× RISK so one stop-out doesn't halt a channel. To scale a channel, turn RISK up —
  it now responds (bounded by max_contracts).
- **🔥 BOOST pad (54_boost.sql, worker `stream-2026-06-30d`) — replaced the inert SOLO.** A per-channel amber toggle
  (`strategist_config.boosted`): while lit the worker runs that channel **2× for the day** — RISK budget ×2 +
  `max_contracts` ×2 + `daily_stop_usd` ×2 (all in `decide.ts`, base entry + pyramid). **Auto-cleared nightly** by the
  `seve-clear-boosts` pg_cron (weekdays 21:15 UTC, after the cash close) so a 2× can't ride into the next session. Pad
  writes `boosted` via SET_CONFIG + persistConfig (anon read-only). The `soloed` column + solo-ducking are now DORMANT
  (nothing sets `soloed` true) — kept in the DB to avoid a live-worker deploy race; drop later.
- **☠ STILL DEAD / UNENFORCED KNOBS (audit 2026-06-30):** (1) **fund `master_daily_stop_usd`** is read but NOT enforced
  by the worker — only the manual **KILL** (`is_halted`) halts the desk; the auto "halt at −$X" does nothing (and has no
  UI). (2) **aggression** — retired/unused, removed from the UI. (3) **u-stops** — every armed channel's
  `underlying_stop_pct` is set to a value the premium stop beats first (the `uS·off` flag) → it never fires. Wire
  master-stop into `decide.ts`, or drop it from the UI, if you want it real.

## One page, three sections (Next.js App Router, TypeScript, plain CSS, zero UI deps)
The whole desk is a **single route** (`/`, `app/page.tsx`) — one cream TR-909
`Chassis` holding three stacked, silkscreen-labelled sections (anchor chips +
`#live`/`#composer`/`#desk` ids let you jump between them). All three data hooks
are called **once** in the page's `Surface` component (no duplicate realtime subs).
- **01 · Live Market** — live SPY: red 7-seg LED spot, candle/line chart with
  timeframe (1m–1h) + VWAP + EMA(9/21) overlay + volume + MACD + hover crosshair,
  live option chain (click a leg → `ContractDetail` drill-down), Tape Health, event
  log. Hero grid is `.grid--live` (wider chart than the secondary right column).
- **02 · Strategy Composer** — skeuomorphic Roland TR-909: 4 strategist channel
  strips (knobs/pads via `useDragValue`), master strip (kill switch, paper/live,
  START/STOP), 16-step tape. Drives `strategist_config` / `fund_state` (auth writes).
- **03 · Book & P&L** — positions, per-PM + fund P&L, equity curve, signals tape.

History: these were three routes (`/`, `/console`, `/desk`) until 2026-05-31, when
they were merged into one surface for the true single-instrument 909 look (the old
`Console.tsx` / `DeskScreen.tsx` chassis wrappers were deleted; `NavBar` is now just
brand + auth). The cream chassis lives in `app/console.css` (scoped under
`.console-root`); the dark data panels use `app/globals.css`. Fonts: IBM Plex Sans
+ JetBrains Mono.

**Responsive split (2026-05-31):** `app/page.tsx`'s `Surface` calls all data hooks
ONCE, then branches on `useIsMobile()` (820px): `<DesktopSurface>` (the one-page
909 chassis) above, `<MobileApp>` (phone tab-shell) below. Shared `SurfaceProps`
(`components/surfaceTypes.ts`) — neither layout re-subscribes. The mobile app
(`components/mobile/MobileApp.tsx`, styles `app/mobile.css`) is a native-style
shell: sticky cream vitals header (RUN/PAPER + SPY/day-P&L LEDs) · scrolling screen ·
fixed **3-tab** bottom bar of inline-SVG 909 pads:
- **Live** — full-width chart hero + CHART/CHAIN/POSITIONS *additive* toggle pads
  (each appends its panel below, like indicator chips; chain & positions are
  mobile-condensed so they fit with no horizontal scroll).
- **Desk** — P&L/equity + the full **Master strip** + the 16-step tape as a 4×4 grid.
- **Mix** — horizontal swipe carousel of full-height `ChannelStrip`s.
The top-right **cog opens a Settings·Log sheet** (auth sign-in/out + signals /
tape-health / event-log). Knobs render a mixer-style **LED glow ring** (fills with
the value) — shared, so desktop gets it too. The shell reuses the exact same
hardware components, so it must stay inside `.console-root` (which owns the
`--pm-*`/`--knob-*`/`--led-*`/`--chassis` vars + the dark default text color). The
document is scroll-locked under 820px (`overscroll-behavior:none`) so grabbing the
header/tab bar can't rubber-band the app.

## Data seam (the architecture spine)
One hook owns all reads; components are dumb/props-driven. Swap the hook to change
the source without touching UI.
- `hooks/useMarketData.ts` — Monitor (option_quotes / underlying_bars / events).
  Loads ~15 trading days of 1-min bars ONCE on mount (paginated via `.range()`
  past PostgREST's ~1000-row cap) + polls only the recent 200 bars and merges
  them in (cheap live updates, deep history). The chart (`IntradayChart`) windows
  this with pinch/drag zoom-pan over a default latest-80-bar view.
- `hooks/useDeskState.ts` + `DeskProvider` — console config; hydrates once from DB
  (`lib/desk/load.ts`), falls back to `lib/desk/seed.ts`.
- `hooks/useDeskFeed.ts` — Desk telemetry (positions / signals / equity_snapshots).
- `hooks/useAuth.tsx` + `useDeskWrite.ts` — magic-link auth; console writes persist
  when signed in (anon = read-only).

## Database (Supabase) — RLS read for anon; writes via auth or service-role
Numbered SQL files in repo root, run in the Supabase SQL editor (user has NO CLI):
- `trading-desk-schema.sql`, `02_market_data.sql` — schema (given).
- `04_dashboard_read_policies.sql` — anon SELECT on desk tables.
- `05_console_write_policies.sql` — authenticated SELECT+UPDATE (console writes).
- `06_realtime.sql` — realtime publication (optional).
- `07_backfill_bars.sql` — pg_net backfill of underlying_bars (fire/ingest, by month).
- `09_option_bars.sql` — option_bars table (historical option trade bars, research).
- `10_paper_trader_cron.sql` — schedules the worker (Mon–Fri, 13–20 UTC).
- `11_retention.sql` — **truncates option_bars** + daily retention cron
  (option_quotes 7d / events 30d / equity_snapshots 90d). Keeps the DB lean.

Key tables the dashboard reads: `option_quotes`, `underlying_bars`, `events`,
`strategists`/`strategist_config`, `fund_state`, `positions`, `signals`,
`equity_snapshots`. `option_bars` is RESEARCH-ONLY (kept empty in prod; re-backfill
on demand). market-ingest (Deno edge fn, given) writes the live tape each minute.

## Backtest engine (`engine/`, portable TS, run via `tsx`)
"One engine, two drivers." `npm run`: `backtest` / `sweep:cross` / `regime` /
`daily-gate` / `backfill:options`. Reads real data via anon (`.env.local`).
- **Finding (settled):** the **15m EMA crossover** is a *regime-dependent momentum
  edge* — profitable in trending stretches, lossy in chop (4/10 quarters red over
  2024–2026 on real bars + real option fills). 1m loses (whipsaw/friction). No
  entry filter (efficiency-ratio, daily-trend) rescued the chop quarters — the
  lever is regime-aware *allocation* (console mute/solo), not entry rules.
  `engine/strategies/crossover.ts` holds the locked default (15m, EMA 12/26, vol
  1.2, 1.5-ATR stop, 45m time-stop).
- **Critical lesson:** Black-Scholes badly mis-prices 0DTE — always backtest with
  real `option_bars` fills, not BS. Same trades: BS −$37/trade vs real +$393.
- Multi-year option backfill via `npm run backfill:options -- --tf 15 --from … --to …`
  (writes via anon — needs a temporary INSERT/UPDATE policy on option_bars; revoke
  after). Alpaca historical: stock bars + option **bars/trades** OK on free plan,
  but **no historical bid/ask** (so spread is modeled at 3%).

## Live paper-trading worker — multi-channel dispatcher (LIVE)
`supabase/functions/paper-trader/index.dispatcher.draft.ts` is the **canonical**
worker now — a self-contained Deno edge fn, cron'd every minute (Mon–Fri market
hours). It's a **multi-channel dispatcher**: it runs each enabled strategist's
mandate strategy (the worker mirrors the logic in `engine/registry.ts`; the
Grinder/`grind` scalper is the most active) and places single-leg SPY 0DTE market
orders on Alpaca paper, writing positions/signals/equity_snapshots/events. Stateless
— reconstructs state from Alpaca paper (`paper-api.alpaca.markets`,
`/v2/account|positions|orders`); the Console's per-channel knobs + mute/solo + master
kill switch gate it.
- **Deploy by pasting that file into the Supabase Edge Function editor** (I have no
  CLI). Verify-JWT is OFF (internal cron worker). After any edit, confirm the
  DEPLOYED worker == this repo file.
- **Status (UPDATED 2026-06-03): LIVE paper-trading (`DRY_RUN=false`), version
  `2026-06-03b`** — see the SESSION HANDOFF up top. (Historical: it was killed early in
  development after a **runaway re-buy incident**, then re-armed.) Root cause of that was a
  position INSERT used a non-existent `entry_underlying` column → silent supabase-js
  failure → no desk row → the worker saw itself flat → re-bought every minute (~48
  contracts). FIXED in the repo: (a) `already_open` guard (skip if an open
  position/order for the OCC symbol exists), (b) INSERT `.error` check, (c) NO
  `entry_underlying` column — uses `strike` as the ATM entry-underlying proxy (no
  schema migration). **Lesson: never invoke the armed worker to "verify"; never add
  DB columns the user has to chase — hand them copy-paste SQL or avoid the column.**
- **To re-arm (paper):** redeploy the hardened repo file, dry-run-verify one cycle,
  THEN set `DRY_RUN=false` and redeploy.
- Sizing: budget = Alpaca equity ($100k paper) × capital_pct% × aggression%;
  qty = floor(budget ÷ (ask×100)) capped at max_contracts (keeps size sane vs the
  $10k console master). Exits: opposite signal / premium stop (−50%) / 45m time-stop
  / EOD flatten. NOTE: the **Stop knob (`daily_stop_usd`) is NOT wired** into the
  dispatcher yet — it currently has no effect.

## Strategy channels & Add-Channel (CURRENT FRONTIER)
Each channel runs its OWN mandate strategy (not one shared thesis). The goal: a user
adds/removes channels by importing a strategy-thesis `.md`.
- `engine/registry.ts` — `STRATEGY_REGISTRY` maps each slug to a `StrategyDef`
  (`{slug,name,timeframeMin,warmupBars,mandate,build}`). The 4 channels:
  breakout→ORB (`strategies/breakout.ts`), fade→VWAP reversion (`fade.ts`),
  power→Power-Hour lean (`power.ts`, NEW), grind→scalper (`grind.ts`, NEW). power &
  grind are **unbacktested first-draft theses.** Backtest any:
  `npm run backtest -- --strat <slug>`.
- **Add-Channel phase 1 (DONE, shipped):** paste/upload a thesis `.md` →
  `lib/desk/strategySpec.ts` (`StrategySpec`/`Condition` types, `parseFrontmatter`,
  `capabilityCheck`) gives an instant frontmatter preview + flags unsupported inputs;
  `app/api/compile-strategy/route.ts` (server-side Anthropic Messages API via fetch,
  forced tool-use → `StrategySpec`; degrades to `{needsKey:true}` with no key) does
  the full LLM compile; `components/console/AddChannel.tsx` is the sheet (`+ Add
  Channel` on the desktop composer SectionLabel; `.ac-*` styles in `app/console.css`).
- **Capability reality:** the desk runs only **single-leg directional** strategies on
  the features `computeFeatures` provides (ma_cross / vwap / opening_range / rel_vol /
  rsi / time). It has NO: multi-leg orders (straddle/strangle/vertical/condor), NYSE
  TICK, GEX/dealer-gamma, IV-rank, or event calendar. The user's 3 theses
  (`Trading Thesis/`, extracted to `_extracted/`): #1 ORB ≈ runnable; #2 straddle &
  #3 vertical need multi-leg + those feeds. The UI flags these so a channel is never
  armed blind. See `docs/strategy-channels.md`.

## Operational gotchas (important)
- **Secrets:** `.env.local` (gitignored) holds the anon key + (added for backfills)
  ALPACA_KEY/SECRET. NEVER commit secrets. The service-role key is NOT in the repo;
  the worker/edge fns get it auto-injected by Supabase. Alpaca `PK…` keys are PAPER.
- **I (Claude) can't deploy edge functions or read the `cron`/`net` schemas** from
  here (anon-only). Edge fns deploy via the **Supabase dashboard editor** (paste);
  cron/net diagnostics need the user to run SQL and paste results.
- **Free tier 0.5 GB:** keep it lean. Research data (option_bars) is transient —
  truncate after use; `11_retention.sql` caps the live tables. Don't warehouse.
- A stray `TR-909_T_600_FNL_A.jpg` sits untracked in the repo root — leave it
  (it's the user's reference image; gitignored from commits implicitly by `git add -A` care).

## NEXT SESSION: real-fills A/B for the smart layer → see docs/NEXT_SESSION_AB_REAL.md
The **smart-layer brief is fully built** (6 PRs): `engine/cost.ts` (cost model +
costDrag), the `management` block in `StrategySpec` (R-risk / scale-outs / breakeven
/ trail / cost gate) with `validateManagement`, the tranched state machine
`engine/manage.ts` (golden test: `npm run golden`), `engine/smart-specs.ts` (the four
`*-smart` channels), and the A/B comparator `engine/ab.ts` (`npm run ab -- --all
[--mgmt-only] [--options real]`). On MODELED chains the A/B proved the smart layer's
**risk control** (drawdown −71/−109/−195 R; cost gate cut grind 2263→125 positions)
but expectancyR is FLAT — BS has no convex tail. **Next: backfill real `option_bars`
and re-run the A/B** (`docs/NEXT_SESSION_AB_REAL.md` has the exact SQL + commands).
Smart channels run in the backtest but are NOT live-armable yet — wiring `manage.ts`
into the `paper-trader` worker is the out-of-scope follow-on, only worth it if a
smart variant wins on real fills.

## (DONE) Add-Channel phase 2 — compiled channels live
Add-Channel **phase 1** (import → frontmatter preview → LLM compile → capability
flags) is shipped. So are: the SPY-LED day-direction fix (green/red vs **prior
close**, not the pre-market print), the realized-P&L "Today's trades" view + Day-P&L
LED counting realized+unrealized, the auth magic-link redirect fix (`/`) + locked
master controls when anon, and the live `/api/spot` Alpaca price.

**One-time setup the user must do in the dashboards (I can't):**
- **Vercel env:** add `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) to activate
  the `.md` compile route. (ALPACA_KEY/SECRET already set — powers `/api/spot`.)
- **Supabase Auth → URL Configuration:** Site URL = `https://seve-henna.vercel.app`
  (magic-link 404'd before; redirect is fixed to `/`). Sign-in is required for the
  KILL switch + knob persistence (anon = read-only, writes silently no-op).

**Tasks, priority order:**
1. **Add-Channel phase 2:** compiled spec → backtest-gate (engine on real
   `option_bars`) → **Arm** → persist (new `strategists`/`strategist_config` + spec
   rows) → render channels **dynamically** (de-hardcode `COLOR_BY_SLUG`/`ORDER` in
   `lib/desk/load.ts` so N channels show) → write `specToEvaluate(spec)` (StrategySpec
   → engine `Evaluate` for the SUPPORTED condition kinds) → wire armed channels into
   the dispatcher worker. Add the **mobile** `+ Add Channel` trigger.
2. **Wire the Stop knob** (`daily_stop_usd`) into the dispatcher — halt a channel at
   its daily realized loss (currently a no-op).
3. **Backtest power & grind on REAL fills:** backfill `option_bars`
   (`npm run backfill:options …`, needs a temp INSERT policy) → `npm run backtest --
   --source real --options real --strat power|grind` → tune the theses.
4. **Bigger (unblocks theses #2/#3):** multi-leg option orders + the missing feeds
   (GEX/dealer-gamma, NYSE TICK, event calendar, IV-rank).

The user iterates fast via real-device screenshots — keep the preview server up and
screenshot at 390px (mobile) AND 1280px (desktop) for every UI change.

Workflow gotcha: **stop the preview dev server before `npm run build`** (they share
`.next`; running both corrupts it — see the user memory note). `npx tsc --noEmit`
is always safe. Verify clean tsc + build before `git push` (push auto-deploys).

## Conventions
Plain CSS (no Tailwind), inline SVG (no chart libs), minimal deps, the data-seam
pattern, faithful 909 aesthetic, honest data labeling (modeled vs real). Commit
messages end with the Co-Authored-By line. Branch is `main`; push deploys.

**909 panel aesthetic (don't drift):** data panels use the base `.panel` — a
recessed dark "display screen" (black molded edge + drop shadow + light text)
with a molded plate `.phead` carrying a silkscreen label. NEVER build a flat
dark-tech card. **Screws were removed console-wide (2026-06-02)** — `Bezel` defaults
`screws={false}`, no panel uses `.panel--screws`, and the brand subtitle is gone; the
`.screw`/`.bezel-screw`/`.panel--screws` CSS lingers but is unused. Uncolored table
cells inherit `.panel`'s light text; `.pos`/`.neg` override. The cream chassis lives
in `console.css`; dark panels in `globals.css`. The desktop 16-step tape is a **2×8
grid of large pads that fill the console width** (`.steprow` repeat(8,1fr), `.step`
~92px); mobile keeps its own 4×4 via `.m-steptape` overrides.

**CREAM TREATMENT (2026-06-02, desktop):** most of the desk is now cream 909 chassis,
NOT dark — channel strips (`.channel`), the tape Bezel (`.bezel.tape`), the §03 LOG
panels (`.log-section`), and the §01 data tables (`.market-section .grid` →
Positions/Chain/P&L) all go cream via a token-flip: redefining `--text`/`--muted`/
`--green`/`--red`/`--amber`/`--blue`/`--panel-2`/`--border` on the scoped `.panel` so
every cell turns to ink at once (plus a few hardcoded light colors overridden:
`.log .msg`, `.au-verdict/.au-ev`, chain `.calls/.puts/.strike-col`). **Deliberately
left DARK** (the "screens" — these paint their OWN dark surface, so they stay dark even
inside a cream frame): the SPY chart **CANVAS** (its own JS theme in `IntradayChart` C
object — a cream candle chart was tried + rejected), the LED vitals (Day P&L/SPY/NAV),
and the MASTER strip (`.master`).

**Extended to the chart FRAME + MOBILE (2026-06-03):** the token-flip selector now also
covers `.market-section > .panel` (the §01 chart's FRAME — header/body/border go cream
while the canvas + spot LED stay dark) and `.m-app .panel` (EVERY mobile data panel:
chart frame, chain, positions, greeks `.cd-stat`, P&L, autopsy, signals/event-log — so
the phone matches the desktop cream). The mobile Settings·Log **sheet** (`.m-sheet`) is
cream too (`app/mobile.css`). The hardcoded-light overrides (`.log .msg`,
`.au-verdict/.au-ev`) + chain-color overrides are mirrored to `.m-app`. The greeks
`.cd-stat` needed an explicit cream bg because it reads `var(--panel)` — the ONE token
the flip does NOT redefine. Still DON'T make `.panel` cream globally (the nav/auth-btn +
master must stay dark); the scope is `.log-section`/`.market-section .grid`/`.market-section
> .panel`/`.channel`/`.bezel.tape`/`.m-app .panel`.
