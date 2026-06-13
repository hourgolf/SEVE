# SEVE — project memory / session handoff

SEVE is a SPY 0DTE/1DTE paper-trading "desk": a Next.js dashboard over a Supabase
Postgres DB, a backtest engine, and a live paper-trading worker. This file is the
durable context for a new session. Read it first.

- **Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE
- **Supabase project ref:** `xvdfsxwwedltvdktqdac` (free tier — mind the 0.5 GB cap).
- Deploys auto on `git push` to `main` (Vercel; SSH deploy key already configured).

## SESSION HANDOFF — 2026-06-12 EVENING (VALIDATION DAY PASSED · QQQ FLIPPED) — READ THIS FIRST
**W2 IS COMPLETE. The 06-12 validation day PASSED every gate, and the QQQ trio flipped to
stream post-close (desk flat) → 13 machine channels on stream, 4 manual twins on cron.**
Worker `stream-2026-06-12a` deployed + beating (commit `106a3c3`).

**⚑ ROSTER CULL EXECUTED (operator's word "run it chef", same evening, via MCP — supersedes the
13-channel count above): 7 channels → draft** — power, power-final30, breakout, breakout-qqq,
orb-spy-trail, orb-trend-rider, grind-smart-entries (draft still winds down exits; desk was flat,
nothing stranded) **+ qqq-thrust-trail `underlying_stop_pct` 0.20→0** (QQQ pair alignment with
orb-qqq-trail). **ARMED MACHINE ROSTER = 7, all stream:** breakout-alt-v3 · breakout-smart-entries
(the momentum_atr A/B pair, month-end folds the loser) · grind-v3 · power-smart-entries
(PROBATION — clean-era yardstick at month-end; model-red/live-green, the family's last stand) ·
orb-qqq-trail · qqq-thrust-trail (QQQ pair, month-end clock) · pb-ride (1DTE debut). 4 manual twins: operator
muted them 15:20 ET, then **RE-ENGAGED (unmuted) all 4 at 18:13 ET — twins are LIVE Monday**.
Full menu + recipes + epitaphs + projections (menu beat the full roster +$4,441 on this week's
replay; cut model-drag ≈ −$650…−$940/wk; worst-regime tail cut ~4×):
**docs/roster-menu-2026-06-15.md**. Rollback any: `update strategists set status='armed' where slug='…';`
— or from the UI now: the strip flip-editor's Lifecycle button (the 86'd shelf, below).

**KITCHEN CLEANUP SHIPPED (same evening, post-cull — the 06-10 consultant UI thread, courses 1+2):**
(1) **THE 86'D SHELF** — draft channels no longer render full strips: desktop §02 + mobile Mix
collapse them to small grey bench pads under a `BENCH · 86'D` rail (tap → full strip to inspect /
re-arm). NEW `useDeskWrite.setChannelStatus` + a Lifecycle "86 it (bench) / Re-arm" button on the
strip's flip-editor — the cull/rollback SQL is now one auth-gated tap. Preview-verified both
breakpoints: 11 armed strips + 7 bench pads; mobile Mix 5 pages → 3. (2) **"THE DESK SUMMONS YOU"
ALERTS** — worker `stream-2026-06-12c` (new `worker/src/alerts.ts`): pushes via the app's
/api/push-send (tag `seve-alert`) on **+75% crossing · ≥50% giveback of a ≥+30% peak (the panel's
amber, pushed live) · daily-stop latch · event stand-down flatten · insufficient_capital (the
pb-ride Monday watch!) · kill-switch halt transition**. In-memory once-per-ET-day dedup per
(kind,scope); informational only — NEVER an exit path. **Railway env SET (operator, same
evening): `APP_URL` + `PUSH_SECRET` (recovered from the 06-08 session transcript — the
`openssl rand -hex 24` value matching Vercel's hidden `PUSH_SEND_SECRET`); TEST PUSH DELIVERED
through the production route (`sent:1`, landed on the phone). Alerts ARMED for Monday; this also
unblocks the twin entry-push migration item.** (3) **CRON v56 `2026-06-12a` DEPLOYED (sentinel-verified): STREAM-STALE
PAGE** — the cron pages "⚠ STREAM STALE" when the worker heartbeat crosses 5m (stateless
one-cycle-window dedup; re-pages at 1h/2h; an 09:00 ET first-run check catches weekend deaths;
known benign edge: market holidays page ~09:40). `firePush` gained a tag param so alerts don't
replace the ✋ twin pings. **COURSES 3+4 SHIPPED (same night, operator approved all 4 declutter
items): (3) CHART —** TRUE session VWAP (the old line plotted the PER-BAR vwap ≈ close — the
display twin of the worker's vwap quirk, fixed display-side only; worker untouched), new `±σ`
chip (VWAP ±1σ/2σ volume-weighted bands, default off), and OPEN-POSITION ENTRY LINES (dotted,
direction-colored, at the underlying-at-entry from the fill-time bar, strike fallback, labeled
`▲741C×2`, rides the TRADES chip — first visual test = Monday's first position). **(4) §03
DECLUTTER —** `DAY · BOOKS` trust strip atop §03 (DAY P&L (NAV) · ATTRIBUTION Σ · BOOKS Δ
toned ok/warn/bad · trades · top mover; verified live: Δ −$172 == the 06-12 day-report books
delta); autopsy rows of benched channels grey out + carry an amber `86'd` chip (a week-old KEEP
on a culled channel can't read as policy); OPS·PRE-FLIGHT absorbed Tape Health as a 5th TAPE
light (component deleted); Signals Tape collapses consecutive identical signals into one ×N row.
Course 5 parked: multi-account/paper-lab cockpit (trigger = real money).

**LATE-NIGHT RESEARCH COOK (operator's "COOOK!!", same evening — 2 bench probes, memory updated):**
- **FOMC resolution trade (`npm run fomc-resolution-probe`, NEW): PAPER-LAB CANDIDATE, collecting.**
  18 in-corpus FOMC days: mechanism real (60% continuation on ≥0.10% statement moves, +0.21%
  avg follow-through); **follow@14:30 +$678/t, 60% win (n=5** — cost gate blocked the other 5;
  ⚠ 2024-12-18 alone = 71% of the P&L); **FADE is DEAD (0% win)** — inversion filed; the edge
  decays monotonically with delay (14:30 +376/t → 15:00 −189/t) = it lives in the resume minute.
  Anecdote-grade BY CONSTRUCTION — nothing arms; **re-run after every live FOMC (Wednesday 06-17
  adds day 19)**; graduates only if the one-day concentration dissolves as n grows.
- **ma_cross × gap compose (`npm run cross-gap-probe`, NEW): REFUTED at the pre-registered bar.**
  Gate lifts pooled exp$/t +17.2→+58.5 and helps 4/5 windows — but **ex-CHOP-MIX the gated book
  is still red** (−$1,457; fingerprint #1 fires) = the third "filter the crossover into health"
  refutation. **Don't build tf>1 worker support for it.** Residue: the gap SIGNAL re-validated on
  yet another shape (flat-open crossover −17/t vs gap-day +73/t) — gap_min stays armed where it
  earns (V3/ALT); future momentum candidates get gap-gated FIRST before anything fancier.
  Probe fix en route: aggregate() stamps 15m buckets at their START ts → probes must remap to the
  bucket's LAST 1m ts or option fills look ahead ~15min (cross-gap-probe does; pattern for any
  future tf>1 probe).

**VALIDATION RECEIPTS (morning watch, all green):** (1) gap_min FAIL-CLOSED CHECK PASSED —
stream rationales carried `gap: 0.424` from the open; V3 traded THROUGH the open gate at 11:22
(−$315 stop_premium at −51.5% vs design −50% — the stream's stop precision on a live loss;
in-distribution, the gate is a regime bet not a win guarantee). (2) First MULTI-CHANNEL stream
session: 21 auto trades / 11 channels, coverage ✓ clean 13 OCCs, books Δ$172 on a churny day.
(3) QQQ SHADOW PROOF EXACT: cron filled orb-qqq-trail QQQ719C ×1 @ 10:53:01; worker shadow
ENTER same contract/qty at 10:53:02 → trio flipped post-close (rollback: executor='cron').
(4) Stream-vs-stream shared-OCC exercised live (two ORBs on 742C; spy-trail trail-exit ×2 then
the operator's route-close of trend-rider's 2 from the half-drained lot) — zero ghosts/
rejections/reconciles. (5) Late entries 15:36 FILLED (the cutoff-31 roll working; zero 422s vs
yesterday's 21). (6) close_reason/participation dataset rich on day one: 7 tagged closes
(reversal×5, risk×2, target), 13 taken vs 1 skipped (power-manual 742C hit the bell backstop
−$84 — the first 'skipped' datapoint), 4 operator overrides on autos.

**SHIPPED TONIGHT (worker `2026-06-12a`):** pre-open idle heartbeat 08:55–09:35 (kills the
310-line "stream heartbeat STALE" WARN flood the cron's gate printed 09:00–09:30 every
morning) + **BAR_HISTORY 900→2400** (the 900 cap was RTH-sized but SIP streams extended-hours
bars → the window held <1 calendar day, silently truncating prior-session pdh/pdl and — by
Monday afternoons — the gap's prior-close reference; found via the operator's weekend question).

**DAY REPORT 06-12 (saved docs/day-report-2026-06-12.txt): NAV −$2,834** — a whipsaw chop day
(SPY +0.23% close-to-close after a +0.42% gap; gap days are trend-PRONE not trend-guaranteed).
Cut-list receipts stacked: orb-trend-rider −448 (incl. a 111-min ER-0.01 entry + a re-lean),
power −421 + daily-stop latch, power-smart −420. grind-v3 +22 (3/4 win — the scalper keeps
grinding). The ⚑ FOMC-ahead line + executor split (stream 11ch/21t · cron 0 autos) + gap-watch
(ALT 0 trades = selectivity, its momentum gate) all rendered in one report.

**RESEARCH (5 probes today — the generative directive in action, memory updated):**
- **ema-stretch:** channels are EMA-band-BLIND and the data says keep it — "don't chase"
  INVERTS (near-band breakouts are the weak ones; ≥3-ATR stretched = +235/t). 3rd
  entry-geometry refutation. V3 as-armed printed **+$20,053/+275 per t** (strongest yet).
- **ema-pullback (new shape): KILLED at 0DTE** (single-window mirage + cost-walled scalp).
- **band-squeeze (new shape): KILLED** — midday coils don't pay; the ORB's 9:30 anchor is
  load-bearing. Cross-candidate fingerprints filed (CHOP-MIX-only profit = rising tide; 1-min
  volume confirms SUBTRACT; scalp exits structurally cost-walled).
- **one-dte (operator's walk-thought), 5-window VERDICT:** whipsaw-survival mechanism REAL
  (stop-rate halves everywhere) but **KEEPERS STAY 0DTE** — survival costs the convex tail
  (V3 Δ−$4,711, losing exactly the trend windows; the breakeven/trail regime signature).
  **RESURRECTION: PB-ride@1DTE flips to +$4,632, 4/5 windows positive** — 0DTE gamma was the
  pullback's murder weapon, not the entry. First generative candidate to survive a bar;
  **paper-lab-draft-eligible ON THE OPERATOR'S WORD** (needs an `entry_dte` per-channel policy,
  small build — the 1DTE roll plumbing exists). 1DTE chains now bought for ALL 5 windows
  (data/databento-mdte = full corpus).

**MONDAY WATCH (06-15):** (1) NO pre-open WARN flood (the idle beat's first live morning);
(2) first QQQ STREAM session — worker `stream:` fills on the QQQ PAIR (orb-qqq-trail +
qqq-thrust-trail; breakout-qqq culled), cron defers; (2b) the 7 culled channels take ZERO
entries + day-report coverage stays ✓; (2c) twins RE-ENGAGED (operator unmuted all 4 at 18:13
ET) — twin entries + ✋ exit pings expected; (2d) if Railway env was set: first `alert:` lines in
worker logs (+75%/giveback/latch pages land on the phone);
(3) Monday's gap = Monday open vs FRIDAY close (weekend news lands in the gap — by design);
(4) BAR_HISTORY 2400 = full Friday session in memory (pdh/pdl + gap refs intact all day).
**WEDNESDAY 06-17: first live FOMC stand-down, 13:50–14:30 — the whole machine roster is now
covered (twins exempt by design); the worker pages "⚑ event stand-down" when the flatten fires.
POST-CLOSE: re-run `npm run fomc-resolution-probe` (the live day = dataset day 19 for the
paper-lab candidate) — and eyeball 14:30→15:25 on the day report against the resolution thesis.**

**PB-RIDE DRAFTED (operator's word, same evening — commit `a608c36`, worker `stream-2026-06-12b`):**
the resurrected pullback is now a REGISTRY builtin (`engine/strategies/pullback.ts`, 1:1 port,
`npm run pb-selftest` PASS — trade-identical to the winning probe, 250t/$4,632) behind a NEW
per-channel **`entry_dte` policy** (`34_entry_dte.sql` APPLIED: 0=today+cutoff-roll default;
1=always next session's expiry — pb-ride's edge IS the time value; same-day flatten unchanged).
Channel row `pb-ride` (`35_pb_ride_channel.sql` APPLIED): executor=stream, entry_dte=1
(LOAD-BEARING — 0DTE variant refuted), event_policy standdown. Thesis doc
`docs/channels/pb-ride.md`. PB-scalp stays buried.

**PB-RIDE ARMED (operator's word, same evening): live Monday 06-15 on the stream.** SIZING FIX
en route: the draft's $150 risk knob couldn't clear ONE 1DTE contract (risk/contract = 0.5×ask
×100 ≈ $200-275 at 1DTE ATM → qty 0 → silent `insufficient_capital` no-trade). **RISK $300 /
STOP $450** = minimum-size (~1 contract/trade, ~1.5-2 stops/day bounded). MONDAY WATCH addition:
pb-ride's first live signals — if `blocked: insufficient_capital` appears in signals, the ask
ran past $6 and the risk knob needs a nudge (visible + fail-safe). Its trades enter NEXT-session
expiry and flatten same-day (entry_dte=1 + the 06-08a rule). QQQ port gate probed same evening
(`npm run pb-qqq-probe`, QQQ 1DTE chains bought → data/databento-mdte-qqq) — verdict in
docs/pb-qqq-probe-2026-06-12.txt.

**NIGHT-CAP CHORES (same evening, "time to lean = time to clean"):** (1) **TWIN ✋ ENTRY-PUSH
BUILT — worker `stream-2026-06-12d`** (`pushManual` in alerts.ts, tag seve-manual, fires on every
`-manual` entry fill in executeEntry — cron parity). **The twin stream-migration is now FULLY
unblocked; flip SQL ready, PENDING OPERATOR'S WORD on timing** (recommended: after Monday's open
proves the QQQ pair + alert paths live): `update strategists set executor='stream' where slug
like '%-manual';` (rollback per-slug to 'cron'). (2) **W3 QUOTES EXPORT BUILT + FIRST RUN
VERIFIED EXACT** — `npm run export-quotes` (scripts/export-quotes.ts): option_quotes per ET day
→ data/quotes-archive/<day>.json.gz (keyset-paginated on id — OFFSET pagination times out on
this table); all 6 in-DB days archived, row counts match the DB exactly (~3.5MB gz/day). **⚠ NEW
WEEKLY RITUAL: run export-quotes alongside export-bars at least every ~5 days — retention prunes
quotes at 7d and they are NOT reconstructable** (unlike bars). (3) OTP login bug confirmed dead
(AuthControl maxLength=10 fits Supabase's 8-digit codes). (4) `drop index idx_bars_symbol_ts`
(~14MB, redundant with the unique (symbol,ts) key — the 06-07 optional) BLOCKED by tool
permissions as unauthorized prod DDL — one SQL on the operator's word.

PENDING OPERATOR: twin migration timing (entry-push now built — see above). Month-end cuts:
PULLED FORWARD — the 06-12 cull; still on the month-end clean-era clock: power-smart-entries
(probation), the ALT-vs-V3 fold, the QQQ pair.

**WEEKLY-AUTOPSY OUTAGE — FOUND + FIXED (2026-06-13):** the 06-12 weekly report never generated
(operator caught it). ROOT CAUSE: one of the 06-06 edge-fn redeploys silently flipped
`weekly-autopsy`'s `verify_jwt` ON; its Friday cron (`seve-weekly-autopsy`, `15 20,21 * * 5`)
passes a SERVICE_ROLE bearer that the edge gateway 401'd (daily-autopsy + paper-trader run
verify-JWT OFF → spared; anon passes either way, service_role didn't). SILENT because the cron's
`net.http_post` logs "succeeded" on ENQUEUE, not on the function's 401. Worked 06-05 (pre-redeploy),
broke the next Friday. FIX: (1) BACKFILLED the missing report via `curl -X POST …/weekly-autopsy
-d '{"weekEnd":"2026-06-12"}'` (the body param skips the Friday-only self-gate; anon bearer → 200;
Opus narrative, ~73s) — week 06-08→06-12 now in `weekly_reports` (+$1,795 realized / −$2,031 NAV /
229 trades). (2) operator toggled `verify_jwt` OFF in the dashboard (confirmed: no-auth POST → 200
+ get_edge_function `verify_jwt:false`). **⚠ DEPLOY GOTCHA: weekly-autopsy is paste-deployed — any
future dashboard redeploy MUST keep "Verify JWT" OFF** (the editor defaults it ON), else this
recurs. Same rule already implicit for daily-autopsy + paper-trader. Diagnostic recipe for any
"cron fn ran but no row": check edge-function logs for 401/4xx (the cron run-details will lie
"succeeded"), then compare `verify_jwt` across sibling cron fns.

**WEEKLY-AUTOPSY GENERATOR REWRITE (2026-06-13, operator review "does this help a human?"):** the
report read impressive but half-trap. Deployed `weekly-autopsy` **v7 (banner 2026-06-13c)** in
three passes (all verify-JWT OFF, MCP deploy + smoke-test + {weekEnd} regenerate of 06-12 each
time): (b) **DOCTRINE + ROSTER-AWARE** — SYS prompt now carries the desk's settled findings (MFE
is an inflated upper bound, ride the convex tail, don't chase capture, one week is noise); digest
adds per-channel `scalp` (capture board excludes scalpers — killed the "$60k grind-manual leak"
mirage) + `liveStatus` + `roster` (stops it re-recommending the cull); LLM channel list de-duped.
(c) **EXIT-LOGGING TEMPORAL GUARD** — the v13b report cried "system bug: fix exit logging" but it
was a FALSE ALARM: `close_reason` shipped 06-11 eve so 4/5 of the week predates it (06-12 = 34/34
stamped, prior days 0/195 — NOT a bug, investigated to the row). Guard: digest self-calibrates an
anchor = earliest stamped exit, tags each channel `exitLogging.status` (ok/legacy/gap) +
`exitLoggingHealth`; the LLM flags a logging bug ONLY for `gap` (post-feature NULLs). Generalizes
to any future mid-window feature ship. **close_reason is HEALTHY** — the regenerated 06-12 report
now states that plainly. Repo file = full source of record; deployed = condensed (logic-identical,
banner trimmed for the inline MCP paste). ⚠ paste-redeploys must keep Verify-JWT OFF.

**UNIFIED CHANNEL NAMING (2026-06-13, operator: "breakout-smart-entries vs BREAK(ALT) is
confusing — reference the chosen name across the system"):** the autopsy LLM was the lone violator
(UI strips/positions/man-vs-machine already resolve slug→name). Rule now: **`name` is the single
human-facing label; `slug` stays an invisible internal key** (order IDs, worker resolution, your
SQL). Done: (1) **weekly-autopsy v8 (2026-06-13d) DEPLOYED + regenerated** — SYS OUTPUT NAMING
rule; rendered narrative + exit lists + skeleton headers resolve slug→name; verified the prose now
reads "BREAK(ALT)", "GRIND(MANUAL) ✋", "Power Final 30" etc., zero slugs. (2) **day-report CLI**
(`scripts/day-report.ts`) prints names (selects `strategists(slug,name)`). (3) **daily-autopsy
(2026-06-13a) — COMMITTED, ⚠ NEEDS PASTE-DEPLOY** (365-line file, too big for a safe inline MCP
paste): same fix (SYS rule + render maps slug→name in channel headers / finding evidence / finding
channel tags; slug kept in channels[].slug + systemFindings[].channels[] as the join key). Paste
`supabase/functions/daily-autopsy/index.ts` into the dashboard editor (Verify-JWT stays OFF) before
Monday's close so Monday's daily uses names. (4) **daily-autopsy PASTE-DEPLOYED by
operator → v12 live** (verified: deployed content == repo, banner 2026-06-13a). (5) **CLI MIRRORS
RETIRED (operator's word "retire the duplicates")** — `engine/autopsy.ts` + `engine/weekly-autopsy.ts`
were a drifting ~300-line re-implementation; replaced with THIN READ-ONLY CLIENTS that print the
canonical stored report (`daily_reports`/`weekly_reports.markdown`) the edge fn generated.
`npm run autopsy`/`weekly-autopsy` now: default = print latest; `--date`/`--weekEnd` = a specific
one; `--regen` = POST the edge fn to (re)build first; `--json` = raw digest+narrative. ONE source
of truth (the edge fns), zero future drift. Verified: weekly client prints v8 unified-naming
report; `npm run autopsy -- --date 2026-06-12 --regen` rebuilt via v12 → clean names. Edge fn
header comments updated ("Mirrors…" → "THE CANONICAL GENERATOR"). The anti-drift note for future:
the edge fns are the source of truth; never re-create a parallel local aggregator.

**DATA REFRESH (operator's word, same night):** bars archive exported →06-12 (both tickers) +
**Databento NBBO refreshed →06-11** (SPY 23,098 + QQQ 28,736 quote-bars; pennies). **⚠ 06-12
NBBO is EMBARGOED** — Databento historical OPRA serves only >~T+1 (403 `license_not_found_
unauthorized` past 2026-06-12T13:30Z); **fetch it before Monday's mfe-drift run:**
`npm run backfill:databento -- --from 2026-06-12 --to 2026-06-12 --underlying SPY` (and QQQ).

## SESSION HANDOFF — 2026-06-11 LATE (W2/B3 STREAM MIGRATION) — prior
**W2 = move channels off the cron onto the Railway stream executor (operator's word:
"migrate all even QQQ"). DONE TONIGHT: all 9 armed SPY MACHINE channels flipped to
`executor='stream'` (joining grind-v3 → 10 on stream); the worker is now MULTI-SYMBOL
(`stream-2026-06-11b`, commit `188c593`, heartbeat verified beating 6s fresh).** The cron
(v55) defers them via the fresh `'stream'` heartbeat — NO cron redeploy (it reads the
per-channel `executor` flag). Desk was flat (EOD) so the switch stranded nothing.

**ON STREAM (10):** breakout, breakout-alt-v3, breakout-smart-entries, grind-smart-entries,
grind-v3, orb-spy-trail, orb-trend-rider, power, power-final30, power-smart-entries.
**STILL ON CRON (7):** breakout-qqq, orb-qqq-trail, qqq-thrust-trail (QQQ machine — SHADOW
GATE, below); breakout-manual, grind-manual, power-manual, qqq-thrust-trail-manual (manual
twins — need the worker entry-push, below).

**MULTI-SYMBOL WORKER (the B3 enabler):** was single-symbol (`ownedBy` required
`underlying===config.symbol`). Now: `config.symbols` (default `SYMBOLS=SPY,QQQ`); ONE Alpaca
data socket (the 406 single-connection limit) subscribed to all symbols, `onBar` routes by
`bar.S`; per-symbol `BarStore`/`ChainStore` maps; `cycle()` does account-wide reads ONCE
(positions/orders/openRows — OCCs are globally unique so the netting maps are shared) then
loops symbols with a per-symbol ctx + own bar-freshness; `occSymbol` uses `ch.underlying`.
STRICT generalization — one symbol == today's behavior, so the live SPY/grind-v3 path is
preserved. Worker typecheck clean; runs via `tsx` (no build step).

**⚠ QQQ SHADOW GATE (why QQQ execution is NOT flipped yet):** the cron's executor gate keys
off a SINGLE `'stream'` heartbeat. If the worker is alive for SPY but silently can't handle
QQQ (bad sub / chain miss), the cron would DEFER QQQ channels (heartbeat fresh) while the
worker no-ops them → STRANDED QQQ positions. So QQQ execution flips ONLY after one clean
shadow open proves the worker handles QQQ — the same shadow-before-live gate grind-v3 passed.
The worker SHADOW-decides QQQ every cycle now (QQQ channels stay `executor='cron'` → cron
keeps executing them, zero gap) — tomorrow's open is the proof.

**MORNING WATCH (06-12 open) — W2 validation, IN ORDER:**
1. **Railway boot log** must read `subscribing bars SPY,QQQ` + `seed[QQQ]: N bars`. If it
   says SPY only, Railway has `SYMBOL=SPY` pinned → **set `SYMBOLS=SPY,QQQ`** (takes
   precedence) + redeploy. (SPY migration is UNAFFECTED either way — the worker owns SPY.)
2. At open: cron logs `stream_owned` skips for all 10 SPY stream channels; worker logs
   `stream:` execs/fills for them. First-ever MULTI-channel stream session.
3. The 10 SPY channels book CLEAN — `npm run day-report -- --date 2026-06-12` coverage ✓ +
   NAV-vs-attribution reconciles (watch stream-vs-stream shared-OCC netting, e.g. V3+ALT on
   the same 13:30 break OCC — the one path grind-v3-alone never exercised).
4. Worker SHADOW-decides QQQ channels in the logs, matching the cron's actual QQQ fills =
   the green light to flip QQQ.
5. **⚠ gap_min FAIL-CLOSED CHECK (CRITICAL — V3/ALT are now gap-gated):** every stream entry's
   rationale carries `detail.gap` (worker `c`). Query `select rationale->>'gap' from signals where
   acted_on and created_at::date='2026-06-12'` for ANY stream channel. NON-NULL → the worker computes
   gap → V3/ALT gating is sound. NULL / no stream entries showing it → worker can't compute gap →
   **V3/ALT are SILENTLY HALTED → run the gap_min ROLLBACK** (in `gap-regime-verdict.md`). The desk
   takes many entries across 10 stream channels daily, so there WILL be a rationale to inspect.

**CALENDAR AWARENESS — FOMC 2PM STAND-DOWN BUILT + LIVE (commit `cdf2923`, worker
`stream-2026-06-11d`).** `engine/market-events.ts` = FOMC decision dates 2024–2026 VERIFIED vs the
official Fed calendar (the reconstructed set had missed 3 dates); fail-safe (stale table = no events
= normal trading). Worker policy: on FOMC days inside [13:50, 14:30) flatten stream-owned holdings
(`event_flatten`; manual twins exempt) + block entries (`event_window`); `EVENT_STANDDOWN=0`
env-disables. Probe re-run on verified dates + COMPLETE data (bought the 8 missing FOMC days; all 18
in-corpus FOMC days covered): 2pm spike 2.82× localized; FOMC gaps 0.175% < calm 0.280% (gap_min's
literal blind spot — and most FOMC mornings read flat-open, so the armed gap_min already stands
V3/ALT down); ALT/V3's complete FOMC population = 7 trades, −694/t avg. **First live stand-down:
2026-06-17 (next Wed).** ⚠ the CRON has no stand-down — flip the QQQ machine to stream before 06-17
(expected after the 06-12 shadow proof) or it trades FOMC unprotected. **PER-CHANNEL posture (worker
`e`, `33_event_policy.sql` APPLIED, operator's architecture catch):** `strategist_config.event_policy`
— 'standdown' default (all 17 channels) | 'ignore' = per-channel opt-out for future event-native
theses (FOMC straddle, earnings vol); the worker honors it on both flatten + entry block. Events are
SYMBOL-SCOPED (`MarketEvent.symbols`, absent = market-wide like FOMC; a future NVDA-earnings event
lists ["QQQ"]) — so event reactions are channel- and symbol-specific, never hardwired global. QQQ
channels inherit the stand-down automatically when their executor flips to stream. EN-ROUTE FIND+FIX: the entire
2024-09 month was MISSING from the bars archive (a silent 07_backfill_bars failure, outside every
regime window) → NEW `npm run repair-bars-archive` (fills holes direct from Alpaca; post-W1 old bars
must never route through the 60d-retention DB); 2024-09 repaired (20 days).

**GAP_MIN — BUILT + ARMED on V3+ALT (commits `c224d03`/this — the night's research payoff).** The
overnight gap is a verified ex-ante regime signal (memory `gap-regime-verdict.md`): flat-open days
bleed, gap days pay for the breakout family; PASSES the 5-window bar AND is independent of OR width
(the first lead all session to survive). Built as a live `gap_min` condition (`|open−priorClose|/
priorClose ≥ pct`), threaded the pdh/pdl path, registered in every vocab list, worker computes it in
computeLevels. `npm run gap-min-selftest` reproduces the probe EXACTLY (ALT gap_min 0.25 → +252/t).
**ARMED gap_min 0.25 on breakout-alt-v3 + breakout-smart-entries (operator's word)** — both carry it
on both entry sides + the 14:00 window, verified; live via the stream worker next cycle. Armed BEFORE
the live gap-observability check could run (off-hours) — bounded risk (fail-closed = missed entries
not bad trades; one-SQL rollback) accepted; #5 above is the morning confirm-or-rollback. Worker `c`
(gap additive: computed + in every entry rationale). QQQ shadow gate from W2 unchanged.

**NEXT-SESSION W2 TAIL (after a clean 06-12):** (a) flip QQQ machine channels to stream
(`update strategists set executor='stream' where slug in ('breakout-qqq','orb-qqq-trail','qqq-thrust-trail');`)
once shadow-proven; (b) add the manual-twin entry-push to the worker (`firePush` mirror of
the cron's, needs `APP_URL`+`PUSH_SECRET` env on Railway) then migrate the 4 manual twins —
without it a migrated twin loses the proactive "✋ your exit" ping (exits still work: manual
close route is executor-agnostic, bell backstop catches a miss). ROLLBACK any channel:
`update strategists set executor='cron' where slug='…';` (cron resumes it within a cycle).
W3 = narrow ingest (option_quotes 94MB/7d now the dominant table); W4 = unschedule the cron
trader (full cutover) once the whole roster is stream-proven.

## SESSION HANDOFF — 2026-06-11 EVENING (CHANGE LIST EXECUTED) — READ THIS FIRST
**The after-market change list (items 1-4) is DONE + DEPLOYED (commit `b5cde0a`): cron v55
`2026-06-11a` (sentinel-verified), Railway worker `stream-2026-06-11a` (heartbeat verified
beating), Vercel pushed, migration `31_close_reason.sql` APPLIED via MCP.** Items 5-6 (arm
V3/ALT →14:00 + roster cuts) are PENDING THE OPERATOR'S WORD. Item 7 = the probe queue
(unchanged, needs Databento refresh first).

**DAY REPORT 06-11 (saved `docs/day-report-2026-06-11.txt`) — B1 VERDICT: PASS.**
NAV +$1,207, Σ attribution +$1,211 (Δ$4 — books clean). grind-v3 via the STREAM: 4 round-trips
+$347, fast target exits at 1-2m holds (the ~10s premium sweep banking +41%/+28% pops the cron
band would have quantized away), stops honored, no doubles, no ghosts. NOTE: grind-v3's RISK
knob is **$350** (not the $150 the prior handoff recorded — qty ×3/×4 matches $350 exactly, so
sizing was CORRECT vs config; the knob itself moved). Lockout cost quantified: **21 rejected
0DTE opens 15:32–15:43** (power-manual ×8, power-smart ×8, grind-manual ×5) — entries resumed
15:46 only because cutoff-16 finally rolled them to 1DTE. Day shape: SPY +1.32% / QQQ +2.51%
trend with whipsaw legs; 13:30 CALL cluster +$2,271 (one bet ×5), 13:04 PUT cluster −$687.
Top-3: power-smart-entries +1151 (⚠ CUT-LISTED, see below), BREAK(ALT) +828, V3 +744. Bottom-5
−$2,036: orb-trend-rider −695, grind-smart −426, power −385, orb-spy-trail −304, orb-qqq-trail
−226 (that last one is KEEP-list — the rest are cuts). Overshoots: 2 stops closed −67/−70% vs
−50% design (the known $315/mo cron-quantization tail).

**SHIPPED TONIGHT (all live):**
1. **`OPEN_0DTE_CUTOFF_MIN` 16→31** (cron + `worker/src/config.ts`) — entries inside the last
   ~30 min roll to 1DTE; the 06-08a same-day flatten still closes them at the bell.
2. **TERMINAL-STATUS FILL POLL** (cron `aOrderAndFill` + worker `orderAndFill` + the manual
   close route) — kills the partial-fill class: poll to a TERMINAL order status, CANCEL the
   working remainder after ~3s, book the FINAL `filled_qty`. Entries skip the row on a
   known-0-fill (no ghost); exits book the ACTUAL sold qty and leave the row open to retry on
   a known-0-fill (no phantom close). The route also books actual-sold (was booking sellQty).
3. **day-report COVERAGE section** — per-OCC account fills vs desk rows + live held-vs-open-rows
   audit (needs ALPACA_KEY/SECRET in .env.local — present). 06-11 re-run: ✓ clean 16 OCCs
   (the morning incident doesn't flag because the operator's SQL reconstruction already
   restored the row; live it would have read "account bought 2 / desk rows opened 1").
4. **`close_reason` dataset (31_close_reason.sql APPLIED)** — every exit now stamps durable
   attribution: machine reason (stop_premium/eod_flatten/…), `reconciled`, `manual` for an
   operator close, refined to `manual:<tag>` by the NEW post-close tag chips in PositionsPanel
   (target/reversal/risk/stall — they appear AFTER the fill books, zero friction before;
   desktop+mobile, shared component). day-report gained a PARTICIPATION section (taken =
   operator closed · skipped = bell backstop) — the operator-selection dataset. First read:
   **16/16 twin closes taken today** (he engaged everything; zero backstops). Trade drill-down
   now shows close_reason (✋-prefixed when manual).

**MORNING WATCH (06-12 open):** (1) entries 15:29+ ET roll to 1DTE with ZERO 422s; (2) first
manual ✕-close → the tag bar appears and the tap lands `manual:<tag>` on the row; (3) tomorrow's
day-report coverage section stays ✓ clean; (4) STREAM light green, `stream-2026-06-11a` beating.

**OPERATOR DECISIONS (resolved same evening — operator's word given in-session):**
- **Item 5 — ARMED ✓: V3+ALT entries→14:00.** Operator chose "arm both". Applied via MCP +
  VERIFIED: both spec_jsons carry 2 `time_before` entry conditions at 14:00, zero at 15:25,
  the 15:25 exit flatten (`timeET`) intact, both channels still `armed`. Cron-owned → live
  next cycle, no deploy needed. The desk's FIRST armed entry-side config (5/5-window PASS).
  Rollback: `update strategists set spec_json = replace(spec_json::text, '"et": "14:00", "kind": "time_before"', '"et": "15:25", "kind": "time_before"')::jsonb where slug in ('breakout-alt-v3','breakout-smart-entries');`
  WATCH: V3/ALT take NO entries after 14:00 ET (signals blocked `time_before`), morning
  entries unchanged.
- **Item 6 — roster cuts: OPERATOR CHOSE WAIT FOR MONTH-END.** No cuts tonight; the live A/B
  runs through the month boundary as originally planned. Context that informed it: today's
  receipts cut both ways — five of the list went −$1,834 (orb-trend-rider −695, grind-smart
  −426, power −385, orb-spy-trail −304, breakout −24), but **power-smart-entries was the
  DAY'S BEST channel (+1,151, 2/2)** and breakout-qqq +231. When the word comes, the SQL
  (mute = draft; exits still wind down; re-arm = status='armed'; pull slugs per keep calls):
  `update strategists set status='draft' where slug in ('power','power-smart-entries','power-final30','breakout','breakout-qqq','orb-spy-trail','grind-smart-entries','orb-trend-rider');`

**PROBE QUEUE RESULTS (same evening, after the change list — Databento refreshed →06-10
both tickers ~$0.40; outputs `docs/*-2026-06-11.txt`; new tools `npm run qqq-v3-probe |
level-gate-probe | confirm-delay-probe`; memory `probe-queue-2026-06-11.md`):**
- **QQQ-V3 port: NO TRANSFER — don't port, don't buy OOS windows.** 71 sessions Mar→Jun26
  real NBBO: QQQ V3(→14:00) −$23.5/t pooled −$1,035 (AprMay26 −$5,819) vs SPY V3 +$131/t
  +$4,585 SAME stretch. QQQ morning-only +$2,489 = one hot Jun split (mirage shape).
  Incumbent builtin ORB −$8,817 re-confirms the breakout-qqq cut. Bonus: SPY →14:00 beats
  →15:25 in-stretch — corroborates last night's arm.
- **Level-context gating: REFUTED on the keep-list.** 320 sessions, nakamoto warmupLevels
  (pre-session, no look-ahead), pre-registered G1 room-to-run 0.10/0.20% + G2 at-level
  ±0.05%: EVERY gate lowers V3/ALT pooled (V3 +$15,995→+$8.8k/+$9.3k/+$5.8k), ORB flips
  negative. Rides want structure CROSSINGS, not avoidance; the $5 grid blankets the tape.
  Same grave as breakeven/late-gate/regime-gate. Closes "Nakamoto's lever = levels" for
  our channels.
- **Confirmation-delay: first entry filter to BEAT its mechanical control — still not
  wire-worthy.** power(base): persist-2m −$10.8k vs delay-veto-2m −$18.6k vs baseline
  −$27.6k → the persistence re-check is a REAL filter (+$7.8k over pure lag, n 537→353)
  but stays −EV 4/5 windows = harm reduction for a cut-listed channel. QQQ-Break: no
  filter signal. Don't wire either.
- **mfe-drift first real run:** 10/13 LOW-SAMPLE (expected, 11 live days); 3 DRIFTs all
  live-runs-HOT (breakout 52% win vs 34% model · power 56 vs 19, +$20 vs −$4/ct ·
  power-smart 62 vs 28) — model omits the giveback trail + daily latch, stretch favored
  leans. Month-end input, not action; power-smart counter-receipt #2.
- **Chop-router (brainstorm composition): REFUTED.** `npm run chop-router-probe` joins the
  Nakamoto phase2 daily P&L with day shape + the 10:30 gate score (313 sessions): the
  reversal book loses on EVERY day shape and 20× WORSE on whipsaw days (−$240.6/day at
  ≥5 legs vs −$12.1 trendy); its CHOPMIX-25-26 green was earned on that window's GO days
  (+$12,490 go vs −$4,715 no-go). Chop steamrolls BOTH directional shapes → the chop book
  must be SHORT-PREMIUM (theta fly, blocked on the Phase-B limit/multi-leg doors) or
  STAND-DOWN sizing, not a cleverer directional entry. Don't resurrect level-reversals
  for chop.

**RAILWAY FULL-STREAM COUNTERFACTUAL (06-11): net ≈ −$100±150 — execution P&L is NOT the
B2 case.** Quote paths prove both quantization events were GAPS, not drifts: 736C bid
2.15→3.61 in ONE minute through the +100% target (the cron's late exit banked ~$250-375
MORE than a 10s sweep would have); 726P 1.30→0.63 through the −50% stops (sweep recaptures
only ~$190 of the $230 overshoot). Lockout 422s = same broker wall both executors; clusters
= signal-level, executor-independent; bleeders get WORSE with speed (fill-lag). What the
stream actually proved today: grind-v3's 1-2m fast-target exits + the first CROSS-EXECUTOR
shared-OCC netting (stream grind-v3 vs 5 cron channels on 733C/726P, books Δ$4). B2 =
reliability + state; order per runbook — after month-end cuts, ALT then V3 last.

**W1 INGEST WIND-DOWN — EXECUTED + VERIFIED (same evening, operator's word):** the DB is no
longer the tape's archive. (1) **Full 1-min history exported** to `data/bars-archive/<SYM>/`
(`npm run export-bars`, per-ET-day JSON, verbatim rows; SPY 222,205 + QQQ 46,398 rows, counts
exact vs DB; gitignored; worst-case reconstructable from Alpaca via backfill-bars). (2)
**`engine/realsource.ts` + both backfill scripts read ARCHIVE-FIRST** (DB serves only the tail
from the last archived day; `SEVE_BARS_ARCHIVE=0` disables; no archive = original behavior).
**GOLDEN-VERIFIED** (`npm run verify-bars-archive`): pre-prune both paths byte-identical
(570/111 sessions, Σclose to the cent); post-prune overlap-identity + depth invariants PASS;
`qqq-v3-probe` re-run BYTE-IDENTICAL post-prune. (3) **Daily candles persisted**
(`daily_bars_hist`, 682/682 identical to the old view's output) + **`underlying_bars_daily`
view = live-window ∪ hist** → the chart's 3M/1Y/Max keep FULL depth forever (preview-verified,
Max renders 2024-02→now). (4) **Retention live** (`32_bars_retention.sql` APPLIED via MCP;
`seve-retention` cron now also upserts daily candles + trims 1-min >60d nightly). (5) **Pruned
+ VACUUM FULL: underlying_bars 65MB → 7.5MB · DB total 130MB** (was ~170). ⚠ NEVER re-run
`07_backfill_bars.sql`/`20_backfill_qqq_bars.sql` for history (they'd refill the pruned
window); run `npm run export-bars` at least every ~7 weeks (DB covers 60d, so the archive can
lag that long safely) and before any research that needs the freshest days from disk.
RATIONALE (operator, in-session): reliability + state + data consistency + storage runway —
and channels must succeed/fail on their signal, not on executor luck (the attribution-noise
argument; see the Railway counterfactual above). W2 = B2 channel migration after month-end
cuts; W3 = narrow ingest (option_quotes 94MB/7d is now the dominant table); W4 = full cutover.

## SESSION HANDOFF — 2026-06-11 (B1 LIVE DAY) — prior
**Next session opens with: (1) `npm run day-report -- --date 2026-06-11` (same-week constraint!),
(2) execute the AFTER-MARKET CHANGE LIST below.** [DONE 06-11 evening — see the section above.] The Railway stream executor ran its first live day
(grind-v3, $150); heartbeat + cron `stream_owned` deferral worked; full execution validation = the
day report. THREE INCIDENTS, all diagnosed, two fixed live:
- **Partial-fill race (NEW BUG CLASS, fix pending tonight):** grind-manual buy filled ×2 but
  `aOrderAndFill` polled a partial state → desk row recorded qty 1 → operator's ✕-close sold 1 →
  **1 uncovered contract rode unmanaged** (caught via Fund-vs-attribution gap +$58; row restored by
  operator-authorized SQL reconstruction; closed manually). Root cause: fill poll exits on first
  `filled_avg_price>0`, can capture partials. FIX (tonight): poll to TERMINAL status + re-read final
  filled_qty in BOTH cron `aOrderAndFill` AND `worker/src/alpaca.ts orderAndFill` (same transcribed
  pattern). On-demand audit exists: "check coverage" = Alpaca positions vs Σ open rows per OCC.
- **Spot display two-writer bug — FIXED+SHIPPED (`8870e0f`):** main poll's minute-ingest spot stomped
  the fast /api/spot live tick every cycle → price snapped backwards 30-50¢ every ~4s (operator
  caught it side-by-side vs TradingView). Now live-tick precedence; minute spot = fallback >15s quiet.
- **Alpaca WIDENED the 0DTE open-lockout ~15min → ~30min** ("contract expires soon, unable to open
  new positions" 422s from 15:33 ET — 27 min before close). Our `OPEN_0DTE_CUTOFF_MIN=16` rolls to
  1DTE too late → ALL 15:30-15:44 entries rejected (cron channels + manual twins; exits unaffected;
  account stayed flat — rejected ≠ filled, zero coverage risk). FIX (tonight): cutoff 16→31 in the
  cron draft + `worker/src/config.ts` policy, deploy via `npm run cron:deploy -- --yes` (pipeline
  CERTIFIED: revision-sentinel verify, v54 deployed via it).

**RESEARCH (committed `9dad6cc`, memory `entry-window-verdict.md`): the first entry-side config wins
to PASS the 5-window bar.** `hour-edge-probe`: V3/ALT edge = the 10:xx first-leg (V3 +$9.6k of
+$10.0k); **14:xx entries negative family-wide** (mechanism: ride needs RUNWAY — tail-capped by the
15:25 flatten). `entry-window-probe` validation: **ALT entries→14:00 PASSES 5/5 windows
(+$6.7k→+$8.6k); V3 →14:00 PASSES (+$10.0k→+$11.5k, +94/t)**. ORB midday rescue REFUTED (Mar26 chop
mirage) → cut list stands; power has NO rescue hour (482/522 trades bleed in its own window);
QQQ-Break red every hour. V3 morning-only footnote: all-5-windows-positive, half the trades, same
total (operator risk-preference alt, NOT armed). Also: cost-model Q&A — fees 4¢/side (Alpaca reg
pass-throughs), slippage 1 tick/side ON TOP of crossing real NBBO, live fill audit validates the
model; `spreadCrossFrac` exists for limit-order math but DON'T flip it until the stream's
marketable-limit ladder MEASURES real capture (Nakamoto's fill-at-trigger optimism = the cautionary
receipt).

**AFTER-MARKET CHANGE LIST (tonight, in order):**
1. `OPEN_0DTE_CUTOFF_MIN` 16→31 (cron draft + worker policy) → cron:deploy + git push (Railway).
2. Terminal-status fill poll (cron aOrderAndFill + worker orderAndFill) — kills the partial-fill class.
3. day-report: add account-vs-rows coverage-drift flag.
4. Close-reason tagging (tag-AFTER-fill chips, never friction before) + taken-vs-skipped participation
   logging — the operator-selection dataset (the scalp-twin verdict says selection is his compilable half).
5. ON OPERATOR'S WORD: arm V3+ALT entries→14:00 (one `time_before` edit in each spec_json, reversible).
6. Roster cuts (operator inclined, evidence final): power×3, base breakout, breakout-qqq, orb-spy-trail,
   grind-smart, orb-trend-rider → 17→~8 channels. Sooner than month-end is on the table.
7. Probe queue: QQQ-V3 port (refresh QQQ Databento ~$0.20 first), level-context gating
   (engine/nakamoto/levels.ts validated infra), confirmation-delay on adversely-selected entries,
   `npm run mfe-drift` first real run (refresh SPY Databento too — cache ends 06-01).

## SESSION HANDOFF — 2026-06-10 — READ THIS FIRST
Four threads: (1) **Nakamoto strategy audit COMPLETE** — his "Level Reversal+Breakout" ported
(`engine/nakamoto/`, golden 4,818 checks vs his verbatim python ALL PASS; all 32 live trades
reproduced) then judged on OUR stack: **NO EDGE** (313 sessions real NBBO: −$10.4k, −$5/t; zero-spread
−$3.9k → his kit's accounting flips the sign; WR 23–29% vs 28.6% bracket breakeven; confidence score
carries NO signal). Don't import entries. Memory `nakamoto-backtest-kit-assessment.md`. (2) **Chart UX
batch SHIPPED** (commit `c253463`): SPY↔QQQ switch re-arms autoscale + restores per-symbol view
(wall-clock-anchored), → LIVE chip, HOD/LOD on LVL, session separators + premarket tint (custom
primitive). Known quirk: 1D default window ≈200 bars (poll-vs-history race, pre-existing, ~3-line fix).
(3) **FILL-LAG VERDICT** (`npm run fill-lag-probe`, memory `fill-lag-verdict.md`): latency is NOT the
prize — proven edges lose only $67–475 to the cron band over 313 sessions; the 180s missed-cycle CLIFF
is the real cost (reliability > speed); **the bleeders IMPROVE with lag** (power +$413, QQQ-Break
+$2.3k at 120s = adversely-selected entries — speed makes them WORSE). Live exits already fill at
design (25 stops avg −50.0% exactly; $315/mo tail). (4) **PHASE B EXECUTION BUILT** (worker
`stream-2026-06-10a`, inert until turned on): the Railway worker can now place orders for channels
with `strategists.executor='stream'` (30_executor_cutover.sql APPLIED via MCP) behind a TWO-KEY env
turn (`DRY_RUN=false` + `LIVE_TRADING=true`); full cron defense stack transcribed (fill-net booking
04a, actual-qty 09c, sell-min+reconcile 09b, anti-ghost 09d) + stateful entry context + fast premium
exits (~10s) + `worker_heartbeat`. Cron draft → **`2026-06-10a`** (executor gate: skip stream channels
while heartbeat fresh; EXIT-ONLY failover when stale) — **⚠ PENDING PASTE-DEPLOY** (verified deployed
09d == repo HEAD byte-identical pre-edit, so the paste is exactly the +26-line gate). Cutover runbook:
`docs/streaming-worker.md` (B1 = flip `grind-v3` first). ALSO: consultant review in chat — roster
17 armed is over-diversified; tier the risk (V3/ALT + manual twins up, power family cut at month-end);
DB 173MB (export-then-prune plan); manual grind twin is +$1.9k/57 trades live (the operator's edge is
real and measurable). Prior handoffs below.

**LATE-NIGHT ADDENDUM (same session): B1 IS ARMED + new ops/analysis stack.** (1) Cron `2026-06-10a`
deployed (v54) — now via **`npm run cron:diff` / `cron:deploy`** (scripts/cron-deploy.ts, Supabase
Management API, `SUPABASE_ACCESS_TOKEN` in .env.local; revision-sentinel verify because the API serves
transpiled ESZIP — paste workflow RETIRED). (2) **Railway worker LIVE-armed** (DRY_RUN=false +
LIVE_TRADING=true set) with **grind-v3 executor='stream' at $150 risk** (knob fixed from $500) — the
B1 validation channel; stale-bar order guard added (restarts can't act on old bars); heartbeat
verified beating. Day-1 watch: STREAM light green on OPS·PRE-FLIGHT at the open, `stream:` events,
fill-net booking, `stream_owned` cron skips; kill test after first clean round-trip. (3) **Desk UI
batch shipped**: OPS·PRE-FLIGHT panel (stream/cron/exec/risk lights, desktop §03 + mobile sheet),
position rows get peak/giveback context line (amber ≥50% gave), "attribution" relabel, chart 1D
window fix. (4) **`npm run day-report [-- --date …]`** = deterministic daily forensics (tape shape/
whipsaw flag, NAV-vs-attribution, per-trade entry→peak→exit + MFE/giveback/exit-reason, cluster/
re-lean/latch flags) — replaces the LLM autopsy as numbers backbone; run SAME-WEEK (needs 7d quotes).
06-10 verdict: −$3.1k day = $3,775 given back from peaks on 6 green→red trades on a 20-leg QQQ
whipsaw; 11:12 P731 cluster = one bet ×5-6 channels (correlation, not direction, was the loss).
(5) **Operator manual-exit study + `npm run scalp-twin-probe`**: his exits have REAL 15-min timing
skill (+$1.5-2.6k saved vs holding 15m; 11/11 on breakout-manual) but cut $13k+ of 30-min tail; the
CODIFIED policy (grind entries + fast target/time exits, 8 variants) bleeds −$18..−$23/t across ALL
5 windows (~7k trades each) vs his +$33/t live → **the operator is UNCOMPILABLE at minute granularity
— the manual book is a legitimate channel (selection + intra-minute timing), not helicopter
parenting.** Next instrumentation: close-reason tag + participation logging (signals taken vs
skipped) so his SELECTION can inform machine entry filters.

## SESSION HANDOFF — 2026-06-09 — READ THIS FIRST
Exit-management deep-dive on the live roster (operator-driven). Investigated conservative take-profits →
exit schemes → the underlying stop → the QQQ trail → the power family. **Net: two LIVE changes shipped, plus
five new research probes.** Full writeup: memory `tier2-conservative-targets-verdict.md`. Prior handoffs below.

**LIVE CHANGES SHIPPED THIS SESSION:**
1. **Underlying stop ZEROED on the 3 ride channels** (`strategist_config.underlying_stop_pct` 0.20 → 0 on
   `breakout-smart-entries`, `breakout-alt-v3`, `orb-trend-rider` — config-only, applied via SQL, no deploy).
   The `npm run ustop-sweep` finding: the 0.20% underlying stop was HURTING these momentum/ride channels
   (whipsaws them out in chop + caps the convex tail). ustop 0 is best — backtest: BREAK(ALT) +1242→+6701,
   V3 +4815→+10016, ORB -8236→-2918. The −50% premium stop + cost gate + $500 daily-stop remain as backstops.
   ⚠ CORRECTION to a mid-session claim: the COST GATE is the helpful control, NOT the underlying stop.
   Rollback: `update strategist_config c set underlying_stop_pct=0.20 from strategists s where
   c.strategist_id=s.id and s.slug in ('breakout-smart-entries','breakout-alt-v3','orb-trend-rider');`
2. **Worker `2026-06-09a` DEPLOYED** (power gate-exemption removed: `COST_GATE_EXEMPT = new Set<string>()`).
   `npm run power-roster` refuted the exemption — gating HALVES power(base)'s bleed (−$32.5k→−$15.3k) by
   curbing its re-lean-every-bar over-trading (1373→619 entries) while the high-ATR convex tail still passes
   the gate (only ~$1.1k clipped from one window). All channels now cost-gated. Power roster NOT consolidated
   (operator kept all 3 power channels armed for the live A/B). NOTE: this paste also shipped the prior
   pending 06-08a/b/c (1DTE same-day flatten + manual-exit twins/push).
3. **P&L "Realized" over-report DIAGNOSED + manual close-position FIX (pushed → live).** The desk's
   "TODAY'S TRADES · REALIZED" + per-channel rows OVER-report vs the account (06-09: desk +$7.6k vs account
   NAV +$3.7k). Trust **Fund(today) = NAV-delta** (the headline already uses it); per-channel rows are
   relative attribution. Cause = shared-OCC: 4-6 channels net into one Alpaca lot, desk books per-row.
   Dominant leak was the **manual close-position API** booking `(fill−entry)×pos.qty` off a mark on the FULL
   row qty (54 manual closes = +$3.4k phantom). FIXED (`app/api/close-position/route.ts`): book on the
   actually-sold `sellQty`, $0 if the lot's already gone. Memory `pnl-realized-inflation-fix.md`.
4. **SHARED-OCC EXIT TRAP + LEDGER ACCURACY — Worker `2026-06-09b` + `2026-06-09c` DEPLOYED.** The real bug
   behind the stuck ORB 726P (+$700→−$700, couldn't exit): when channels share an OCC, Alpaca nets one lot;
   a sibling (often a manual ✕-close) drains it, then a channel's exit sell is REJECTED (403 cash-secured
   put) and the OLD code looped the rejected sell EVERY minute → rode to expiry trapped. **NOT the ustop
   removal** (the stop fired; the sell was rejected). **09b:** sell only `min(held,row)`; if can't sell,
   reconcile-close at fill-net (never loop). **09c (de-dup, after operator REJECTED strike-nudging [agility]
   + 17 separate accounts [infeasible]):** keep same ATM strike / one account, make the per-channel ledger
   accurate so each sells only its own share — (1) entry records ACTUAL filled qty (not intended) → kills
   Σ(rows)>Alpaca-net drift; (2) per-OCC `remainingByOcc` counter for within-cycle sell coordination. Honest
   limit: a sell still reduces the shared lot, so non-interference depends on ledger accuracy (1+2 + 09b floor);
   truly-impossible needs separate OCCs/accounts (rejected). Manual twins KEPT (operator's manual edge is real).
5. **GHOST-RESURRECTION fixes — manual close-position slug-tag (Vercel, live) + Worker `2026-06-09d` DEPLOYED.**
   Two more shared-OCC manifestations: (a) a manual ✕-close showed a position "opening" instantly deep red at a
   STALE entry, and (b) auto channels (orb 735P) booked $0 on a +90% mover. ROOT: a channel whose contracts
   were sold by a SIBLING (rejected own exit, or a manual close tagged `manual-<occ>-` the worker couldn't see)
   has a filled buy with NO matching sell → net stays long → the reconstruct/re-buy guard RESURRECTED a ghost
   row at the stale entry every cycle. FIXES: (a) close-position API now tags its sell `<slug>-<occ>-` so the
   worker nets it (no manual ghost, correct realizedToBook); (b) **09d** gates the reconstruct — only resurrect
   if Alpaca holds UNCOVERED contracts (held − other channels' open rows, via cycle-start `openRowQtyByOcc`);
   else don't ghost/re-buy (`liquidated_elsewhere`). Preserves the runaway-rebuy safety. **FULL SHARED-OCC
   DEFENSE STACK now live: 09b (no exit loop) + 09c (ledger accuracy + within-cycle sell coord) + close-position
   slug-tag + sellQty + 09d (no ghost).** Memory `pnl-realized-inflation-fix.md`. WATCH: no "recovered … lost
   insert" lines following a close = working.
6. **CROSS-DEVICE CONFIG SYNC (Vercel, pushed → live).** Bug: mute/solo/kill/knob on mobile didn't reflect on
   desktop until a reload — the config is GLOBAL in the DB (writes always persisted) but `DeskProvider` hydrated
   ONCE on mount with no listener, AND `06_realtime.sql` didn't publish the config tables. FIX: (a) `DeskProvider`
   now subscribes to realtime on `strategist_config`/`strategists`/`fund_state` → debounced, idempotent
   re-hydrate (re-reads DB truth, own-echo is a no-op); (b) `06_realtime.sql` adds those 3 tables to the
   `supabase_realtime` publication — **already applied to the live DB** (no SQL to run). Covers the MASTER strip
   too (KILL/START-STOP/paper-live sync live across devices). Graceful fallback: writes persist + reload picks
   them up if realtime drops. One surface (`PositionsPanel`, `useDeskWrite`, `useDeskFeed`) is shared desktop+
   mobile, so all of today's fixes are inherently on both — only the desk-config SYNC needed wiring.

**KEY VERDICTS (don't re-litigate — all real-NBBO, 5 windows):**
- **RIDE the convex-edge channels (BREAK ALT/V3); don't target/scale/trail them.** They're +EV live with the
  cost gate; every take-profit/scale/breakeven/trail CAPS the tail (the edge is one big window, CHOP-MIX
  25-26 +$8k). V3 ride is the desk's only clearly +EV config. The original conservative-take-profit agenda
  (+30/40/50) = the mechanical mirage; +100/BE was the WORST scheme tested on every channel.
- **The scale+BE+trail scheme (operator's) only helps the tail-less weak channels** (best on QQQ-Break-ORB,
  ≈breakeven) — and ~85% of that is the managed EXIT-ENGINE, not the scale-out.
- **QQQ-Break-ORB** runs the builtin bare ORB (base-slug); its dormant spec_json entry is WORSE (refuted).
  The deployable lever is a tighter ARMABLE chandelier (k=1.0, not the builtin's 1.5): −5829→−1719 (~breakeven).
  NOT shipped (needs a worker change to attach a trail to builtin channels, or a compiled rebuild) — parked.
- **The power family is the desk's biggest bleeder** (base/final30/ALT all −EV, correlated final-hour leans).
  Gate-exemption removed (above). Consolidation (mute base+ALT, keep Final30 = least-bad) offered but DEFERRED
  to the live A/B. Builtins run VWAP-OFF live (the per-bar VWAP bug); ALT's vwap_side is degraded live too.

**ENGINE CHANGES (additive, default-off — existing backtests byte-identical; golden test passes):**
- `simulateSession(…, underlyingStopPct?, entryCostGate?)` + `stepManaged(…, underlyingStopPct)` — mirror the
  worker's 0.20% underlying stop + COST_GATE_RATIO so probes can model live conditions.
- Fixed a latent crash: the managed entry called `costGatePass(q!)` before the `if(q)` guard → an undefined
  QQQ quote crashed once `management.costGate` was set.
- NEW probes: `npm run tier2-probe | exit-scheme-probe [--live --daily-stop] | ustop-sweep | qqq-trail-ab |
  power-roster` (outputs saved under `docs/*-2026-06-09.txt`).

## SESSION HANDOFF — 2026-06-08
LIVE A/B week underway: **13 channels armed+unmuted** (base grind disabled). Prior handoffs below.
Two UI fixes shipped this session: cross-ticker position-mark freeze (`hooks/usePositionMarks.ts` —
marks ALL open positions off their own ticker's quote+spot, chart-independent) and per-channel Equity
P&L now uses the SAME live marks as Open Positions (`channelPnl(positions, liveMarks)`); plus the
composer group/add-channel button contrast+size fix.

**LIVE A/B — Day 1 (Mon 06-08): NAV +$792.** BUT the day **peaked +$2,560 at 15:26** and gave back
~$1,770 into the close — the GIVEBACK, not the close, is the lesson. POWERHOUR(base) channel-of-day
+$893 (the 15:01 741P final-hour put lean peaked +$1,189, banked +$694); QQQ trio all rode the SAME
720C up-break (+$657 combined); BREAK(base) +$384; **BREAK(ALT)/V3 took ZERO trades** (selective —
V3 STILL has no live data point); GRIND(ALT) −$780 + ORB(base) −$492 (the known weak/high-tail hands).

**EXIT-REFINEMENT MODELING AGENDA — the "what could have been" (MODEL next session, NO live changes yet):**
1. **Breakeven-once-in-profit stop — MODELED → DON'T WIRE (resolved this session).** The thesis (stop→entry
   once up ~+30% saves the green→red round-trips WITHOUT capping the tail; hypothetical +$792→+$2,000) does
   NOT survive systematic backtesting. BUILT (kept as tools): backtest `--breakeven <pct>` (+`--breakeven-lock`,
   layers onto ANY strat like `--trail`), threaded through montecarlo, + `npm run breakeven-probe`
   (engine/breakeven-probe.ts). Why it was never isolated before: power-probe only ever engaged breakeven at
   **+100%** (tail protection) — never the LOW threshold the thesis needs. 5-window real-NBBO sweep (be30):
   **power HURTS in 4/5 windows** (CHOP-MIX −$4,018), **power-final30 a wash** (2 help / 2 hurt), **breakout a
   NO-OP** (its own exits get out first; the live "ORB 741P" round-trip is a trail-config ORB, not built-in
   breakout). MC smoking gun: in TREND it **CAPS the upside** (AprMay26 p95 +$858→+$372) — **refutes "tail
   intact"** (winner retraces to entry → breakeven exit → trend resumes without you); in CHOP it helps
   (Mar26 p50 −$3,284→−$2,586, lower DD) but never flips to profit (100% P(lose)). A **chop-only tool with no
   ex-ante regime signal** — same fate as the trail + the morning regime gate. Verdict: keep ride-to-close +
   −50% prem stop as the robust default; don't add breakeven to the worker. Full writeup: memory
   `breakeven-stop-verdict.md`.
2. **Late-leans gate — MODELED → DON'T WIRE (resolved this session).** Thesis: power over-trades the
   whipsawy final 20 min (after the 15:26 peak it kept opening wrong-way leans 739P/739C/740C →
   −$216/−$82/−$80/−$40); cap late re-entries (one-and-done). BUILT (kept as tools): backtest
   `--late-cutoff <min>` + `--late-max <n>` (final-min entry cap, layers onto any strat), threaded through
   montecarlo, + `npm run late-gate-probe` (reports **exp$/trade**, the mechanical-vs-real tell). 5-window
   real-NBBO verdict: the benefit is a **MECHANICAL MIRAGE** — the one-and-done shows big P&L "gains" in the
   loss-heavy windows (MayAug25 power f60·1 +$13k) but **per-trade expectancy is FLAT-to-WORSE** (MayAug25
   −$54.0→−$54.1/t unchanged = 100% from cutting average trades; 2024 f60·1 −$29→−$76/t = KEPT the worst
   leans) and it **HURTS the one +EV window** (Mar26 −$3,438). It's just "fewer trades on a structurally −EV
   book," not a real edge that targets bad leans. ALSO the WRONG instrument: 06-08 over-trading was partly
   **CROSS-channel** (POWERHOUR base + ALT each leaning the same minutes — 739C/739P were DIFFERENT channels),
   which a per-channel cap can't fix → a ROSTER issue (de-dup the power channels), not an entry gate; and the
   live cost gate already suppresses marginal late entries. Validate-live, not backtest. Full writeup: memory
   `late-leans-gate-verdict.md`.
3. **1DTE flatten BUG — FIXED (worker `2026-06-08a`, repo; ⚠ PENDING PASTE-DEPLOY):** the late-day 1DTE
   (opened past the 15:45 ET / 12:45 PST cutoff) is meant to swing the high-volume last 20 min and
   **CLOSE SAME-DAY** — it was NOT closing. ROOT CAUSE (corrected — the prior note misdiagnosed it):
   `minutesToClose` IS session-based (`16*60 − etMin`), so the `eod_flatten` intent DID fire at the bell;
   a GUARD one step later nulled it for EVERY row whose contract expires after today
   (`String(row.expiration) > todayET → intent = null`). That guard meant to protect "genuine overnight
   swings," but NONE exist — every 1DTE here is a cutoff roll meant to close same-day → they all carried
   overnight. (2 stuck overnight Mon: PowerFinal30 739P + POWERHOUR 739C, both 06-09.) **FIX:** only exempt
   a position OPENED IN A PRIOR SESSION (`etParts(opened_at).date !== todayET`); a 1DTE opened THIS session
   now force-flattens at this session's bell. Applied to `index.dispatcher.draft.ts` (banner `2026-06-08a`,
   **user pastes into Supabase**) + mirrored in the Railway streaming shadow `worker/src/decide.ts` (parity,
   auto-deploys on push). NOTE: forward-looking only — the 2 already-stuck 06-09 positions become 0DTE Tue
   and flatten at Tue's CLOSE normally; closing them at the Tue OPEN is a manual call.
- **DON'T cap the big riders:** the giveback on POWERHOUR 741P (+$1,189→+$694) and the QQQ trio
  (~+$1,240→+$657) is the convex-tail PREMIUM — the MC verdict (don't profit-target/trail) stands. Only the
  Bucket-A round-trips are the avoidable target.

**FILL-QUALITY + RAPID-SCALP INVESTIGATION (resolved — "are we over-modeling / over-taxing scalping?"):**
Operator asked whether BS/MC engrained a long-range lens that misses the rapid in/out take-profit nature of
0DTE. 3 real-NBBO probes say no — there's no hidden scalp edge. **#1** `npm run fill-probe` (cost.ts
`spreadCrossFrac` + backtest `--fill-cross`, MC-threaded): real 0DTE spread is TIGHT (~$7/trade round-trip —
the "cost-doomed by spread" narrative came from MODELED 3% spreads); entries are **~zero-edge GROSS** (grind
−$0.4/t coin flip) → fills aren't the wall, entry edge is. **#2** `npm run mfe-probe`: the intra-trade pop is
real (~40% of leans pop +15%, lifts win% 15→39%) but a take-profit never flips a coin-flip entry +EV. **#3**
`npm run scalp-edge-probe`: on **BREAK(ALT)** (the one real edge) the edge IS the convex tail — +100% bracket
+$2,271 in Mar26, tightening caps it (+15% → −$56); pooled "looks" better tight only via the mechanical
loss-reduction on losing windows (same mirage as breakeven/late-gate). Verdict: rapid take-profit is the WRONG
SHAPE — edges are convex, not scalp; ride with a fixed bracket. **OPEN DOOR (premium-selling) — RESOLVED**
(`npm run theta-probe`): the untested non-directional angle. The vol-risk-premium is **REAL** (naked short ATM
0DTE straddle nets +$5..+$84/day across regimes — the market overprices the implied move) BUT the tradeable
defined-risk **iron fly is BREAKEVEN**: you must close the ATM body daily (SPY physical settle → assignment) and
that ATM 0DTE spread eats the theta (fly·REAL ≈ +$1/day; MC 291 days Sharpe 0.16, P(lose) 42.5%). The "+EV
held-to-expiry" was an artifact of free body settlement. ROOT (unifies the whole investigation): **the 0DTE
bid/ask spread on the legs you're forced to trade is the binding cost** — directional AND premium-selling alike.
One revisit lever: limit-order execution on the liquid ATM body close (needs limit + multi-leg infra + tick
data). Don't build as-is. Full writeup: memory `fill-and-scalp-verdict.md`.

**NEXT-SESSION AGENDA — CONSERVATIVE take-profits on the Tier 2 channels (operator thesis 06-09):**
The live "Tier 2" channels run ASPIRATIONAL premium targets — `orb-trend-rider` +75%, `breakout-qqq`
+90%, `power-smart-entries`/`breakout-smart-entries`[BREAK(ALT)]/`breakout-alt-v3` +100%. Operator's
point (correct, and data-backed): a **+30–50% move is the realistic "big winner," +75–100% is a unicorn**
— so those targets RARELY fire. The session's `npm run mfe-probe` MFE-survival curve confirms it: only
**~11% of lean trades ever pop +100%, ~21% reach +50%, ~30% reach +30%** → a +100% target fires ~1-in-9,
so for the other 8 it NEVER triggers and the channel **effectively rides to close** = gives back every
sub-target gain (Tier-2 ≈ Tier-1 in practice). AGENDA: sweep **conservative targets (+30/+40/+50)** on
each Tier 2 channel; report **hit% + per-window EV + per-trade expectancy** (the mechanical-vs-real tell).
Build on the existing tools — `npm run scalp-edge-probe` already sweeps +100/75/50/30/15 on BREAK(ALT)/V3,
`npm run mfe-probe` gives the hit% (= MFE survival). **KEY TENSION to resolve, likely a PER-CHANNEL SPLIT:**
scalp-edge-probe showed the genuine breakout EDGE *is* the convex tail (BREAK(ALT) Mar26 +100% = +$2,271,
tightening to +15% = −$56 — the tight target CAPS what pays), so **ride the real-edge channels
(BREAK(ALT)/V3); bank the weaker Tier 2 with no real tail** (ORB-base, QQQ-Break-ORB, POWERHOUR-ALT). The
earlier intermediate-target (+30/+50) numbers were single-window + noisy → needs the multi-window sweep +
hit-rate before trusting. Don't apply a blanket conservative target. See `fill-and-scalp-verdict.md`.

## SESSION HANDOFF — 2026-06-07
LIVE + pushed (`main == origin/main`, clean). This session: (1) mobile chart/P&L UI fixes,
(2) a Supabase storage audit, (3) a **bootstrap Monte Carlo toolchain** + a real-fills roster
study → ONE actionable channel (**BREAK(ALT V3)**, drafted, READY-TO-ARM) and a hard lesson:
**the backtest cannot rank the marginal power/grind channels — validate them LIVE.**

**SHIPPED (Vercel auto-deploys; commits on `main`):**
- **Mobile chart** (`cd440b1`): LINE/CANDLES moved to the bottom row beside the indicator chips;
  duration (top) over candle-interval (bottom), right-justified; **interval active = red** (`--red`
  — fixed a latent source-order CSS bug so it's distinct from blue duration, desktop too); SPY/QQQ
  top-aligns with the duration row; **mobile vitals LEFT LED = FUND $ (NAV)** not SPY price,
  green/red by day direction (SPY price still on the chart's embedded LED).
- **P&L·Equity hover** (`c631cb6`): Week/Month/All hover Δ now shows **that day's P&L** (segment Δ
  vs prior point) + a **date label**, not the cumulative-since-window-start it showed before (which
  made Fri read the whole week). Today keeps running-since-open. `LineChart` gained `segmentDelta`;
  `useWindowedPnl` returns `curveLabels`.

**NEW RESEARCH TOOLCHAIN (`25f14b2` `107c127` `c00a330` `924e1ca`):**
- **`npm run montecarlo -- --strat <slug>`** (`engine/montecarlo.ts`) — bootstrap Monte Carlo over a
  channel's REAL-fill daily P&L. Block bootstrap default (B=5 sessions, preserves regime clustering;
  `--mode iid` to contrast), 10k paths. Prints terminal-P&L dist (p5/p50/p95), P(period<0), max-DD
  dist, P(daily-stop breach), a percentile cone. Flags: `--from/--to --days --underlying --spec --n
  --block --horizon --stop --capital --seed --json --in`. Sources trades by shelling to the backtest
  with new **`--emit-trades <path>`** (backtest stays the single trade generator; MC never re-sims).
  `--in <log>` reuses an emitted log.
- **`npm run mc-roster`** (`scripts/mc-roster.ts`) — auto-discovers the armed+unmuted roster from the
  DB, routes built-in (`--strat`) vs compiled (`--spec`, by the worker base-slug rule), auto-detects
  real-vs-modeled fills per ticker (Databento cache present?), MCs each over a FIXED window, prints a
  ranked SPY/QQQ table. Reproducible weekly re-run.
- **backtest `--from/--to`** — pin a FIXED ET-date window (reproducible; `--days` anchors to
  `Date.now()` and drifts the boundary session between runs).
- **Databento `--underlying`** (`c00a330`) — `backfill-databento.ts` + `databentosource.ts`
  parameterized per ticker (was SPY-hardcoded: osi root, underlying_bars filter, OCC prefix, dir).
  `npm run backfill:databento -- --underlying QQQ` → `data/databento-qqq/`. Real QQQ NBBO now
  available (was modeled-only).

**MC FINDINGS (real Databento NBBO):**
- **BREAK(ALT) (`breakout-smart-entries`) = the desk's ONE robust edge** — only clearly +EV channel
  (p50 +$1,842, P(lose) 33%, Sharpe 0.83). Ablation: **`rel_vol≥1.3` is load-bearing** (drop it →
  −$47/trade; bare OR-break is a coin flip +$1/trade); **`efficiency_ratio≥0.45` kept as DRAWDOWN
  control** (dropping it raises median but blows p95 DD −$7.3k→−$10.8k); **`vwap_side` is REDUNDANT**
  (removing it is byte-identical → the live-worker VWAP bug doesn't hurt this channel); fixed
  +100%/−50% bracket > base's trailing stop.
- **BREAK(ALT V3) DRAFTED + READY-TO-ARM (`509e007`, `27_breakout_alt_v3.sql`)** = BREAK(ALT) minus
  the `momentum_atr` gate (MC: pure over-filtering → Pareto-better: p50 +$4,151, P(lose) 20%, p95 DD
  −$6,949, Sharpe 1.54). The SQL clones BREAK(ALT)'s settings (RISK $500 / STOP $500 / underlying-stop)
  for a fair live A/B, armed+unmuted, compiled-spec channel (no worker change). **⚠ NOT YET RUN — the
  USER runs the SQL to arm it.** `docs/channels/breakout-alt-v3.md`.
- **THE POWER/GRIND FAMILY IS UNRANKABLE ON BACKTEST** (the session's hardest lesson). Across 3 regime
  windows the best→worst ordering COMPLETELY SCRAMBLES, all mostly negative (p50):
  - CHOP Mar26:        power **+$1,998** · final30 −$3,284 · grind-v3 −$2,049 · grind-smart −$3,159
  - TREND AprMay26:    power −$830 · final30 −$1,389 · grind-v3 −$3,856 · grind-smart −$1,401
  - TREND-OOS MayAug25: power −$5,808 · final30 −$5,202 · grind-v3 **−$4,625** · grind-smart −$6,380
  Last session's ordering (final30≈base, v3>smart) reproduces in MayAug25; THIS session's
  (base>final30, smart>v3) in Mar-Jun. BOTH real, NEITHER stable → **backtest can't settle these;
  validate LIVE** (vindicates the existing arm-and-observe design). DON'T swap power/grind on backtest
  evidence. (An "arm base power" idea was floated and RETRACTED — its apparent edge was March-chop luck.)
- Roster (Mar-Jun 2026, real fills): BREAK(ALT) only clear +EV; **QQQ-ORB-trail mildly +** (p50 +$662,
  Sharpe 0.44, real QQQ fills); **base BREAK dominated by ALT** (retire candidate); **ORB(base)/
  orb-trend-rider** near-zero edge but WORST tail DD (−$11.5k p95) → de-risk; power-final30 / grind-v3
  / QQQ-Break-ORB weakest (P(lose) 92-100%, **but UNGATED**).

**EXIT-MGMT + MORNING REGIME GATE (later this session):**
- **New backtest flags:** `--trail <k>` layers an underlying ATR-chandelier (peak−k·ATR, fires
  only on a "hold" bar once in profit) onto ANY strat without forking it; `--trail-until <min>`
  gates it to `minutesToClose > min` — a CLOCK-PHASED exit (protect early, ride the final stretch).
  montecarlo threads both + now uses a **pid-suffixed temp file** (same-strat exit-variant sweeps
  no longer collide on `seve-mc-<strat>.json` — that bug silently returned a prior variant's emit).
- **Power exit is REGIME-DEPENDENT — DON'T wire a fixed trail:** ride-to-close vs ATR-chandelier —
  trail WINS in chop (Mar26 p50 +$1,998→+$2,485), ride WINS in every trend window. The clock-phased
  exit (trail k=2.5 until the final 20 min, then ride the MOC surge — power-hour volume RAMPS
  3.4k→4.8k→13.8k/min across the 3 phases) is the BEST chop exit (p50 +$2,543, P(lose) 17%, Sharpe
  2.54) but ties the plain trail in trend. **Ride-to-close stays the robust regime-agnostic default**;
  the phased trail is a chop-ONLY tool with no way to know it's a chop day ex-ante — UNTIL the gate ↓.
- **MORNING REGIME GATE — the breakthrough (OOS-VALIDATED, NOT YET WIRED):** the desk's perennial
  "regime-aware allocation" lever, finally with a signal that holds out-of-sample.
  - **efficiency-ratio FAILS** as a regime classifier — intraday SPY is choppy nearly EVERY day
    (full-day 1-min ER 0.04–0.07 across all buckets → no intraday-trend variation to detect;
    corr(morning-ER, day-ER)=0.28). The signal everyone reaches for is the wrong one.
  - **What WORKS: morning NET DRIFT (|open→10:30 move|, spot-normalized) + VWAP PERSISTENCE (frac of
    the first hour price holds one side of cumulative VWAP)**, both knowable by ~10:30. High-drift
    mornings flip breakout +EV (+$27, 31% win vs −$60/−$102); high-persistence → power-ride +$39 /
    breakout +$7. corr modest (0.19–0.24) but the BUCKETS flip strategies positive.
  - **The GATE = skip the chop mornings** (combined drift+persistence percentile score < 0.5 → no-go,
    don't trade that session). **OUT-OF-SAMPLE (fit threshold on one window, apply blind to the other,
    BOTH directions):** 2025→2026 breakout −$1,229→**+$1,841**, power +$763→**+$2,687** (flips to
    PROFIT); 2026→2025 breakout −$5,460→−$2,125, power −$5,768→−$2,304 (HALVES the loss). In-sample MC:
    halves drawdowns, P(lose) ~90%→~50%, both to ~breakeven. **The FIRST regime lever that survives
    OOS** (ER never did). go-days beat no-go in all 4 cases.
  - **HARDENED → TEMPERED (4-window leave-one-out, 2024-trend / 2025-trend / chop / 2026-mixed):** the
    2-window result OVER-SOLD it. Gated beats ungated in ALL 4 OOS windows (aggregate breakout
    −$15,436→−$3,959, power −$13,693→−$2,560) and go-days beat no-go in **7 of 8** holds (direction is
    right). BUT it only flips to actual PROFIT in the 2026 window; elsewhere it just LOSES LESS — and
    much of that is MECHANICAL (gate trades ~half the days, channels are −EV, so fewer days = less
    loss). Genuine predictive edge is strong only in 2026 + 24-trend-power; weak in 25-trend/chop;
    INVERTED for power in the chop window. Verdict: **a real but MODEST, conservative risk-reducer that
    does NOT overcome a structurally bad regime — NOT a profit lever. DON'T wire it live.** The live
    cost gate already does some "trade less on bad setups" work. Park unless a refined signal/threshold
    (per-channel tuning, better features) lifts the edge meaningfully. The hardening (C) did its job —
    stopped a premature wire.
- **Data:** added SPY Databento **May-Aug 2025** (the OOS trend window) to `data/databento` (~116MB).

**METHODOLOGY CAVEATS (don't re-litigate):** backtest is **UNGATED** (the live cost gate softens
grind/power toward breakeven — the −$5-6k is worst-case, NOT live P&L); **monthly efficiency-ratio
≠ intraday 0DTE regime** (these strategies care about per-session character, not multi-week drift —
the "trend windows" picked by monthly ER were the wrong axis); **spot-level cost confound** (2025 SPY
~$600 is relatively more cost-walled than 2026 ~$720); each MC result is ONE window; the bootstrap
quantifies WITHIN-window sequence risk and is BLIND to regime shift.

**SUPABASE STORAGE AUDIT:** DB **145 MB / 500 MB** (user truncated `option_bars` → freed ~50MB; it was
a leftover research backfill that policy says to truncate). Drivers: `underlying_bars` 63MB (NO
retention, 2024→now — FEEDS `--source real` backtests, so don't prune carelessly), `option_quotes`
60MB (7d-bounded). `idx_bars_symbol_ts` (14MB) is **redundant** with the unique `(symbol,ts)` key →
optional `drop index` reclaims ~14MB. **Only cap risk = research backfills (option_bars) — truncate
after use.** **Supabase MCP is now on the SEVE account** (was `matt@multifresh.com`) → can query
catalog/sizes directly. Local `data/databento*` (gitignored, ~860MB, re-fetchable ~$0.20/window,
`DATABENTO_API_KEY` present): SPY Mar-Jun 2026 + May-Aug 2025; QQQ Mar-Jun 2026; bulk `databento-mdte/`
= the 1DTE+ cache (kept for future multi-leg/reversal work).

**OPEN / TODO (next session):**
- **MORNING REGIME GATE — HARDENED (4 windows) → DO NOT WIRE.** The 4-window leave-one-out tempered the
  2-window result: real but MODEST (reduces loss in all 4 OOS holds, but only flips to PROFIT in 2026;
  elsewhere much of the gain is the mechanical "trade fewer −EV days"). NOT a profit lever — don't wire
  to the worker. Only revisit if a refined signal/threshold (per-channel tuning, better features than
  drift+persistence) lifts the edge. Backfilled SPY databento 2024-05/08 + 2025-11/2026-02 for this.
- **BREAK(ALT V3) is ARMED** (user ran `27_breakout_alt_v3.sql`) — watch the live A/B vs BREAK(ALT);
  if V3 leads across a trending stretch too, retire base BREAK.
- **13-channel head-to-head:** worker is channel-INDEPENDENT (per-channel `client_order_id`, no
  account-wide guard → two channels hold the same OCC, realized P&L attributed per channel), so an
  unmute-everything live A/B is clean. Leave base `grind` DISABLED (Sharpe −46, structurally cost-doomed).
  Read it as per-channel realized daily P&L (Desk → Week).
- **power/grind:** let the live A/B decide — backtest can't rank them. Don't swap on backtest.
- **grind-v3 RISK = $500** (should be ~$150 small-validation) — still unresolved from the prior handoff.
- Optional: `drop index idx_bars_symbol_ts` (~14MB).
- **Mobile** improvements were shelved mid-session (chart quick-fixes done; the rest deferred).

## SESSION HANDOFF — 2026-06-06
Everything below is LIVE + git is clean (main == origin/main). Next task = **mobile chart
quick-fixes** (user is doing them). Prior handoffs kept below for history.

**DEPLOY STATE (all deployed + verified):**
- **Worker `2026-06-05c`** (paper-trader, pasted): adds (a) config-gated **UNDERLYING INITIAL
  STOP** — new `strategist_config.underlying_stop_pct` (0=off); exits when the underlying
  moves X% against the reconstructed `entryUnderlying`, fires before the premium stop; **0.20%
  LIVE on `orb-trend-rider`/`breakout-qqq`/`qqq-thrust-trail`/`breakout-smart-entries`**, and a
  tighter **0.15% SHADOW** logged to events as `stream-shadow: US0.15…` (not traded — the A/B);
  (b) **`grind-v3`** (disciplined scalper: er-gate + 14:00 afternoon curfew + grind's fast
  fixed-target exit, NO trail); (c) **`power-final30`** (final-30-min momentum lean, no VWAP gate).
- **SQL run:** `24_underlying_stop.sql`, `25_grind_v3_channel.sql` (grind-v3 ARMED — ⚠️ its RISK
  landed at **$500**, not the intended $150 — dashboard knobs reset it), `26_power_final30_channel.sql`
  (power-final30 ARMED + base **`power` MUTED**).
- **Edge fns:** daily-autopsy **`2026-06-06a`** (Sonnet **claude-sonnet-4-6**), weekly-autopsy
  **`2026-06-05d`** (Opus **claude-opus-4-8** via `ANTHROPIC_MODEL_WEEKLY`). compile-strategy route
  also bumped to 4-6 (Vercel auto). **`claude-sonnet-4-5` is now LEGACY** (current = 4-6).
- **Live roster (armed+unmuted):** breakout · breakout-qqq · orb-spy-trail · orb-qqq-trail ·
  orb-trend-rider · qqq-thrust-trail · breakout-smart-entries · grind-v3 · power-final30.
  **MUTED:** power, power-smart-entries, grind, grind-smart-entries. **DELETED:** fade.

**KEY FINDINGS (this session — full detail in memory/):**
- **Autopsy was Frankensteining SPY+QQQ** (unfiltered `underlying_bars` read = SPY's open + QQQ's
  close → fake "SPY −6.2%") and NAV-truth was truncated at PostgREST's 1000-row cap. BOTH FIXED
  (per-symbol market split + `.range()` pagination). Weekly now reports SPY+QQQ regimes + `maxDrawdown`.
- **Real account week (06-01..05): NAV +$6,303, maxDD −$2,823 (−2.6%), peak capital ~$5,044.**
  Cash-to-run ≈ $8–10k mechanical floor (sizes by fixed RISK-$, not % of account).
- **MAE study → the 0.20% underlying stop**: it preserved every ≥5min winner (max winner dip 0.137%)
  while cutting ~⅓ of losers; the −50% premium stop fires at a VARIABLE 0.2–0.5% underlying move by
  option price. grind/power are gross-positive but cost-walled UNGATED; the live cost gate is what
  makes them ~breakeven.
- **⚠️ FADE-VWAP BUG (worker, latent — deliberately NOT fixed):** the worker reads
  `underlying_bars.vwap` (a PER-BAR vwap ≈ close) AS the session VWAP. fade needs a
  `close − vwap > 1.5·ATR` stretch → unreachable → fade never fired once in its life. It also
  silently degrades `power`'s `close>vwap` gate (→ noise) and any compiled `vwap_side`/`vwap_dev`
  channel. Left as-is because the disabled gate is a *feature* for power this week (counter-VWAP late
  leans win). fade DELETED (fade-v2 pure-VWAP-reversion also no edge). **If you fix it:** compute
  cumulative session VWAP in the worker's `buildMarket` (mirror `engine/realsource.ts` ~L147) and
  re-validate power (it loses its accidental edge).

**MOBILE REWORK (the session's big UI thread — all on Vercel):**
- Seam = shared data/logic (hooks) + native shells. NEW `hooks/useChannelOrdering.ts` (reorder/
  group-by, used by both surfaces). Chart cross-symbol spike fixed (`IntradayChart` forming-bar
  resets on symbol toggle + 2% bad-tick guard).
- **Mix tab REDESIGNED** (`components/mobile/MobileApp.tsx` + `MixerPads.tsx` + `ChannelStrip`
  `compact`/`onExpand` props + `app/mobile.css`): **4 compact cards/page, swipe to next 4**; TAP a
  card → full strip with big knobs in a sheet; a **master mixer** = small sortable colored pads
  (tap=jump to that channel's page, hold=drag-reorder); **+Add Channel is the last grid card**.
  Compact card: dot+title LEFT / P&L+ticker RIGHT, non-interactive indicator knob, green→red
  risk/stop meters, black $ amounts. P2 touch polish (coarse-pointer knobs less twitchy, bigger
  targets, chart interval selector now on mobile, fiddly EMA inputs hidden on phone). Dead carousel
  CSS swept. **Target device = iPhone 17 Pro = 402×874 px** (NOT 390).

**CHART-NEXT (the next session's task):** mobile chart quick-fixes. Chart = `components/IntradayChart.tsx`
(shared desktop+mobile via the `mobile` prop); mobile chart CSS lives in `app/mobile.css`
(`.m-app .chart-controls` + the P2 block). On mobile the chart is the Live tab's base panel
(CHART/CHAIN/POSITIONS additive toggles in `MobileApp`). The chart is `lightweight-charts` (see the
charting memory). **Pull `main` first.**

**OPEN / TODO (next session):**
- **grind-v3 RISK = $500** (should be ~$150 small-validation) — decide + set.
- **Lone add-page**: 12 channels = a multiple of 4, so +Add sits alone on page 4 (clean 120px card,
  empty below). Optional: suppress that page when the last channel page is full.
- **Validate Monday→Friday in the Opus weekly**: underlying_stop fills + `stream-shadow: US0.15`
  deltas, grind-v3 vs muted base grind, power-final30 vs muted base power → keep/retune; consider
  widening the underlying stop to more channels.

## SESSION HANDOFF — 2026-06-03 (Day 3 close)
Three deploy targets now: **Vercel** (auto on push), **Supabase edge fns** (PASTE-deploy
— I hand the user the file), **Railway** (the streaming worker, auto on push).

**LIVE + VERIFIED (Day 3):**
- **Real-time data:** Alpaca **Algo Trader Plus** is ON. `market-ingest` flipped to
  SIP+OPRA via env-driven secrets `STOCK_FEED=sip` / `OPT_FEED=opra` → the ~15-min
  options delay is GONE. `/api/spot` LED on SIP (env `STOCK_FEED`). (data-vendors memory.)
- **Cron `paper-trader` = LIVE paper-trading (`DRY_RUN=false`), version `2026-06-04a`
  (deployed 2026-06-03 eve)** — the SOLE live trader. RTH-only session bars (SIP streams
  pre-market bars that polluted warmup/ORB/VWAP). **P&L NOW BOOKS FROM MATCHED FILLS**
  (`realizedToBook`): 06-03b's book-at-fill alone STILL over-reported ~4× (06-03 broker
  proved it: desk +$2,114 vs account +$492) because shared-OCC mirror channels (power +
  power-smart) net the lot and the reconcile/reconstruct churn re-rows one round-trip many
  times, each re-booking the gain (P00755000: 17 rows/$1,169 vs broker $210). 04a books
  realized = the channel's fill-net (slug-prefixed `client_order_id`) − already-booked for
  that (channel,OCC) today → churn rows book $0, Σ desk realized == account. **VERIFY Day 4:
  `sum(realized_pnl)` over the session ≈ Alpaca `equity − last_equity`.** Confirm the
  deployed banner == `2026-06-04a`.
- **Streaming worker (3rd engine driver) DEPLOYED on Railway, Phase A SHADOW** — imports
  `engine/*` directly, holds SIP/OPRA + state in memory, decides each bar-close, places
  NO orders, lockstep with the cron. Also runs the **shadow MANAGEMENT what-if**
  (`worker/src/shadowManage.ts`). 1 replica only. (docs/streaming-worker.md.)
- **Manual close:** `app/api/close-position` (auth-gated, service-role, books real fill)
  + the ✕→✓ confirm button in Open Positions (desktop+mobile). Needs Vercel env
  `SUPABASE_SERVICE_ROLE_KEY` (SET). Verified in prod.
- **Console restyle:** 2×8 cream tape; cream channel strips / §03 log / §01 data tables;
  no screws/subtitle; chart + LED vitals + master stay dark; SPY chart has the LVL overlay.

**KEY FINDING (Day 3):** winners give back because exits watch the underlying/clock, not
the premium peak (STRATEGY, not wiring — verified). Per-channel exit management
(`engine/management.ts` `MANAGEMENT_BY_SLUG`, NOT global — `.md`-thesis home later) is
drafted but **DAY-DEPENDENT** (06-03 +$1071 / 06-02 −$636 via `npm run manage-ab`) →
matches the 63-session backtest → **NOT wired to any live trader**; it runs as the
streaming-worker shadow what-if to accumulate evidence. Power + grind-base stay
UNMANAGED (managing caps power's tail / bleeds grind cost). New tools:
`npm run exit-study | giveback-study | manage-ab`.

**PENDING / TO-DO:**
- Verify at the **06-04 open**: (1) cron's booked P&L reconciles to the account
  (`equity − last_equity`), (2) cron no longer fires pre-warmup (RTH fix), (3) shadow⇄cron
  lockstep, (4) first `MGMT` shadow events land — query `events` where `message like
  'stream-shadow: MGMT%'` (meta has `{managed,actual,delta,slug}`).
- Accumulate ~2–4 weeks of MGMT deltas → decide per channel whether to wire management
  into the cron live (then move each block into its `.md` thesis).
- **RESOLVED — TWO-DIAL KNOB MODEL (worker `2026-06-04b`):** the old capital%×aggression%
  budget was inert ($100k×50%×50% ≫ a ~$700 position → qty always pinned to max =
  `size_pinned`). Now the operator-facing knobs are **RISK $/trade + STOP $/day**:
  `capital_pct` (legacy column name) holds **RISK $/trade**, sizing is risk-based
  (qty = riskUsd ÷ 0.5×ask×100, capped by `max_contracts` = hidden ceiling); `aggression`
  retired; `daily_stop_usd` (STOP) was already wired. Channel strips show **2 knobs** now.
  **DEPLOY PREREQ: `update strategist_config set capital_pct=200, aggression=0;` BEFORE
  pasting the worker** (else it reads the old 50 as $50 risk → 0 contracts). At RISK $200
  channels size ~2–4 contracts (by premium) vs the old pinned 6.
- **QQQ MULTI-INSTRUMENT ROLLOUT (worker `2026-06-04c`):** each channel trades its OWN
  `strategists.underlying` (SPY default, QQQ live). 5-step plan — **steps 1–4 DONE:**
  (1) `market-ingest` v3 writes SPY+QQQ tapes (env `UNDERLYINGS`, per-ticker isolated);
  (2) per-channel `underlying` column + `.md` frontmatter `underlying:` + Add-Channel/
  ChannelStrip ticker chip + 3-tier graceful load (`17_strategist_underlying.sql` RUN);
  (3) worker parameterized — `occSymbol(sym,…)`, `.eq("symbol",sym)`, position `underlying:sym`,
  bars/levels/expiry built once per distinct ticker (`buildMarket`→`marketByUnderlying`),
  a channel with no session bars skips `no_market`. Cost gate / ATM-δ / $1-strike rounding
  transfer as-is (QQQ is $1-strike, OPRA-fed, same OCC layout);
  (4) **§01 SPY/QQQ chart toggle** — `useMarketData(symbol)` filters EVERY read by ticker
  (`.eq("symbol",…)`/`.eq("underlying",…)`) + `/api/spot?symbol=` (allowlisted, per-sym cache)
  + the chart/chain/spot-LED follow a `symbol` state lifted to `Surface` (amber `.sym-toggle`
  in the IntradayChart header, desktop + mobile). **NOTE this also FIXED a step-1 regression:**
  the unfiltered reads were interleaving SPY+QQQ bars; **RUN `18_daily_bars_by_symbol.sql`**
  (recreates `underlying_bars_daily` grouped by symbol — the old view mixed both tickers into
  one bogus daily candle). **PENDING:** step 5 = backfill QQQ `option_bars` for the backtest
  gate. To point a channel at QQQ: `update strategists set underlying='QQQ' where slug='…';`
  (the `.md` `underlying:` does it for new channels). Futures = shelved.
- **QQQ CODE-CLONE DESK (worker `2026-06-04d`):** a parallel QQQ desk — `breakout-qqq /
  fade-qqq / power-qqq / grind-qqq`, each running the SAME code strategy as its SPY twin
  via a **base-slug resolver** in the worker (`REGISTRY[slug] ?? REGISTRY[slug.replace(
  /-(qqq|spy)$/i,"")]`) on QQQ bars/chain (per `underlying`, 04c). So a multi-instrument
  desk = just INSERTing rows, no per-channel code. `19_qqq_channels.sql` clones the 4 SPY
  rows + configs onto QQQ as **DRAFT** (nothing trades until armed: `update strategists set
  status='armed' where slug like '%-qqq'`). Exact slug wins; compiled `.md` channels are
  unaffected (arbitrary slugs find no REGISTRY hit). **NOTE:** the SPY-tuned params won't
  transfer 1:1 to QQQ (more volatile) and power/grind are unvalidated even on SPY → tomorrow's
  live QQQ is OBSERVATION; the backtest tells us what to retune.
- **QQQ BACKTEST READY (track 2 code DONE):** the engine + backfills are now ticker-parameterized
  (default SPY, backward-compatible): `engine/realsource.ts` `.eq("symbol",sym)`,
  `engine/optionsource.ts` filters `option_bars` by OCC prefix (no `underlying` col, but the
  root IS the ticker), `engine/backtest.ts` takes `--underlying` (or infers from a `--strat`
  suffix: `--strat breakout-qqq` → ORB on QQQ). `scripts/backfill-options.ts --underlying QQQ`
  + `20_backfill_qqq_bars.sql` (generic `fire_bars(symbol,…)` + a `ingest_recent_bars` that
  reads the ticker from each Alpaca response). **PENDING = the user's DATA runs:** (1) fire
  `20_backfill_qqq_bars.sql` for QQQ stock history, (2) temp anon INSERT policy on option_bars
  (no service-role key in .env.local), (3) `npm run backfill:options -- --underlying QQQ --tf 15
  --from … --to …`, (4) `npm run backtest -- --strat <s>-qqq --source real --options real` per
  channel. Then drop the temp policy + truncate option_bars (0.5 GB cap).
- **QQQ BACKTEST VERDICT (06-04, DONE — real fills, H1-2026):** ran all 4 strategies on real
  bars+`option_bars` for BOTH tickers (Jan–Jun, 106 sessions). **ALL 8 net-negative** → it's
  **regime (chop) + cost, NOT a QQQ-transfer failure** (SPY equally red same window). Gross-signal
  layer: **breakout's edge is QQQ-specific (+$1.8k gross), power's is SPY-specific (+$4.7k)**; fade
  broken both; grind cost-doomed both (1000–1700% drag, 5% win). Backtest is UNGATED → live cost
  gate makes real bleed milder. **Decision: keep `breakout-qqq` armed, MUTE fade/power/grind-qqq**
  (`update strategists set status='draft' where slug in ('fade-qqq','power-qqq','grind-qqq')`);
  power stays the SPY keeper. Docs: `docs/channels/breakout-qqq.md` (cost-disciplined ORB retune),
  `docs/qqq/qqq-desk-tracking.md` (verdict table + tracking). Memory: `qqq-spy-h1-2026-real-fills.md`.
- **ARMABLE TRAILING EXITS (worker `2026-06-04e`, 06-04):** uploaded `.md` channels can now declare a
  LIVE trailing exit. The armable subset = an **underlying ATR-chandelier** (`management.trail` mode
  `atr_chandelier`, baseK≈1.5: once in profit, exit when price retraces k·ATR from the peak favorable
  underlying — STATELESS via reconstructed `peakFavorable`, the same trail breakout's code uses) +
  premium stop/target + cost gate. Scale-outs / scale-in / vwap-target stay backtest-only
  (`isArmableManagement` in `lib/desk/strategySpec`; capabilityCheck only blocks Arm for those). Engine
  mirror: `simulateSession(…, trailExit)` + `specTrail`; worker mirror: `specTrailWorker` +
  `compiled.trail`. **Real-fills proof:** on QQQ momentum the chandelier flips gross −$1,774 (fixed
  +250%) → **+$3,946**, out-grossing the hardcoded breakout (+$1,811), DD −18% — BUT net still −$5.6k
  (the trail fixes the EXIT, not the cost wall / chop regime). **premium-giveback trail = WRONG for
  0DTE** (premium too noisy; not worker-wired — would need a `peak_premium` column). Reference upload:
  `docs/channels/orb-qqq-trail.md`. The mixer-vision unlock: an uploaded spec now arms a real trail.
- Phase B (later): de-hardcode the 4 code channels → `.md` theses; streaming worker
  becomes the SOLE trader (disable the `seve-paper-trader` cron at cutover).

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
