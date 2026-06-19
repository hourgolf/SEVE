// ⚑ WORKER VERSION: 2026-06-13b  (DUPLICATE-CHANNEL RESOLVER — the base-slug resolver now strips a
//   trailing -N (`<base>-2`,`-3`) BEFORE the -manual/-qqq|spy strips, so a DUPLICATED channel (the
//   new A/B primitive: clone → tweak DTE/U-stop → arm both) resolves to its source strategy.
//   Provably safe: no current built-in slug ends in -<digits>, so this only ever touches new
//   duplicates (which start as drafts). Mirrors worker stream-2026-06-13b. Prior below.)
// ⚑ WORKER VERSION: 2026-06-13a  (PUSH TIMEOUT — firePush is AWAITED in the trade path, so a
//   half-open socket to /api/push-send could stall a cron cycle to the platform wall-clock; added
//   AbortSignal.timeout(5000). Mirror of the worker stream-2026-06-13a fix (fire-and-forget there).
//   Found by the pre-Monday correctness review. No behavior change otherwise. Prior below.)
// ⚑ WORKER VERSION: 2026-06-12a  (STREAM-STALE PAGE — "the desk summons you", cron side. The
//   Railway worker can't report its own death, so the executor-gate heartbeat check now PAGES the
//   operator (firePush → /api/push-send, tag "seve-alert") when the stream heartbeat goes stale:
//   once as the age crosses 5m (fires only inside ONE ~60s cron-cycle window past the mark =
//   stateless dedup), again at 1h and 2h while it stays down, plus a first-run-of-day check
//   (09:00 ET) that catches a worker already LONG dead (weekend/overnight death — the age never
//   "crosses" 5m inside a run window then). firePush gains an optional tag param so alert pushes
//   don't REPLACE the ✋ manual-exit pings (web-push same-tag = replace). EXIT-ONLY failover
//   behavior UNCHANGED — the page is informational, never gates an order. Known benign edge:
//   market holidays (cron runs, worker pre-open beat ends 09:35) page stale ~09:40. Prior below.)
// ⚑ WORKER VERSION: 2026-06-11a  (B1 LIVE-DAY FIXES. (1) OPEN_0DTE_CUTOFF_MIN 16→31 — Alpaca WIDENED
//   the 0DTE open-lockout ~15→~30 min ("contract expires soon" 422s from 15:33 ET on 06-11, 27 min
//   before close) → every 15:30-15:44 entry was REJECTED instead of rolling to 1DTE. Entries inside
//   the last ~30 min now roll to next1DTE (the 2026-06-08a same-day flatten still closes them at the
//   bell). (2) TERMINAL-STATUS FILL POLL — aOrderAndFill exited on the FIRST filled_avg_price>0
//   observation, which can capture a PARTIAL fill (06-11 grind-manual ×2: poll caught qty 1 of 2 →
//   desk row said 1 → the ✕-close sold 1 → 1 contract rode UNMANAGED; surfaced only as a
//   Fund-vs-attribution +$58 gap). Now: poll to a TERMINAL order status, CANCEL the working remainder
//   after the budget, re-read the FINAL filled_qty. Entries skip the row insert on a known-0-fill
//   (no ghost); exits book the ACTUAL sold qty and leave the row open to retry on a known-0-fill.
//   Mirrored in the Railway worker (stream-2026-06-11a). Prior below.)
// ⚑ WORKER VERSION: 2026-06-10a  (PHASE-B EXECUTOR COORDINATION. Each strategist row now carries
//   `executor` ('cron' default | 'stream') — 30_executor_cutover.sql, ALREADY APPLIED. A channel
//   marked 'stream' is traded by the Railway streaming worker, which upserts worker_heartbeat
//   (id='stream') every ~10s while live. THIS worker's contract for stream-owned channels:
//   heartbeat FRESH (<5 min) → skip the channel entirely (the stream is the sole order-placer —
//   two executors on one channel = double orders); heartbeat STALE → EXIT-ONLY FAILOVER: manage
//   exits/reconcile so a dead Railway box can never strand an open 0DTE, but NEVER open a new
//   position (blocked=`stream_owned`). With every row defaulting to 'cron' this version is a
//   no-op until a channel is explicitly migrated. Prior below.)
// ⚑ WORKER VERSION: 2026-06-09d  (ANTI-GHOST RECONSTRUCT GATE. The re-buy/reconstruct guard resurrected
//   a row whenever a channel's filled orders net long with no open desk row — meant for a genuinely lost
//   insert. But a channel whose SHARED contracts were sold by a sibling (a rejected own exit, or a pre-fix
//   manual close tagged `manual-…` it couldn't see) ALSO nets long with no row → it kept re-creating GHOST
//   rows at the stale entry EVERY cycle (06-09: orb 735P booked $0 on a +90% mover; grind-manual 736C/735P
//   phantom −387/−480, showed scary fake unrealized then reconciled to ~$0). GATE: reconstruct ONLY if
//   Alpaca holds UNCOVERED contracts (held − qty already claimed by OTHER channels' open rows); else the
//   position is gone → don't ghost, don't re-buy (blocked=`liquidated_elsewhere`). Preserves the re-buy
//   SAFETY: when Alpaca DOES hold the contracts it still reconstructs and never buys. Needs a cycle-start
//   `openRowQtyByOcc` (Σ open-row qty per OCC). Catches BOTH the manual-prefix ghost and the auto-channel
//   rejected-sell ghost. Prior below.)
// ⚑ WORKER VERSION: 2026-06-09c  (SHARED-OCC LEDGER ACCURACY — de-dup without shifting strikes or
//   splitting accounts. Channels keep trading the SAME ATM OCC on ONE account; we make the per-channel
//   ledger mirror Alpaca's netted lot so each channel only ever sells ITS OWN share and can't starve a
//   sibling. (1) Entry now records the ACTUAL filled qty (aOrderAndFill returns filled_qty), not the
//   intended qty — kills the Σ(rows) > Alpaca-net drift that trapped the last channel to exit. (2) A
//   per-OCC `remainingByOcc` counter, seeded from Alpaca and decremented as channels sell (and bumped on
//   buys) WITHIN a cycle, so same-cycle siblings exit off the LIVE leftover, not the stale snapshot.
//   09b reconcile stays as the floor. Fund still NAV-true; per-channel attribution now tracks the real
//   fills. No strategy/strike/roster change. Prior below.)
// ⚑ WORKER VERSION: 2026-06-09b  (SHARED-OCC EXIT TRAP FIXED. When several channels hold the SAME
//   OCC, Alpaca NETS them into one lot; once a sibling (often a -manual twin's ✕-close) drains it, a
//   channel's exit sell was REJECTED (403 40310000 "insufficient buying power for cash-secured put"
//   = would open a naked short) and the OLD code did Math.max(1, …) + "leave open to retry" → it
//   looped a rejected sell EVERY minute and the position rode to EXPIRY trapped (06-09 ORB 726P:
//   +$700→−$700, never able to exit). FIX: sell only min(heldQty, rowQty) (no forced ≥1); if nothing
//   is held, or the sell is rejected with the cash-secured/insufficient error, RECONCILE the row
//   closed at its fill-net (realizedToBook; $0 if a sibling sold the shared lot) instead of looping.
//   Channels now always go flat when their exit fires. Fund stays NAV-true; per-channel attribution
//   on shared OCCs stays approximate (the netting limit). Prior below.)
// ⚑ WORKER VERSION: 2026-06-09a  (POWER GATE EXEMPTION REMOVED. `power` (POWERHOUR base) was the
//   ONLY channel exempt from the cost gate, on the thesis that gating vetoes its convex tail. A
//   5-window real-NBBO roster probe (engine/power-roster-probe.ts) REFUTED that: gating HALVES
//   base's worst-case bleed (−$32.5k → −$15.3k) by curbing its re-lean-EVERY-bar over-trading
//   (1373 → 619 entries) and clips only ~$1.1k from the single positive window (CHOP Mar26) — the
//   big high-ATR final-hour moves that carry the tail PASS the gate; only the small-move churn is
//   cut. So COST_GATE_EXEMPT is now EMPTY — all channels are cost-gated. De-risks base WITHOUT
//   muting it (keeps the live A/B intact). Additive: only `power` changes behaviour. Prior below.)
// ⚑ WORKER VERSION: 2026-06-08c  (MANUAL-EXIT ALERTS — Phase 2 web push. On a `-manual` twin
//   ENTRY the worker POSTs the app's /api/push-send (secret-gated by PUSH_SEND_SECRET) so the
//   operator gets a push to go own the exit. INERT until PUSH_SEND_SECRET is set on BOTH the
//   worker (Supabase secret) and Vercel. Includes the 2026-06-08b manual-exit gate below — this
//   is the single paste for the whole experiment. Never throws on a push failure. Prior below.)
// ⚑ WORKER VERSION: 2026-06-08b  (MANUAL-EXIT TWINS — man-vs-machine A/B. A `<base>-manual`
//   channel runs the base strategy's ENTRIES (base-slug resolver strips `-manual`; a compiled
//   twin runs its cloned spec_json) but the HUMAN owns the EXITS: every programmed exit intent
//   (stop/trail/target/eod/catastrophic) is dropped so the position rides until the operator
//   closes it — EXCEPT a hard bell backstop (minutesToClose ≤ MANUAL_BACKSTOP_MIN ≈15:57) that
//   force-flattens so a 0DTE/1DTE can't expire/assign. Additive + ISOLATED — only `-manual`
//   slugs change behaviour; the 13 live channels are byte-identical. Entries untouched. Twins
//   armed via SQL (clone strategist+config, copy spec_json for compiled). Prior below.)
// ⚑ WORKER VERSION: 2026-06-08a  (1DTE FLATTEN BY SESSION CLOSE. A late-day signal inside the
//   0DTE open cutoff rolls to a 1DTE (next1DTE) because Alpaca won't open a 0DTE that late;
//   that roll is meant to swing the final 20 min and CLOSE SAME-DAY. The eod-flatten guard was
//   nulling the flatten for EVERY expiration>today row, so those late rolls CARRIED OVERNIGHT
//   (2026-06-08: PowerFinal30 739P + POWERHOUR 739C both stuck to 06-09). Fix: only exempt a
//   position OPENED IN A PRIOR SESSION (a genuine multi-day hold — none today); a 1DTE opened
//   THIS session now force-flattens at this session's bell. Keys off opened_at's ET date. Prior below.)
// ⚑ WORKER VERSION: 2026-06-05c  (POWER-FINAL30 registered — power retuned to the FINAL 30
//   MIN + a pure momentum lean (no VWAP gate). Window sweep (H1 real fills) flipped power's
//   gross −$8.4k (60m) → +$8.9k (30m); 15:00–15:30 was dragging it negative. Trades once a
//   strategists row + config exist (26_power_final30_channel.sql) — that file also MUTES base
//   `power` to avoid same-OCC collision in the final half-hour. Exact slug `power-final30`. Prior below.)
// ⚑ WORKER VERSION: 2026-06-05b  (GRIND-V3 registered — the disciplined-scalper rework
//   (grindV3Eval): trend-gated (er≥0.35) bigger-burst entries, AM-start + 14:00 afternoon
//   curfew, grind's FAST fixed-target exit (NO trail — it backfired in chop, H1 backtest).
//   Resolved by exact slug `grind-v3` in REGISTRY. Trades only once a strategists row +
//   config exist (25_grind_v3_channel.sql) and status='armed'. Prior below.)
// ⚑ WORKER VERSION: 2026-06-05a  (UNDERLYING INITIAL STOP, config-gated. New per-channel
//   strategist_config.underlying_stop_pct (0 = off): exit when the UNDERLYING moves X% against
//   entry — a uniform loss stop vs the premium-noise −50% stop (which fires at a VARIABLE
//   0.2–0.5% underlying move by option price). Uses the reconstructed entryUnderlying (NO
//   schema change beyond the one config column). Fires before the premium stop, after profit
//   trail/target. Also SHADOW-logs the tighter 0.15% (events `stream-shadow: US0.15…`) for a
//   no-collision A/B vs the live 0.20%. INERT until the SQL sets underlying_stop_pct>0 on a
//   channel (default 0 → Number(undefined ?? 0) = 0 → no-op everywhere else). Activated on
//   orb-trend-rider / breakout-qqq / qqq-thrust-trail / breakout-smart-entries. Prior below.)
// ⚑ WORKER VERSION: 2026-06-04g  (MUTE NO LONGER TRAPS POSITIONS. The exit path was gated
//   by canTrade (= !muted), so a MUTED channel couldn't close its open position — even the
//   EOD flatten was blocked, so a muted 0DTE rode to expiry. Now EXITS run regardless of mute
//   (only the KILL switch / non-paper freezes them); ENTRIES stay gated by mute. A muted
//   channel winds down its position like draft/disabled does. Found live: two muted grind
//   channels held SPY 0DTE 15–22 min (a scalp exits in ~5). Prior line below.)
// ⚑ WORKER VERSION: 2026-06-04f  (PER-CHANNEL UNREALIZED. The open-position desk row
//   booked Alpaca's NETTED unrealized_pl — so when several channels held the SAME OCC
//   (the mirror clustering: breakout + grind + orb-spy-trail all long SPY-748P), every
//   row showed the same number, unreconciled with its own entry (BREAK entry 1.23 and
//   GRIND entry 1.48 both showed +$24). Now unrealized = (mark − THIS row's avg_entry)
//   × its qty × 100. DISPLAY-ONLY — no decision reads unrealized_pnl (exits use the live
//   mark, daily_stop uses realized, the fund equity snapshot still sums Alpaca's net).
//   Nothing about entries/exits/sizing/realized changed. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-04e  (ARMABLE TRAIL for compiled .md channels. An uploaded
//   channel can now declare a live trailing exit — an underlying ATR-CHANDELIER (trail.mode
//   atr_chandelier, baseK≈1.5): once in profit, exit when price retraces k·ATR from the peak
//   favorable underlying. peakFavorable is reconstructed from session bars (STATELESS — no new
//   column), the SAME trail breakout's code uses — the right exit for 0DTE momentum (real-fills:
//   it flips the QQQ-momentum signal gross from −$1.8k fixed-exit to +$3.9k). Only the ARMABLE
//   subset arms (chandelier + premium stop/target + cost gate); scale-outs / scale-in / vwap
//   target stay backtest-only (`isArmableManagement`). The premium stop/target still apply (trail
//   = winners, stop = losers). premium-giveback trail is NOT worker-supported yet (needs a peak
//   premium column; it's noisier anyway). Per-channel + per-underlying via the .md. Prior below.)
// ⚑ WORKER VERSION: 2026-06-04d  (MULTI-INSTRUMENT CODE CLONES. A channel whose slug
//   is `<base>-qqq` / `<base>-spy` now resolves to the SAME code strategy as `<base>`
//   (breakout-qqq → ORB, grind-qqq → scalper, …) via a base-slug fallback in the
//   REGISTRY lookup — so you spin up a QQQ desk by just INSERTing strategist rows
//   (19_qqq_channels.sql clones the 4 SPY channels onto QQQ as DRAFT), no per-channel
//   code. The underlying is already routed per s.underlying (04c). Exact slug still
//   wins; compiled .md channels are unaffected. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-04c  (MULTI-INSTRUMENT. Each channel now trades its OWN
//   underlying — `strategists.underlying` (SPY default, QQQ live; run 17_strategist_underlying.sql
//   BEFORE this deploy or the select errors). The 3 hardcoded SPY literals are parameterized:
//   the OCC prefix (occSymbol(sym,…)), the bars query (.eq("symbol", sym)), and the position
//   row's `underlying`. Bars/levels/next-expiry are built ONCE PER DISTINCT TICKER (buildMarket
//   → marketByUnderlying), reused across same-ticker channels, so a QQQ channel reads QQQ bars +
//   the QQQ chain + writes QQQ00…C OCCs. A channel whose ticker has no session bars yet skips
//   with note:"no_market" (never trades blind). The cost gate / ATM-δ proxy / $1 strike rounding
//   transfer as-is (QQQ is $1-strike, OPRA-fed, same OCC format). market-ingest (step 1) already
//   writes the SPY+QQQ tapes. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-04b  (TWO-DIAL SIZING. The capital_pct%×aggression% budget was
//   inert — $100k×50%×50% = $25k ≫ a ~$700 position, so qty ALWAYS pinned to max_contracts
//   (the size_pinned flaw) and the knobs did nothing. New model: **capital_pct now holds
//   RISK $/trade** and sizing is risk-based — risk/contract = the −50% premium stop
//   (0.5×ask×100), qty = riskUsd ÷ that, capped by max_contracts (the hidden ceiling).
//   aggression is retired (unused). PREREQ: run `update strategist_config set
//   capital_pct = 200, aggression = 0;` BEFORE/with this deploy, else qty=0 (it reads the
//   old 50 as $50 risk → insufficient_capital). daily_stop_usd (STOP $/day) already wired.
//   Prior line below.)
// ⚑ WORKER VERSION: 2026-06-04a  (SHARED-OCC BOOKING FIX. 06-03b stopped the mid-vs-fill
//   overstatement, but the desk STILL booked ~4× the account (06-03: +$2,114 vs +$492).
//   Root cause: when two mirror channels (e.g. power + power-smart) trade the SAME OCC,
//   Alpaca NETS the lot and the reconcile/reconstruct churn creates many CLOSED rows per
//   real round-trip, each re-booking the gain (P00755000: 17 desk rows/$1,169 vs broker
//   $210; C00755000: 27 rows/+$162 vs broker −$144 — even the sign flipped). Fix: book
//   realized from the channel's ACTUAL matched fills (tagged by the slug-prefixed
//   client_order_id) MINUS what's already booked on prior closed rows for this
//   (channel, OCC) today (realizedToBook). Cumulative booked == fill-derived realized, so
//   churn rows book $0 and Σ desk realized == the Alpaca account — per-channel rows +
//   autopsy now reflect reality too (the LED was already NAV-truth dashboard-side). NO
//   order/entry/exit logic changed — only the realized_pnl VALUE. DRY_RUN keeps the
//   simulated mark-based booking (no real fills to derive from). Prior line below.)
// ⚑ WORKER VERSION: 2026-06-03b  (P&L BOOKS AT THE ACTUAL FILL, not the mid/mark.
//   Root cause of the desk reporting ~4× its real account P&L: entries booked at
//   the quoted ask, exits at alp.current_price (mid), and manual/orphan closes at
//   the last quote mid — but real fills cross the spread (buy→ask, sell→bid). Now
//   entries + exits poll the order for filled_avg_price (aOrderAndFill), and the
//   reconcile path books at the actual filled SELL order (manual close via the
//   Alpaca app) or the quote BID. The desk's Day-P&L LED / per-channel / autopsy
//   now reconcile to the Alpaca account. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-03a  (RTH-ONLY session bars. market-ingest is now on the
//   SIP feed, which streams ~30 PRE-MARKET bars (09:00–09:29 ET); the worker filtered
//   session bars by ET date only, so those bars satisfied warmup BEFORE the open and
//   corrupted the opening range / VWAP / ATR (confirmed live 2026-06-03: grind fired
//   09:31 while the RTH-correct streaming worker stayed flat until ~09:45). Now filters
//   session1m AND the pdh/pdl high/low to 09:30–16:00 ET (min 570–960) — parity with
//   the streaming worker's buildSessionBars. If the deployed function does NOT show
//   THIS line at the top, the paste is stale. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-02b  (POWER giveback trail: once a power position has
//   been up ≥+100%, lock gains by exiting on a >40% giveback of the peak gain —
//   engaged only after +100% so it never clips power's early convexity (the early
//   scale-outs the A/B rejected are NOT used). Peak premium reconstructed from
//   option_quotes (no schema change). Backtested tail-safe on real NBBO
//   (engine/power-probe.ts: +70% totalPnl, −23% DD). Power-only. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-02a  (STATE-PARITY FIX: per-minute position state is
//   now rebuilt from the session bars to match the engine — entryUnderlying =
//   actual close at the entry bar (was the rounded strike, ±$0.50 > grind's
//   0.5–0.6·ATR stop → grind insta-exited within a minute), and peakFavorable =
//   the running best/worst close since entry (was reset to the current close every
//   run → breakout's 1.5·ATR trailing stop could NEVER fire → winners only exited
//   on EOD/failed-break). No schema change. Prior line below.)
// ⚑ WORKER VERSION: 2026-06-01i  (cost gate RECALIBRATED to real SPY-0DTE fills —
//   slippage 1→0.25 tick (a market order fills ~at the NBBO; the old 1-tick was a
//   backtest default that DOUBLED the cost on tight-spread setups and blocked ~90%
//   on low-ATR days) + ATM δ proxy 0.5→0.55 (live MarketData.app Greeks) ·
//   compiled-spec warmup FLOOR lowered 30→15 bars, in
//   sync with engine WARMUP_FLOOR — faster/opening-period .md strategies no longer
//   wait the full opening-range window (OR-based conditions still self-gate) ·
//   per-channel ISOLATION — one channel's throw can no longer abort the whole run ·
//   compiled-spec interpreter FULL-PARITY
//   with engine/specEvaluate.ts: efficiency_ratio · momentum_atr · macd · level
//   (pdh/pdl/orb) · atLeast confluence · cost gate EXEMPTS power · premium
//   catastrophic stop · real entry-time time-stops · 0DTE→1DTE roll · order
//   resilience · channel independence · reconciliation). If the function deployed in
//   Supabase does NOT show THIS version line at the top, the paste is stale — re-copy.
// ============================================================================
//  paper-trader — DISPATCHER DRAFT (multi-channel "one engine, two drivers").
//
//  ⚠️ DRAFT — review + backtest before replacing index.ts. Specifically:
//    • power & grind are first-draft theses — run `npm run backtest` on real
//      option_bars and Arm them before they trade live (the safety gate).
//    • position attribution: the desk `positions` table (strategist_id ↔
//      occ_symbol) is the source of truth per channel. If two channels pick the
//      SAME 0DTE contract, Alpaca nets them into one position — rare, but a
//      known edge case (mitigation noted below).
//    • this multi-channel worker itself is untested against live Alpaca.
//
//  What changed vs the single-strategy worker:
//    - loads ALL strategists, loops them, runs each one's registered strategy
//      on session features (computeFeatures), books orders tagged per channel.
//    - each channel sizes off ITS OWN capital_pct of the fund equity (independent
//      allocation), capped by its max_contracts.
//    - strategies + computeFeatures are inlined here (paste-deploy has no bundler)
//      but MIRROR engine/* — keep them in sync; the engine stays the backtest
//      source of truth.
//
//  Add-Channel phase 2 additions (this revision):
//    - reads `status` + `spec_json` from strategists. ONLY 'armed' channels place
//      orders (draft/disabled are idle). status missing → treated as armed so the
//      built-ins keep running pre-migration.  ⚠ run 13_add_channel.sql FIRST.
//    - compiled-spec channels (no REGISTRY entry) run via compileSpec() — the
//      inlined twin of engine/specEvaluate.ts (SUPPORTED conditions only; STRICT
//      live posture: any unknown/unsupported condition makes the entry not fire).
//    - the Stop knob (daily_stop_usd) now bites: a channel stops taking NEW
//      entries once its REALIZED P&L today is at/under its loss budget.
//    - SAME-0DTE collision fix: exits sell only the CHANNEL'S own qty (not the
//      whole netted Alpaca lot), and a desk row with no matching Alpaca position
//      is RECONCILED closed (valued at the last quote) — fixes stuck "open" rows
//      when one channel's exit flattened another holding the same contract.
//    - 0DTE→1DTE ROLL: Alpaca rejects OPENING a 0DTE within ~15 min of close
//      (the 422). Inside that cutoff, channels roll new entries to the next
//      expiry (1DTE, resolved from the live chain) so the signal still fills; a
//      1DTE+ position is then allowed to ride overnight (its own stops still fire
//      and it can sell before close — only 0DTE gets the forced EOD flatten).
//    - CHANNEL INDEPENDENCE: every order carries a per-channel client_order_id
//      (`slug-occ-min`). The old account-wide "already_open" guard is gone — a
//      channel only checks ITS OWN orders, so two channels can hold the same
//      contract independently (Alpaca nets the lot; each keeps its own book).
//      Re-buy loop is still guarded per channel: a working order blocks a re-fire,
//      and a filled-but-unrecorded position is reconstructed, not re-bought.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY = Deno.env.get("ALPACA_KEY") ?? "";
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() !== "false";
// Manual-exit alerts (Phase 2 web push): POST to the Vercel app's /api/push-send when a
// `-manual` twin opens a position. INERT until PUSH_SEND_SECRET is set (matches Vercel).
const PUSH_SECRET = Deno.env.get("PUSH_SEND_SECRET") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://seve-henna.vercel.app";
const PAPER = "https://paper-api.alpaca.markets";

// ---- smart-layer guards (mirror engine/cost.ts + engine/manage.ts) ----------
// The A/B on REAL option_bars said: scale-outs/breakeven/trail HURT (they cap the
// 0DTE convex tail), but two pieces help — so ONLY these two are wired live:
//   (1) the COST GATE (entry veto; cut grind's churn 2263→125 positions), and
//   (2) the PREMIUM CATASTROPHIC STOP (exit; caps losers the ATR stops miss).
// Both are tunable consts. The worker has BETTER data than the backtest: the live
// option_quotes carry REAL bid+ask (+ a modeled delta) and features give ATR.
const COST_GATE_RATIO = 3.0;          // block if expectedMove < RATIO × roundTripCost
// Channels EXEMPT from the cost gate. EMPTY as of 2026-06-09 — the `power` exemption
// was REMOVED. The earlier exemption (citing engine/power-probe.ts: gate vetoes power's
// convex tail) was REFUTED by a 5-window real-NBBO roster probe (engine/power-roster-
// probe.ts): gating HALVES power(base)'s worst-case bleed (−$32.5k → −$15.3k) by curbing
// its re-lean-EVERY-bar over-trading (1373 → 619 entries) and clips only ~$1.1k from the
// one positive window — the big high-ATR final-hour moves that carry the tail PASS the
// gate (expectedMove ∝ ATR), so only the small-move churn is cut. All channels now gated.
const COST_GATE_EXEMPT = new Set<string>();
const PREMIUM_STOP_PCT = 50;          // exit any open position marked ≤ −50% from entry
// UNDERLYING INITIAL STOP (per-channel via strategist_config.underlying_stop_pct; 0 = off).
// Exit when the UNDERLYING has moved X% against the entry. A −50% premium stop fires at a
// VARIABLE underlying move (~0.2–0.5% by option price); this is a uniform, premium-noise-free
// loss stop. MAE study (06-01..05): a 0.20% stop preserved every ≥5min winner (max winner dip
// 0.137%) and cut ~⅓ of losers early. SHADOW_US_STOP_PCT is the tighter 0.15% A/B — logged
// (not acted) so we compare it against the live 0.20% without a colliding live channel.
const SHADOW_US_STOP_PCT = 0.15;      // % of underlying — shadow-only (logged, never traded)
// POWER late-engaged giveback trail (backtested tail-safe — engine/power-probe.ts on
// real NBBO): once a power position has EVER been up ≥ +100% (the option doubled),
// LOCK gains by exiting if it gives back > 40% of its peak gain. Engaged ONLY after
// +100% so it never clips power's early convexity — the early scale-outs the
// smart-layer A/B rejected are deliberately NOT used. Power-only for now. The probe
// (64 real-NBBO days): +70% totalPnl, −23% drawdown vs base, ~19% smaller avgWin.
const POWER_TRAIL_CHANNELS = new Set(["power"]);
const POWER_TRAIL_ENGAGE_MULT = 2.0;  // engage once the mark has reached entry × this (+100%)
const POWER_TRAIL_GIVEBACK_PCT = 40;  // exit if it gives back > this % of the peak gain
const ATM_DELTA = 0.55;               // ATM 0DTE delta proxy (live MarketData.app: 758C δ≈0.567) when quote has none
const TICK = 0.01;
// Slippage the COST GATE assumes per side. A liquid SPY 0DTE market order fills ~at
// the NBBO, so real slippage beyond the spread is ~0 — the old 1-tick ($1/side) was a
// backtest default that DOUBLED the round-trip cost on 1¢-spread setups (the cheapest,
// best ones) and blocked ~90% of entries on low-ATR days. 0.25 tick is a small buffer.
const SLIPPAGE_TICKS_PER_SIDE = 0.25;
const COMMISSION_PER_CONTRACT = 0.04; // Alpaca reg pass-through per side (not a commission)

const sb = createClient(SB_URL, SB_SERVICE);

// ---- types (mirror engine/types.ts) ---------------------------------------
type OptType = "call" | "put";
interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number; vwap: number; }
interface Features {
  minute: number; minutesToClose: number; close: number; vwap: number;
  openRangeHi: number | null; openRangeLo: number | null; atr: number; mom: number; er: number; relVol: number;
}
interface Pos { optType: OptType; entryMinute: number; entryUnderlying: number; peakFavorable: number; }
type Intent = { kind: "enter"; direction: OptType; reason: string } | { kind: "exit"; reason: string } | null;
type Evaluate = (f: Features, pos: Pos | null) => Intent;

// ---- features (mirror engine/engine.ts — minutesToClose is patched live) ----
const OPEN_RANGE_MIN = 30, ATR_N = 14, ER_N = 30, VOL_N = 20;
function computeFeatures(bars: Bar[], i: number, minutesToClose: number): Features {
  const b = bars[i];
  let orHi: number | null = null, orLo: number | null = null;
  if (i >= OPEN_RANGE_MIN - 1) {
    orHi = -Infinity; orLo = Infinity;
    for (let j = 0; j < OPEN_RANGE_MIN; j++) { orHi = Math.max(orHi, bars[j].high); orLo = Math.min(orLo, bars[j].low); }
  }
  let atrSum = 0, atrCount = 0;
  for (let j = Math.max(0, i - ATR_N + 1); j <= i; j++) { atrSum += bars[j].high - bars[j].low; atrCount++; }
  const atr = atrCount ? atrSum / atrCount : 0;
  const mom = i >= 3 ? b.close - bars[i - 3].close : 0;
  let er = 0; const n = Math.min(ER_N, i);
  if (n > 0) { let path = 0; for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].close - bars[j - 1].close); er = path > 0 ? Math.abs(b.close - bars[i - n].close) / path : 0; }
  let relVol = 1;
  if (i >= 1) { let vSum = 0, vC = 0; for (let j = Math.max(0, i - VOL_N); j < i; j++) { vSum += bars[j].volume; vC++; } const avg = vC ? vSum / vC : 0; relVol = avg > 0 ? b.volume / avg : 1; }
  return { minute: i, minutesToClose, close: b.close, vwap: b.vwap, openRangeHi: orHi, openRangeLo: orLo, atr, mom, er, relVol };
}

// ---- strategies (mirror engine/strategies/* — keep in sync) -----------------
function breakoutEval(f: Features, pos: Pos | null): Intent {
  const P = { breakAtr: 0.5, volMult: 1.3, erMin: 0.35, momConfirm: 0.3, trailAtr: 1.5, failAtr: 0.75, flatten: 35 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call") {
      if (f.close < pos.peakFavorable - P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeHi != null && f.close < f.openRangeHi - P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    } else {
      if (f.close > pos.peakFavorable + P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeLo != null && f.close > f.openRangeLo + P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.er < P.erMin || f.relVol < P.volMult) return null;
  if (f.close > f.openRangeHi + P.breakAtr * f.atr && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "break_high" };
  if (f.close < f.openRangeLo - P.breakAtr * f.atr && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "break_low" };
  return null;
}
function fadeEval(f: Features, pos: Pos | null): Intent {
  const P = { atrMult: 1.5, weakMom: 0.6, stopAtr: 1.0, timeStop: 20, flatten: 35, erMax: 0.4 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") { if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0 || f.er > P.erMax) return null;
  if (Math.abs(f.mom) >= P.weakMom * f.atr) return null;
  if (f.close > f.openRangeHi && f.close - f.vwap > P.atrMult * f.atr) return { kind: "enter", direction: "put", reason: "fade_upside_stretch" };
  if (f.close < f.openRangeLo && f.vwap - f.close > P.atrMult * f.atr) return { kind: "enter", direction: "call", reason: "fade_downside_stretch" };
  return null;
}
function powerEval(f: Features, pos: Pos | null): Intent {
  const P = { windowMin: 60, momConfirm: 0.25, stopAtr: 1.0, flatten: 3 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call" && f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    if (pos.optType === "put" && f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    return null;
  }
  if (f.minutesToClose > P.windowMin || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.close > f.vwap && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "power_hour_long" };
  if (f.close < f.vwap && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "power_hour_short" };
  return null;
}
// Power Hour, retuned (backtested H1 real fills): the FINAL 30 MIN only + a pure
// MOMENTUM lean (no VWAP gate). The window sweep flipped power's gross from −$8.4k
// (60m) to +$8.9k (30m) — 15:00–15:30 was dragging it negative; the edge is the last
// half-hour. (No VWAP gate matches base power's live behaviour — the per-bar VWAP bug
// already makes f.vwap ≈ close, so the gate was ~off anyway.) Mirrors DEFAULT_POWER_MOM30.
function powerFinal30Eval(f: Features, pos: Pos | null): Intent {
  const P = { windowMin: 30, momConfirm: 0.25, stopAtr: 1.0, flatten: 3 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call" && f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    if (pos.optType === "put" && f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    return null;
  }
  if (f.minutesToClose > P.windowMin || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "power_hour_long" };
  if (f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "power_hour_short" };
  return null;
}
function grindEval(f: Features, pos: Pos | null): Intent {
  const P = { momTrigger: 0.5, volMin: 1.1, targetAtr: 0.6, stopAtr: 0.5, timeStop: 5, flatten: 10 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "call") { if (f.close >= pos.entryUnderlying + P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close <= pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close <= pos.entryUnderlying - P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close >= pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.minutesToClose <= P.flatten || f.atr <= 0 || f.relVol < P.volMin) return null;
  if (f.mom >= P.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -P.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}
// Disciplined scalper (backtested grind-v3, H1-2026 real fills): grind's entry but
// TREND-GATED (er ≥ erMin), a bigger burst (momTrigger), an AM-start + 14:00 AFTERNOON
// CURFEW (entryEnd), and grind's FAST fixed-target exit — NO trail (the chandelier
// backfired in chop: runners revert). Entry discipline keeps grind's positive gross edge
// while cutting trades ~⅓. Mirrors engine/strategies/grind-v2.ts DEFAULT_GRIND_V3_PARAMS.
function grindV3Eval(f: Features, pos: Pos | null): Intent {
  const P = { momTrigger: 0.8, volMin: 1.2, erMin: 0.35, entryStart: 5, entryEnd: 270, targetAtr: 0.6, stopAtr: 0.5, timeStop: 5, flatten: 10 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "call") { if (f.close >= pos.entryUnderlying + P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close <= pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close <= pos.entryUnderlying - P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close >= pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.minute < P.entryStart || f.minute >= P.entryEnd) return null;          // AM start + 14:00 ET curfew
  if (f.minutesToClose <= P.flatten || f.atr <= 0 || f.relVol < P.volMin) return null;
  if (f.er < P.erMin) return null;                                             // skip chop
  if (f.mom >= P.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -P.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}

// slug → { evaluate, timeframeMin, warmupBars }  (mirrors engine/registry.ts)
const REGISTRY: Record<string, { evaluate: Evaluate; tf: number; warmup: number }> = {
  breakout:   { evaluate: breakoutEval, tf: 1, warmup: 30 },
  fade:       { evaluate: fadeEval,     tf: 1, warmup: 30 },
  power:      { evaluate: powerEval,    tf: 1, warmup: 30 },
  "power-final30": { evaluate: powerFinal30Eval, tf: 1, warmup: 30 },
  grind:      { evaluate: grindEval,    tf: 1, warmup: 30 },
  "grind-v3": { evaluate: grindV3Eval,  tf: 1, warmup: 30 },
};

// ---- compiled-spec interpreter (FULL MIRROR of engine/specEvaluate.ts) ------
// A channel added via the dashboard has no REGISTRY entry — it carries a compiled
// StrategySpec (spec_json). This turns that spec into the SAME Evaluate the engine
// produces, over the SAME supported vocabulary (ma_cross/vwap_side/vwap_dev/
// opening_range/or_width_min/rel_vol/rsi/time_*/efficiency_ratio/momentum_atr/
// macd/level) WITH `atLeast` confluence — so a backtest-gated spec trades live
// IDENTICALLY. Live posture is STRICT: any unsupported/unknown condition makes the
// entry not fire (never trade an unevaluated gate) — armed channels are
// capability-checked, so this is defensive. KEEP IN SYNC with engine/specEvaluate.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;
function emaArr(vals: number[], p: number): number[] {
  const out: number[] = []; const k = 2 / (p + 1); let prev = vals.length ? vals[0] : 0;
  for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
function rsiArr(vals: number[], p: number): number[] {
  const out = new Array(vals.length).fill(50); if (vals.length < 2) return out;
  let ag = 0, al = 0;
  for (let i = 1; i < vals.length; i++) {
    const ch = vals[i] - vals[i - 1]; const g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= p) { ag += g / p; al += l / p; if (i < p) { out[i] = 50; continue; } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; }
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function xdir(a: number[], b: number[], i: number): number {
  if (i < 1) return 0; const pr = a[i - 1] - b[i - 1], nw = a[i] - b[i];
  if (pr <= 0 && nw > 0) return 1; if (pr >= 0 && nw < 0) return -1; return 0;
}
function parseET(s: string): number | null { const m = /^\s*(\d{1,2}):(\d{2})/.exec(s || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
// Full parity with engine/specEvaluate.ts SUPPORTED — keep these in sync (the
// capabilityCheck in lib/desk/strategySpec.ts is the arm gate; a kind it deems
// armable MUST be runnable here, or a channel arms and silently never trades).
const SPEC_SUPPORTED = new Set(["ma_cross","vwap_side","vwap_dev","opening_range","or_width_min","rel_vol","rsi","time_before","time_between","efficiency_ratio","momentum_atr","macd","level"]);
const macdKey = (c: Spec) => `${c.fast}-${c.slow}-${c.signal}`;

interface CompiledSpec { build: (bars: Bar[], levels?: { pdh?: number; pdl?: number }) => Evaluate; tf: number; warmup: number; premiumExit: { profitPct?: number; stopPct?: number }; trail?: { atrChandelierK?: number; premiumGivebackPct?: number }; }

// Armable TRAIL from a spec's management block (mirror of lib/desk/strategySpec
// specTrail + isArmableManagement). ONLY the subset the worker runs live: an
// underlying ATR-chandelier and/or a premium-giveback. A block with scale-outs /
// scale-in / a vwap-fraction target is NOT armable → no live trail (returns null).
// deno-lint-ignore no-explicit-any
function specTrailWorker(m: any): { atrChandelierK?: number; premiumGivebackPct?: number } | null {
  if (!m) return null;
  if (Array.isArray(m.scaleOut) && m.scaleOut.length > 0) return null;
  if (m.scaleIn?.enabled) return null;
  if (m.target) return null;
  const t = m.trail;
  if (!t) return null;
  const out: { atrChandelierK?: number; premiumGivebackPct?: number } = {};
  if ((t.mode === "atr_chandelier" || t.mode === "hybrid") && t.atrChandelier && t.atrChandelier.baseK > 0) out.atrChandelierK = t.atrChandelier.baseK;
  if ((t.mode === "premium_giveback" || t.mode === "hybrid") && typeof t.premiumGivebackPct === "number" && t.premiumGivebackPct > 0) out.premiumGivebackPct = t.premiumGivebackPct;
  return out.atrChandelierK != null || out.premiumGivebackPct != null ? out : null;
}
function compileSpec(spec: Spec): CompiledSpec {
  const entries: Spec[] = spec?.entries ?? [];
  let profitPct: number | undefined, stopPct: number | undefined, timeExit: number | null = null;
  // Magnitudes: a spec may state the stop as "-50" or "50"; downstream uses
  // entry·(1 ± pct/100), so abs() keeps a "-50%" stop from inverting into a gain.
  for (const e of (spec?.exits ?? [])) {
    if (profitPct == null && typeof e.profitPct === "number") profitPct = Math.abs(e.profitPct);
    if (stopPct == null && typeof e.stopPct === "number") stopPct = Math.abs(e.stopPct);
    if (e.timeET) { const t = parseET(e.timeET); if (t != null) timeExit = timeExit == null ? t : Math.min(timeExit, t); }
  }
  let warmup = 15; // warmup FLOOR (was 30) — sync with engine/specEvaluate.ts WARMUP_FLOOR.
  for (const e of entries) for (const c of (e.all ?? [])) {
    if (c.kind === "ma_cross") warmup = Math.max(warmup, c.slow, c.fast);
    else if (c.kind === "rsi") warmup = Math.max(warmup, c.period + 1);
    else if (c.kind === "momentum_atr") warmup = Math.max(warmup, (c.lookback ?? 3) + 1);
    else if (c.kind === "macd") warmup = Math.max(warmup, c.slow + c.signal);
  }
  const build = (bars: Bar[], levels?: { pdh?: number; pdl?: number }): Evaluate => {
    const closes = bars.map((b) => b.close);
    const emaS = new Map<number, number[]>(), rsiS = new Map<number, number[]>(), macdS = new Map<string, number[]>();
    for (const e of entries) for (const c of (e.all ?? [])) {
      if (c.kind === "ma_cross") { if (!emaS.has(c.fast)) emaS.set(c.fast, emaArr(closes, c.fast)); if (!emaS.has(c.slow)) emaS.set(c.slow, emaArr(closes, c.slow)); }
      else if (c.kind === "rsi" && !rsiS.has(c.period)) rsiS.set(c.period, rsiArr(closes, c.period));
      else if (c.kind === "macd" && !macdS.has(macdKey(c))) { const fa = emaArr(closes, c.fast), sl = emaArr(closes, c.slow); const line = closes.map((_, i) => fa[i] - sl[i]); const sig = emaArr(line, c.signal); macdS.set(macdKey(c), line.map((v, i) => v - sig[i])); }
    }
    const etMin = bars.map((b) => etParts(b.ts).min);
    const cond = (c: Spec, f: Features, i: number): boolean => {
      switch (c.kind) {
        case "ma_cross": { const a = emaS.get(c.fast), b = emaS.get(c.slow); if (!a || !b) return false; return xdir(a, b, i) === (c.dir === "up" ? 1 : -1); }
        case "vwap_side": return c.side === "above" ? f.close > f.vwap : f.close < f.vwap;
        case "vwap_dev": { if (f.atr <= 0) return false; const d = (f.close - f.vwap) / f.atr; return c.cmp === ">" ? d >= c.atr : d <= -c.atr; }
        case "opening_range": return c.side === "break_above" ? (f.openRangeHi != null && f.close > f.openRangeHi) : (f.openRangeLo != null && f.close < f.openRangeLo);
        case "or_width_min": { if (f.openRangeHi == null || f.openRangeLo == null || f.close <= 0) return false; return ((f.openRangeHi - f.openRangeLo) / f.close) * 100 >= c.pct; }
        case "rel_vol": return f.relVol >= c.min;
        case "efficiency_ratio": return c.op === ">=" ? f.er >= c.value : f.er <= c.value;
        case "momentum_atr": { if (f.atr <= 0) return false; const lb = c.lookback ?? 3; const mom = i >= lb ? (closes[i] - closes[i - lb]) / f.atr : 0; return c.op === ">=" ? mom >= c.value : mom <= c.value; }
        case "macd": { const h = macdS.get(macdKey(c)); if (!h) return false; return c.cmp === "bull" ? h[i] > 0 : h[i] < 0; }
        case "level": { const lvl = c.ref === "orb_hi" ? f.openRangeHi : c.ref === "orb_lo" ? f.openRangeLo : c.ref === "pdh" ? levels?.pdh : levels?.pdl; if (lvl == null || f.close <= 0) return false; if (c.cmp === ">") return f.close > lvl; if (c.cmp === "<") return f.close < lvl; return (Math.abs(f.close - lvl) / f.close) * 100 <= (c.withinPct ?? 0.15); }
        case "rsi": { const s = rsiS.get(c.period); if (!s) return false; return c.cmp === ">" ? s[i] > c.value : s[i] < c.value; }
        case "time_before": { const t = parseET(c.et); return t != null && etMin[i] < t; }
        case "time_between": { const a = parseET(c.startET), b = parseET(c.endET); return a != null && b != null && etMin[i] >= a && etMin[i] <= b; }
        default: return false;
      }
    };
    // Confluence: fire on ≥ `atLeast` of the conditions (capped at the count), else
    // strict AND. STRICT live posture: an unsupported (feed-dependent) gate makes
    // the entry NOT fire — never trade an unevaluated rule. Armed channels are
    // capability-checked (zero unsupported), so this only guards a force-armed spec.
    const entryHolds = (e: Spec, f: Features, i: number): boolean => {
      const all = e.all ?? []; if (!all.length) return false;
      for (const c of all) if (!SPEC_SUPPORTED.has(c.kind)) return false;
      let held = 0; for (const c of all) if (cond(c, f, i)) held++;
      const need = e.atLeast != null ? Math.min(Math.max(1, e.atLeast), all.length) : all.length;
      return held >= need;
    };
    const infer = (e: Spec): OptType | null => {
      for (const c of (e.all ?? [])) {
        if (c.kind === "ma_cross") return c.dir === "up" ? "call" : "put";
        if (c.kind === "vwap_side") return c.side === "above" ? "call" : "put";
        if (c.kind === "opening_range") return c.side === "break_above" ? "call" : "put";
        if (c.kind === "momentum_atr") return c.op === ">=" ? "call" : "put";
      }
      return null;
    };
    return (f: Features, pos: Pos | null): Intent => {
      const i = f.minute;
      if (pos) {
        if (f.minutesToClose <= 1) return { kind: "exit", reason: "eod_flatten" };
        if (timeExit != null && etMin[i] >= timeExit) return { kind: "exit", reason: "time_exit" };
        return null;
      }
      if (i < warmup || f.atr <= 0) return null;
      for (const e of entries) {
        if (!entryHolds(e, f, i)) continue;
        const dir: OptType | null = e.direction === "both" ? infer(e) : e.direction;
        if (!dir) continue;
        return { kind: "enter", direction: dir, reason: e.reason || "spec_entry" };
      }
      return null;
    };
  };
  // deno-lint-ignore no-explicit-any
  const trail = specTrailWorker((spec as any)?.management) ?? undefined;
  return { build, tf: 1, warmup, premiumExit: { profitPct, stopPct }, trail };
}

// ---- helpers ---------------------------------------------------------------
const aHdr = { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET };
async function aGet(path: string) { const r = await fetch(PAPER + path, { headers: aHdr }); if (!r.ok) throw new Error(`${r.status} GET ${path}`); return r.json(); }
async function aPost(path: string, body: unknown) { const r = await fetch(PAPER + path, { method: "POST", headers: { ...aHdr, "content-type": "application/json" }, body: JSON.stringify(body) }); const text = await r.text(); if (!r.ok) throw new Error(`${r.status} POST ${path}: ${text.slice(0, 300)}`); return text ? JSON.parse(text) : {}; }
async function aDelete(path: string) { const r = await fetch(PAPER + path, { method: "DELETE", headers: aHdr }); if (!r.ok) throw new Error(`${r.status} DELETE ${path}`); }
async function journal(level: string, message: string, meta?: unknown) { try { await sb.from("events").insert({ level, message, meta: meta ?? null }); } catch { /* */ } }
// Fire an operator alert (web push) via the app's secret-gated /api/push-send. No-op
// without PUSH_SEND_SECRET; never throws (a push failure must not break a trade cycle).
// `tag` separates notification streams (web-push REPLACES same-tag): "seve-manual" =
// the ✋ twin exit pings; "seve-alert" = desk alerts (e.g. the stream-stale page).
async function firePush(title: string, body: string, tag = "seve-manual") {
  if (!PUSH_SECRET) return;
  // 5s timeout — firePush is AWAITED in the trade path; a half-open socket to push-send
  // must never stall the cron cycle past the platform wall-clock. Errors stay swallowed.
  try { await fetch(`${APP_URL}/api/push-send`, { method: "POST", headers: { "content-type": "application/json", "x-push-secret": PUSH_SECRET }, body: JSON.stringify({ title, body, tag, url: "/" }), signal: AbortSignal.timeout(5000) }); } catch { /* */ }
}
// Place an order, then poll for the ACTUAL fill price (market orders fill in ms).
// Booking at the real fill — not the mid/mark — is what makes the desk's P&L
// reconcile to the Alpaca account (a sell crosses to the bid, a buy to the ask;
// booking at mid systematically overstated P&L). Returns fill=0 if it didn't post
// in time → caller falls back to the quote.
// 2026-06-11a PARTIAL-FILL FIX: the old loop exited on the FIRST filled_avg_price>0
// observation — a `partially_filled` snapshot satisfies that with filled_qty BELOW
// the requested qty, so the desk row under-recorded and the remainder rode UNMANAGED
// (the 06-11 grind-manual ×2 incident). Now: poll until the order reaches a TERMINAL
// status; if it's still working after ~3s, CANCEL the remainder, then keep reading
// until terminal — the returned filledQty is FINAL, nothing can fill after we book.
const TERMINAL_ORDER_STATUS = new Set(["filled", "canceled", "expired", "rejected", "done_for_day", "stopped", "replaced"]);
async function aOrderAndFill(body: unknown): Promise<{ id: string; fill: number; filledQty: number; status: string }> {
  const o = await aPost("/v2/orders", body) as { id?: string; status?: string; filled_avg_price?: number; filled_qty?: number };
  const id = String(o.id ?? "");
  let status = String(o.status ?? "");
  let fill = Number(o.filled_avg_price ?? 0);
  let filledQty = Number(o.filled_qty ?? 0); // ACTUAL contracts filled (de-dup: the desk row must mirror this, not the intended qty)
  for (let i = 0; i < 13 && id && !TERMINAL_ORDER_STATUS.has(status); i++) {
    if (i === 10) { try { await aDelete(`/v2/orders/${id}`); } catch { /* it may have just gone terminal — the reads below settle it */ } }
    await new Promise((r) => setTimeout(r, 300));
    try {
      const g = await aGet(`/v2/orders/${id}`) as { status?: string; filled_avg_price?: number; filled_qty?: number };
      status = String(g.status ?? status);
      if (Number(g.filled_avg_price) > 0) fill = Number(g.filled_avg_price);
      filledQty = Number(g.filled_qty ?? filledQty);
    } catch { /* keep polling */ }
  }
  return { id, fill, filledQty, status };
}
// OCC symbol for ANY underlying (QQQ rollout): SPY/QQQ/… share the same OCC layout
// (ROOT + YYMMDD + C/P + strike×1000, 8-padded). The root is the channel's ticker.
function occSymbol(sym: string, etDate: string, strike: number, type: OptType) { const [y, m, d] = etDate.split("-"); return `${sym}${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`; }
// Realized $ to book on THIS close for a channel+OCC = the channel's ACTUAL fill-derived
// realized (broker truth, matched by the slug-prefixed client_order_id) MINUS what's
// already booked on prior closed rows for this (channel, OCC) today. Makes the CUMULATIVE
// booked equal the fill-derived realized, so shared-OCC reconcile/reconstruct churn (many
// closed rows for one netted round-trip) books $0 on the extra rows instead of re-counting
// the gain (the ~4× over-report). `extraSell` folds in a sell placed THIS cycle that isn't
// yet in the cycle-start allOrders snapshot. Live-only — DRY_RUN has no real fills.
// deno-lint-ignore no-explicit-any
async function realizedToBook(sb: any, strategistId: string, slug: string, occ: string, allOrders: Record<string, unknown>[], sinceIso: string, extraSell?: { qty: number; px: number }): Promise<number> {
  let bq = 0, bc = 0, sq = 0, sp = 0;
  for (const o of allOrders) {
    if (String(o.status) !== "filled") continue;
    if (!String(o.client_order_id ?? "").startsWith(`${slug}-${occ}-`)) continue;
    const q = Number(o.filled_qty ?? 0), p = Number(o.filled_avg_price ?? 0);
    if (String(o.side) === "buy") { bq += q; bc += q * p; } else { sq += q; sp += q * p; }
  }
  if (extraSell && extraSell.qty > 0 && extraSell.px > 0) { sq += extraSell.qty; sp += extraSell.qty * extraSell.px; }
  // realized on the round-tripped (sold) qty at blended prices; any still-open qty stays unrealized
  const target = sq > 0 && bq > 0 ? sq * (sp / sq - bc / bq) * 100 : 0;
  const { data: prior } = await sb.from("positions").select("realized_pnl").eq("strategist_id", strategistId).eq("occ_symbol", occ).eq("status", "closed").gte("closed_at", sinceIso);
  // deno-lint-ignore no-explicit-any
  const booked = (prior ?? []).reduce((a: number, r: any) => a + Number(r.realized_pnl ?? 0), 0);
  return Math.round((target - booked) * 100) / 100;
}
function aggregate(bars: Bar[], tf: number): Bar[] {
  if (tf <= 1) return bars;
  const out: Bar[] = []; let bk = -1;
  for (const b of bars) { const ms = Math.floor(b.ts / (tf * 60000)) * (tf * 60000); if (ms !== bk) { out.push({ ...b, ts: ms }); bk = ms; } else { const c = out[out.length - 1]; c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close; c.volume += b.volume; } }
  return out;
}
function etParts(ms: number) { const d = new Date(ms); const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })); return { min: et.getHours() * 60 + et.getMinutes(), date: `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}` }; }

// Effective spread (premium $/share): REAL bid/ask when usable, else modeled at
// 3% (floor $0.03). Mirrors engine/cost.ts effSpread.
function effSpreadPremium(bid: number, ask: number): number {
  if (ask > bid && bid > 0) return ask - bid;
  const mid = (ask + bid) / 2 > 0 ? (ask + bid) / 2 : ask;
  return Math.max(0.03, mid * 0.03);
}
// Round-trip cost ($/contract): both sides' half-spread + slippage + commission.
// Mirrors engine/cost.ts roundTripCostUsd, but feeds it the worker's REAL bid/ask.
function roundTripCostUsd(bid: number, ask: number): number {
  const spread = effSpreadPremium(bid, ask);
  const edgePerSideUsd = (spread / 2) * 100 + SLIPPAGE_TICKS_PER_SIDE * TICK * 100;
  return edgePerSideUsd * 2 + COMMISSION_PER_CONTRACT * 2;
}

// Alpaca order statuses that mean "still working" (not yet a fill/cancel).
const WORKING_ORDER = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated", "accepted_for_bidding"]);

// Per-underlying market context (MULTI-INSTRUMENT). Built ONCE per distinct ticker
// in use, then reused across same-ticker channels — so SPY and QQQ channels each
// read their own bars / prior-day levels / next-session expiry. Mirrors the single
// SPY block this replaced; the only change is the symbol is a parameter.
interface MarketCtx { all1m: Bar[]; session1m: Bar[]; pdh?: number; pdl?: number; next1DTE: string | null }
async function buildMarket(sym: string, todayET: string): Promise<MarketCtx> {
  // today's session 1m bars (oldest→newest), from market open, for THIS underlying
  const { data: rawBars } = await sb.from("underlying_bars").select("ts,open,high,low,close,volume,vwap").eq("symbol", sym).order("ts", { ascending: false }).limit(900);
  const all1m: Bar[] = (rawBars ?? []).filter((b: Record<string, number | null>) => b.close != null).reverse().map((b: Record<string, number | null>) => ({ ts: Date.parse(b.ts as unknown as string), open: Number(b.open ?? b.close), high: Number(b.high ?? b.close), low: Number(b.low ?? b.close), close: Number(b.close), volume: Number(b.volume ?? 0), vwap: Number(b.vwap ?? b.close) }));
  // RTH-ONLY session bars (09:30–16:00 ET = minute 570–960). SIP streams pre-market
  // bars that would satisfy warmup early AND corrupt the opening range / VWAP / ATR.
  const session1m = all1m.filter((b) => { const p = etParts(b.ts); return p.date === todayET && p.min >= 570 && p.min < 960; });
  // Prior trading day's high/low — for compiled-spec `level` conditions (ref:pdh/pdl).
  let pdh: number | undefined, pdl: number | undefined;
  {
    const dayHL = new Map<string, { hi: number; lo: number }>();
    for (const b of all1m) {
      const p = etParts(b.ts);
      if (p.min < 570 || p.min >= 960) continue; // RTH-only high/low
      const e = dayHL.get(p.date);
      if (!e) dayHL.set(p.date, { hi: b.high, lo: b.low });
      else { e.hi = Math.max(e.hi, b.high); e.lo = Math.min(e.lo, b.low); }
    }
    const priors = [...dayHL.keys()].filter((d) => d < todayET).sort();
    const prior = priors.length ? dayHL.get(priors[priors.length - 1]) : undefined;
    if (prior) { pdh = prior.hi; pdl = prior.lo; }
  }
  // Next session's expiry FOR THIS UNDERLYING (the 1DTE roll inside the close cutoff).
  // SPY & QQQ both have daily expirations, but resolve per-ticker so we never guess.
  const { data: exps } = await sb.from("option_quotes").select("expiration").eq("underlying", sym).gt("expiration", todayET).order("expiration", { ascending: true }).limit(1);
  const next1DTE = ((exps ?? [])[0] as { expiration?: string } | undefined)?.expiration ?? null;
  return { all1m, session1m, pdh, pdl, next1DTE };
}

// Inlined US market holidays (full-day closures). The cron is a self-contained Deno paste — it
// can't import engine/market-calendar.ts, so the dates are mirrored here. Used ONLY to suppress
// the false "stream stale" page on a closed day (the Railway worker doesn't beat with no market
// data → the cron would otherwise page every holiday, e.g. Juneteenth 2026-06-19). Fail-safe: a
// missing date just lets a rare benign false-page through; it NEVER gates trading. Keep in sync
// with engine/market-calendar.ts when extending the year.
const CRON_MARKET_HOLIDAYS = new Set<string>([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

Deno.serve(async () => {
  try {
    const { data: fund } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
    // status + spec_json drive the Add-Channel path (run 13_add_channel.sql BEFORE
    // deploying this — otherwise these columns don't exist and the select errors).
    const { data: strategists } = await sb.from("strategists").select("id,slug,name,underlying,status,spec_json,executor,strategist_config(*)");
    // PHASE-B (2026-06-10a): is the streaming worker alive? Fresh beat (<5 min) →
    // stream-owned channels are ENTIRELY its business this run. Stale/missing →
    // exit-only failover below (never entries). Read once per run.
    let streamFresh = false;
    try {
      const { data: hb } = await sb.from("worker_heartbeat").select("beat_at").eq("id", "stream").maybeSingle();
      const hbAge = hb ? Date.now() - Date.parse(String((hb as { beat_at?: string }).beat_at ?? 0)) : NaN;
      streamFresh = Number.isFinite(hbAge) && hbAge < 5 * 60_000;
      // STREAM-STALE PAGE (2026-06-12a): the worker can't report its own death — the cron
      // detects it here, so the cron pages. Stateless dedup: fire only while the age sits
      // inside ONE ~60s cron-cycle window past each mark (5m = just died; 1h / 2h = still
      // down), so each crossing pages exactly once. The first-run-of-day check (09:00 ET)
      // catches a worker already LONG dead (weekend death never "crosses" 5m mid-session).
      // Informational only — the EXIT-ONLY failover below never waits on a push.
      const inWin = (mark: number) => Number.isFinite(hbAge) && hbAge >= mark && hbAge < mark + 60_000;
      const nowMinET = etParts(Date.now()).min;
      const longDeadAtOpen = nowMinET === 540 && (!Number.isFinite(hbAge) || hbAge >= 121 * 60_000);
      // Suppress the page on a market holiday — the worker correctly doesn't beat with no data,
      // so a "stale" heartbeat on a closed day is expected, not an alarm (2026-06-19 fix).
      const holidayToday = CRON_MARKET_HOLIDAYS.has(etParts(Date.now()).date);
      if (!holidayToday && (inWin(5 * 60_000) || inWin(60 * 60_000) || inWin(120 * 60_000) || longDeadAtOpen)) {
        const ageTxt = Number.isFinite(hbAge) ? `${Math.round(hbAge / 60_000)}m old` : "never seen";
        await firePush("⚠ STREAM STALE", `Railway worker heartbeat ${ageTxt} — cron exit-only failover on stream channels`, "seve-alert");
      }
    } catch { /* table missing → treat as stale (cron keeps managing everything) */ }
    const account = await aGet("/v2/account");
    // Track whether the positions read SUCCEEDED — reconciliation (closing a desk
    // row with no Alpaca match) must NEVER run on a transient API error, or it
    // would wrongly flatten every channel's books at once.
    let positions: Record<string, unknown>[] = [];
    let positionsOk = true;
    try { positions = await aGet("/v2/positions"); } catch { positionsOk = false; }
    // All recent orders. Each is tagged with a per-CHANNEL client_order_id, so a
    // channel only ever looks at its OWN orders (independence — no account-wide
    // symbol guard, so two channels can hold the same contract).
    const allOrders: Record<string, unknown>[] = await aGet("/v2/orders?status=all&limit=500&direction=desc").catch(() => []);

    const nowMs = Date.now();
    const todayET = etParts(nowMs).date;
    const sessionSince = `${todayET}T00:00:00Z`; // session start (RTH session shares the UTC date) — window for fill-net realized

    // MULTI-INSTRUMENT (QQQ rollout, step 3): build market context ONCE per distinct
    // underlying among the channels (SPY default), reused across same-ticker channels.
    // Each ctx holds that ticker's RTH session bars / prior-day H-L / next-session expiry.
    // Alpaca rejects OPENING a 0DTE near the close (the 422) → inside the cutoff
    // channels roll the entry to ctx.next1DTE, resolved per-ticker from the live chain.
    // 2026-06-11: Alpaca WIDENED the lockout ~15→~30 min (422s from 15:33 ET, 27 min out) —
    // 16 rolled too late and every 15:30-15:44 entry was rejected, not rolled.
    const OPEN_0DTE_CUTOFF_MIN = 31; // last ~30 min + 1 buffer (was 16 pre-06-11)
    // MANUAL-EXIT twins (`<base>-manual`, man-vs-machine A/B): the human owns exits, but
    // a hard backstop force-flattens at minutesToClose ≤ this (≈15:57 ET) so a 0DTE/1DTE
    // can't expire/assign if the operator misses it.
    const MANUAL_BACKSTOP_MIN = 3;
    const underlyings = [...new Set((strategists ?? []).map((s) => String((s as { underlying?: string }).underlying ?? "SPY").toUpperCase()))];
    const marketByUnderlying = new Map<string, MarketCtx>();
    for (const sym of underlyings) marketByUnderlying.set(sym, await buildMarket(sym, todayET));

    // fund-level equity snapshot
    await sb.from("equity_snapshots").insert({ strategist_id: null, net_liquidation: Number(account.equity), cash: Number(account.cash), unrealized_pnl: positions.reduce((a, p) => a + Number(p.unrealized_pl ?? 0), 0) });

    // SHARED-OCC SELL COORDINATION (de-dup Fix 2): a per-OCC running count of Alpaca's
    // held qty. When several channels exit the SAME netted lot in ONE cycle, each sells
    // only its share off the LIVE remaining (decremented as we go) instead of the stale
    // cycle-start snapshot — so a sibling can't over-draw and starve another channel
    // (with 2026-06-09b's reconcile as the floor). Seeded from Alpaca's positions.
    const remainingByOcc = new Map<string, number>();
    for (const p of positions) remainingByOcc.set(String(p.symbol), Math.abs(Math.round(Number(p.qty ?? 0))));

    // RECONSTRUCT GATE input (anti-ghost): Σ open desk-row qty per OCC across ALL channels.
    // The reconstruct/re-buy guard resurrects a row when a channel's filled orders net long
    // with no open row (a genuinely lost insert). But a channel whose shared contracts were
    // SOLD BY A SIBLING (rejected own exit, or a pre-fix manual close it can't see) ALSO nets
    // long with no row → it kept resurrecting GHOST rows at the stale entry. Gate: only
    // reconstruct if Alpaca holds UNCOVERED contracts (held − already-claimed-by-open-rows).
    const openRowQtyByOcc = new Map<string, number>();
    {
      const { data: allOpen } = await sb.from("positions").select("occ_symbol,qty").eq("status", "open");
      for (const r of (allOpen ?? [])) openRowQtyByOcc.set(String(r.occ_symbol), (openRowQtyByOcc.get(String(r.occ_symbol)) ?? 0) + Math.abs(Math.round(Number(r.qty ?? 0))));
    }

    const out: Record<string, unknown>[] = [];
    for (const s of (strategists ?? [])) {
     // Per-channel isolation: a throw in compileSpec/build/evaluate (e.g. a malformed
     // armed spec_json) for ONE channel must NOT abort the whole run — every other
     // channel would be skipped that minute. Journal it and move on. (Body kept at its
     // original indent to keep the diff minimal; the try just brackets the iteration.)
     try {
      const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
      if (!cfg) continue;                                           // no config → idle
      // PHASE-B executor gate (2026-06-10a): a 'stream'-owned channel is the Railway
      // worker's to trade. Heartbeat fresh → not ours at all this run (skipping is what
      // makes double-execution impossible). Heartbeat stale → fall through in EXIT-ONLY
      // failover: exits/reconcile/mark-to-market still run, entries are hard-blocked below.
      const streamOwned = String((s as { executor?: string }).executor ?? "cron") === "stream";
      if (streamOwned && streamFresh) { out.push({ slug: s.slug, note: "stream_owned" }); continue; }
      if (streamOwned) await journal("WARN", `${s.slug}: stream heartbeat STALE — cron exit-only failover this cycle`);
      // MULTI-INSTRUMENT: this channel's market. Default SPY for legacy rows. If the
      // ticker has no session bars yet (e.g. QQQ not ingested this session), skip —
      // never trade blind on an empty tape.
      const sym = String((s as { underlying?: string }).underlying ?? "SPY").toUpperCase();
      const mkt = marketByUnderlying.get(sym);
      if (!mkt || !mkt.session1m.length) { out.push({ slug: s.slug, note: "no_market", underlying: sym }); continue; }
      // Resolve this channel's edge: a built-in CODE strategy (REGISTRY) or a
      // COMPILED spec (spec_json from the row — the Add-Channel path).
      // Base-slug resolve (multi-instrument code clones): a channel named
      // `<base>-qqq` / `<base>-spy` runs the SAME code strategy as `<base>` (e.g.
      // breakout-qqq → ORB) — only the underlying differs, and that's already routed
      // per s.underlying. Exact slug wins; a compiled .md channel (arbitrary slug)
      // still finds no REGISTRY hit and falls through to its spec_json.
      // base-slug fallback: a DUPLICATE (`<base>-2`,`-3` — the A/B primitive) strips its trailing
      // -N first; then a `-manual` twin suffix (and the ticker suffix) so a built-in twin
      // (power-manual → power) resolves; a compiled twin/clone misses REGISTRY and runs via its
      // CLONED spec_json below. Provably safe — no built-in slug ends in -<digits>.
      const code = REGISTRY[s.slug] ?? REGISTRY[s.slug.replace(/-\d+$/, "").replace(/-manual$/i, "").replace(/-(qqq|spy)$/i, "")];
      const compiled = !code && s.spec_json ? compileSpec(s.spec_json) : null;
      if (!code && !compiled) { out.push({ slug: s.slug, note: "no_edge" }); continue; }
      const tf = code ? code.tf : compiled!.tf;
      const warmup = code ? code.warmup : compiled!.warmup;
      // ARM gate: only 'armed' channels open NEW positions. A 'draft'/'disabled'
      // channel (e.g. one the operator deleted) still MANAGES an open position —
      // exits + reconcile run below so it winds down — it just can't enter.
      // status missing (pre-13_add_channel.sql) → treat as armed so built-ins run.
      const status = (s as { status?: string }).status ?? "armed";
      const armBlocked = status !== "armed";
      const guardBlocked = fund?.is_halted ? "halted" : cfg.muted ? "muted" : fund?.mode !== "paper" ? "not_paper" : null;

      const bars = aggregate(mkt.session1m, tf);
      if (bars.length < warmup) { out.push({ slug: s.slug, note: "warmup" }); continue; }
      const i = bars.length - 1;
      const last = bars[i];
      const { min: etMin } = etParts(last.ts);
      const minutesToClose = Math.max(0, 16 * 60 - etMin);          // real time-to-close (16:00 ET)
      const f = computeFeatures(bars, i, minutesToClose);

      // this channel's open position (desk row = source of truth) + Alpaca match
      const { data: rows } = await sb.from("positions").select("*").eq("strategist_id", s.id).eq("status", "open");
      const row = (rows ?? [])[0];
      const alp = row ? positions.find((p) => String(p.symbol) === String(row.occ_symbol)) : undefined;
      // Reconstruct the REAL entry bar index from opened_at (was hardcoded 0 — so
      // time-stops measured from bar 0 and fired on the FIRST evaluation = churn,
      // and no position could truly be held). A position opened before today's
      // first bar (a 1DTE held overnight) resolves to index 0 → its time-stop trips
      // at the next session's open and winds it down, which is what we want.
      let entryMinute = i; // default: brand-new this run
      if (row?.opened_at) {
        const entryMs = Date.parse(String(row.opened_at));
        const idx = bars.findIndex((b) => b.ts >= entryMs);
        entryMinute = idx >= 0 ? idx : i;
      }
      // STATE PARITY with the engine (was the cause of two live-only bugs):
      //   • entryUnderlying was the ROUNDED strike — off by up to $0.50, LARGER
      //     than grind's 0.5–0.6·ATR target/stop on 1-min ATR (~$0.08–0.24), so
      //     grind booked target/stop on the entry-rounding within a minute (the
      //     "holds ~1 min, tiny gain/loss" behavior). Use the actual close at the
      //     entry bar instead.
      //   • peakFavorable was reset to f.close every run → breakout's trail test
      //     (close < peak − 1.5·ATR) was ALWAYS false → the trailing stop never
      //     fired and winners only exited on EOD/failed-break. Rebuild the running
      //     peak (best/worst close since entry) like simulateSession does.
      // Both derive from the session bars + reconstructed entryMinute — NO schema
      // change. (A position carried overnight resolves entryMinute→0, so these span
      // this session's open onward — the engine also resets its peak per session.)
      let entryUnderlying = Number(row?.strike ?? f.close);
      let peakFavorable = f.close;
      if (row && entryMinute >= 0 && entryMinute < bars.length) {
        entryUnderlying = bars[entryMinute].close;
        peakFavorable = bars[entryMinute].close;
        for (let j = entryMinute; j <= i; j++) {
          peakFavorable = row.opt_type === "call" ? Math.max(peakFavorable, bars[j].close) : Math.min(peakFavorable, bars[j].close);
        }
      }
      const pos: Pos | null = row ? { optType: row.opt_type, entryMinute, entryUnderlying, peakFavorable } : null;

      // Build this channel's evaluator (spec evaluators precompute over `bars`;
      // pass prior-day levels for `level` pdh/pdl conditions).
      const evaluate: Evaluate = code ? code.evaluate : compiled!.build(bars, { pdh: mkt.pdh, pdl: mkt.pdl });
      let intent = evaluate(f, pos);

      // TRAIL + premium profit/stop (compiled specs). The ARMABLE TRAIL (the live
      // unlock): an underlying ATR-chandelier — once the position is in profit, exit
      // when price retraces k·ATR from the peak FAVORABLE underlying. peakFavorable is
      // reconstructed from session bars (stateless — no new column), the same trail
      // breakout's code uses (the right exit for 0DTE momentum; premium-giveback is too
      // noisy and isn't worker-supported in V1). It harvests the convex tail. The
      // premium stop/target STILL apply (the trail governs winners; the stop guards
      // losers) — a trail .md sets a high profitPct so the trail, not the cap, runs.
      const premiumExit = compiled?.premiumExit;
      const trailK = compiled?.trail?.atrChandelierK;
      if (pos && row && alp && (!intent || intent.kind !== "exit")) {
        if (trailK != null && f.atr > 0) {
          const inProfit = pos.optType === "call" ? f.close > pos.entryUnderlying : f.close < pos.entryUnderlying;
          const retraced = pos.optType === "call"
            ? f.close <= pos.peakFavorable - trailK * f.atr
            : f.close >= pos.peakFavorable + trailK * f.atr;
          if (inProfit && retraced) intent = { kind: "exit", reason: "trail_chandelier" };
        }
      }
      // ---- UNDERLYING INITIAL STOP (config-gated; the primary loss stop) ----
      // Fires BEFORE the premium stop below — a uniform underlying-distance stop instead
      // of the premium-noise -50% stop. Uses the reconstructed entryUnderlying (no schema
      // change). Profit exits (trail/target) above already won, so this only binds a
      // LOSING position. Also SHADOW-logs the tighter 0.15% at its first crossing so we can
      // A/B it against the live 0.20% with no colliding live channel (one-live-shadow-other).
      if (pos && row && pos.entryUnderlying > 0 && (!intent || intent.kind !== "exit")) {
        const usPct = Number(cfg.underlying_stop_pct ?? 0);
        const adversePct = (pos.optType === "call" ? (pos.entryUnderlying - f.close) : (f.close - pos.entryUnderlying)) / pos.entryUnderlying * 100;
        if (usPct > 0) {
          // shadow: log ONCE at the minute adverse first crosses the tighter 0.15% (band [0.15, live))
          const prevClose = entryMinute >= 0 && i > entryMinute ? bars[i - 1].close : f.close;
          const prevAdv = (pos.optType === "call" ? (pos.entryUnderlying - prevClose) : (prevClose - pos.entryUnderlying)) / pos.entryUnderlying * 100;
          if (SHADOW_US_STOP_PCT < usPct && prevAdv < SHADOW_US_STOP_PCT && adversePct >= SHADOW_US_STOP_PCT) {
            await journal("INFO", `stream-shadow: US${SHADOW_US_STOP_PCT} ${s.slug} ${row.occ_symbol} would exit @ undl ${f.close.toFixed(2)} (adverse ${adversePct.toFixed(3)}%) mark ${Number(alp?.current_price ?? 0).toFixed(2)}`);
          }
          if (adversePct >= usPct) intent = { kind: "exit", reason: "underlying_stop" };
        }
      }
      if (pos && row && alp && premiumExit && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0) {
          if (premiumExit.profitPct != null && markPx >= entryPx * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && markPx <= entryPx * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        }
      }
      // EOD flatten for a position whose contract expires AFTER today (a 1DTE).
      // Every 1DTE here is a LATE-DAY ROLL: a signal fired inside the 0DTE open
      // cutoff (last ~15 min, OPEN_0DTE_CUTOFF_MIN), so the entry rolled to
      // next1DTE because Alpaca won't open a 0DTE that late. That roll is meant to
      // swing the high-volume final 20 min and CLOSE SAME-DAY — NOT carry overnight.
      // So flatten by the SESSION close, not the contract expiry: if it was opened
      // THIS session, let the eod_flatten fire. Only a position held from a PRIOR
      // session (a genuine multi-day hold — none exist today, but keep the door
      // open) is exempt and managed as a 0DTE on its own expiry day. Its own
      // stops/targets still fire either way (handled above).
      //   Bug before: this nulled the flatten for ALL expiration>today rows, so the
      //   late rolls carried overnight (e.g. 2026-06-08 PowerFinal30 739P + POWERHOUR
      //   739C both stuck open to their 06-09 expiry).
      if (intent?.kind === "exit" && intent.reason === "eod_flatten" && row && String(row.expiration ?? todayET) > todayET) {
        const openedET = row.opened_at ? etParts(Date.parse(String(row.opened_at))).date : todayET;
        if (openedET !== todayET) intent = null; // opened a PRIOR session → genuine overnight hold, don't force-flatten today
      }

      // ---- PREMIUM CATASTROPHIC STOP (all channels) ----
      // A hard backstop the built-ins' ATR/structural stops lack: if the option's
      // REAL Alpaca mark has cratered ≥ PREMIUM_STOP_PCT% below entry, exit now —
      // whatever the channel's own evaluator says. Applies to code AND compiled
      // channels, and to a 1DTE held overnight (a cratered option is still
      // cratered). A genuine exit already in `intent` (incl. a compiled spec's own
      // tighter stop_premium) wins on its own — this only fires when nothing else
      // would exit. From the A/B verdict: caps the losers the ATR stops miss.
      if (pos && row && alp && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0 && markPx <= entryPx * (1 - PREMIUM_STOP_PCT / 100)) {
          intent = { kind: "exit", reason: "premium_stop" };
        }
      }

      // ---- POWER giveback trail (lock gains after +100%) ----
      // Tail-safe: engages only after the option doubled, then exits on a > 40%
      // giveback of the peak GAIN. The peak premium is reconstructed from the
      // option_quotes per-minute mark history (no schema change — same approach as
      // the underlying-peak fix). Power-only; mirrors manage.ts premium_giveback
      // with the engage-at-+100% trigger that power-probe found tail-safe.
      if (pos && row && alp && POWER_TRAIL_CHANNELS.has(s.slug) && (!intent || intent.kind !== "exit")) {
        const entryPx = Number(row.avg_entry_price ?? 0);
        const markPx = Number(alp.current_price ?? 0);
        if (entryPx > 0 && markPx > 0) {
          const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", row.occ_symbol).gte("captured_at", row.opened_at).order("mid", { ascending: false }).limit(1).maybeSingle();
          const peak = Math.max(markPx, Number(pk?.mid ?? 0));
          if (peak >= entryPx * POWER_TRAIL_ENGAGE_MULT) {            // ever reached +100% → trail engaged
            const givebackLevel = entryPx + (peak - entryPx) * (1 - POWER_TRAIL_GIVEBACK_PCT / 100);
            if (markPx <= givebackLevel) intent = { kind: "exit", reason: "trail_giveback" };
          }
        }
      }

      // ---- reconcile: desk row OPEN but Alpaca has no such position ----
      // Happens when another channel holding the SAME 0DTE sold the netted lot,
      // on expiry, or a manual close. Close the orphan so it stops showing open
      // (valued at the last option quote — best-effort; the close already
      // happened on Alpaca). Only when the positions read succeeded.
      if (row && !alp && positionsOk) {
        // Prefer the ACTUAL sell fill — a manual close via the Alpaca app (or a
        // shared-OCC exit) leaves a filled SELL order for this contract. Book at
        // that real price so the desk reconciles to the account. Fallbacks: the
        // latest quote BID (a sell crosses to the bid — not the optimistic mid),
        // then 0 (worthless). allOrders is newest-first, so [0] is the last fill.
        const sellFill = allOrders.find((o) => String(o.symbol) === String(row.occ_symbol) && String(o.side) === "sell" && String(o.status) === "filled" && Number(o.filled_avg_price) > 0);
        let mark = sellFill ? Number(sellFill.filled_avg_price) : 0;
        let src = sellFill ? "actual fill" : "";
        if (!mark) { const { data: q } = await sb.from("option_quotes").select("bid,mid").eq("occ_symbol", row.occ_symbol).order("captured_at", { ascending: false }).limit(1).maybeSingle(); mark = Number(q?.bid ?? q?.mid ?? 0); src = "last quote bid"; }
        // Book the FILL-DERIVED realized (idempotent vs prior closed rows for this
        // channel+OCC) so shared-OCC churn can't re-book; `mark` is display-only now.
        // (The sell already happened, so it's in allOrders — no extraSell needed.)
        const realized = DRY_RUN
          ? (mark - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 100
          : await realizedToBook(sb, s.id, s.slug, row.occ_symbol, allOrders, sessionSince);
        await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: mark, realized_pnl: realized, close_reason: "reconciled" }).eq("id", row.id);
        await journal("WARN", `${s.slug}: reconciled ${row.occ_symbol} @ ${mark.toFixed(2)} (${src}) — no Alpaca position; booked $${realized.toFixed(0)} (fill-net)`);
        out.push({ slug: s.slug, note: "reconciled" });
        continue;
      }
      const canTrade = !guardBlocked; // ENTRIES gated by mute / halt / not-paper
      // EXITS must wind down regardless of MUTE — a muted channel still MANAGES its open
      // position to close (matching draft/disabled, which already exit). The bug: mute fell
      // under canTrade, so it blocked the exit AND the EOD flatten → a muted 0DTE was trapped
      // and rode to expiry. Now only the KILL switch (halted) or a non-paper mode freezes exits.
      const canExit = guardBlocked !== "halted" && guardBlocked !== "not_paper";

      // ---- MANUAL-EXIT twin (man-vs-machine A/B) ----
      // A `<base>-manual` channel takes the base strategy's ENTRIES (resolved above) but
      // the HUMAN owns the exits: DROP every programmed exit intent (stop / trail / target /
      // eod_flatten / catastrophic) so the position rides until the operator closes it via the
      // close-position button. The ONE forced exit is a hard bell backstop near the close so a
      // 0DTE/1DTE can't expire/assign if missed. Distinct reason `manual_eod_backstop` so the
      // 1DTE-flatten guard above can't null it. Entries are untouched (the machine still picks
      // them) — only the exit policy differs, which is the whole experiment.
      const isManual = /-manual$/i.test(s.slug);
      if (isManual && row) {
        if (minutesToClose <= MANUAL_BACKSTOP_MIN) intent = { kind: "exit", reason: "manual_eod_backstop" };
        else if (intent?.kind === "exit") intent = null;
      }

      // ---- exit ----
      if (intent?.kind === "exit" && row && alp && canExit) {
        // Sell ONLY what Alpaca ACTUALLY holds for this OCC, capped to this channel's
        // row qty. On a SHARED/netted OCC a sibling channel can drain the lot first;
        // selling more than is held opens a naked short put (Alpaca 403 40310000
        // "insufficient options buying power for cash-secured put"). The OLD code did
        // Math.max(1, …) → it always tried to sell ≥1 even when 0 was held, so a
        // drained position looped a rejected sell EVERY minute and rode to expiry
        // trapped (the +$700→−$700 ORB round-trip that couldn't exit at any point).
        // Use the LIVE per-OCC remaining (de-dup Fix 2): if a sibling already sold this
        // netted lot earlier THIS cycle, remaining reflects it → we never over-draw. Falls
        // back to the cycle-start snapshot qty if the OCC isn't mapped.
        const heldQty = remainingByOcc.get(String(row.occ_symbol)) ?? Math.max(0, Math.round(Number(alp.qty)));
        const sellQty = Math.min(heldQty, Number(row.qty));
        // Close the row at its FILL-NET realized (its own slug-prefixed buys/sells; $0
        // if a sibling sold the shared lot) when we can't/shouldn't place a sell — so a
        // trapped position is freed instead of looping. Fund stays NAV-true either way.
        const reconcileClose = async (why: string) => {
          const realized = DRY_RUN ? 0 : await realizedToBook(sb, s.id, s.slug, row.occ_symbol, allOrders, sessionSince);
          const { data: q } = await sb.from("option_quotes").select("bid,mid").eq("occ_symbol", row.occ_symbol).order("captured_at", { ascending: false }).limit(1).maybeSingle();
          const mark = Number(q?.bid ?? q?.mid ?? alp.current_price ?? 0);
          await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: mark, realized_pnl: realized, close_reason: "reconciled" }).eq("id", row.id);
          await journal("WARN", `${s.slug}: ${row.occ_symbol} ${why} — reconciled closed @ ${mark.toFixed(2)} (booked $${realized.toFixed(0)} fill-net)`);
        };
        if (sellQty <= 0) {
          // Nothing left to sell (a sibling drained the netted lot) → free the row now.
          await reconcileClose(`shared lot drained (Alpaca holds ${heldQty})`);
        } else {
          try {
            // Book at the ACTUAL sell fill (crosses to the bid), not alp.current_price
            // (the mid/mark) — booking at mid overstated realized P&L vs the account.
            // DRY_RUN / fill-not-posted → fall back to the mark.
            let exitPx = Number(alp.current_price ?? 0);
            let soldQty = sellQty; // ACTUAL contracts sold (terminal-final, 2026-06-11a)
            let unfilled = false;
            if (!DRY_RUN) {
              const r = await aOrderAndFill({ symbol: row.occ_symbol, qty: String(sellQty), side: "sell", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${row.occ_symbol}-${etMin}-x` });
              if (r.fill > 0) exitPx = r.fill;
              if (r.filledQty > 0) soldQty = r.filledQty; // partial→canceled: book what REALLY sold; the 09d reconstruct re-rows the leftover next cycle
              else if (TERMINAL_ORDER_STATUS.has(r.status)) unfilled = true; // terminal with 0 sold — nothing happened
            }
            if (unfilled) {
              // Known-terminal sell with NOTHING sold (pre-fix this booked a phantom close
              // at the mark while the contracts stayed held). Row stays open; retry next cycle.
              await journal("WARN", `${s.slug}: exit ${row.occ_symbol} ended unfilled — row stays open to retry`);
            } else {
              // FILL-DERIVED realized (idempotent vs prior closed rows for this channel+OCC);
              // this cycle's sell isn't in the cycle-start allOrders yet, so fold it in.
              const realized = DRY_RUN
                ? (exitPx - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 100
                : await realizedToBook(sb, s.id, s.slug, row.occ_symbol, allOrders, sessionSince, { qty: soldQty, px: exitPx });
              // close_reason (31_close_reason.sql): durable exit attribution — the journal
              // says the same but events expire (30d); the column is the dataset.
              await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), current_mark: exitPx, realized_pnl: realized, close_reason: intent.reason }).eq("id", row.id);
              // de-dup Fix 2: drop this OCC's remaining by what we just sold so a sibling
              // exiting the same lot later this cycle sees the true leftover.
              remainingByOcc.set(String(row.occ_symbol), Math.max(0, heldQty - soldQty));
              await journal("EXEC", `${s.slug}: exit ${row.occ_symbol} ×${soldQty} @ ${exitPx.toFixed(2)} (${intent.reason})`);
            }
          } catch (e) {
            // A "can't sell, would go short" rejection = the shared-OCC race (snapshot
            // said held, a sibling drained it this cycle). Reconcile closed at fill-net
            // instead of looping the rejected sell to expiry. Other (transient) errors
            // leave the row open to retry next minute.
            const msg = (e as Error).message;
            if (/insufficient|cash.?secured|not enough|40310000/i.test(msg)) await reconcileClose(`sell rejected (${msg.slice(0, 50)})`);
            else await journal("WARN", `${s.slug}: exit ${row.occ_symbol} rejected — ${msg}`);
          }
        }
      }

      // ---- entry ----
      if (intent?.kind === "enter" && !row) {
        const dir = intent.direction;
        const strike = Math.round(f.close);
        // Alpaca won't let us OPEN a 0DTE inside the close cutoff → roll the entry
        // to the next expiry (1DTE) so the signal still gets acted on. Otherwise
        // use today (0DTE). entryExpiry drives both the OCC symbol and the row.
        const inCutoff = minutesToClose <= OPEN_0DTE_CUTOFF_MIN;
        const entryExpiry = inCutoff ? mkt.next1DTE : todayET;
        const occ = occSymbol(sym, entryExpiry ?? todayET, strike, dir);
        let blocked = guardBlocked;
        if (!blocked && streamOwned) blocked = "stream_owned"; // failover = exits only; the stream owns entries
        if (!blocked && armBlocked) blocked = "not_armed"; // draft/disabled → no new entries
        if (!blocked && !entryExpiry) blocked = "no_1dte_chain"; // in cutoff but no next expiry quoted
        // Per-CHANNEL idempotency (independence): look ONLY at THIS channel's own
        // orders, tagged by a slug-prefixed client_order_id — never the shared
        // account. So another channel holding `occ` does NOT block this one.
        const myOrders = allOrders.filter((o) => String(o.client_order_id ?? "").startsWith(`${s.slug}-${occ}-`));
        if (!blocked && myOrders.some((o) => WORKING_ORDER.has(String(o.status)))) blocked = "order_working";
        // Re-buy-loop guard, per channel: if THIS channel's filled orders net to a
        // long position in `occ` but there's no open desk row, the insert was lost
        // last run — RECONSTRUCT the row from the fills instead of buying again.
        if (!blocked) {
          const filled = myOrders.filter((o) => String(o.status) === "filled");
          const net = filled.reduce((q, o) => q + (String(o.side) === "buy" ? 1 : -1) * Number(o.filled_qty ?? 0), 0);
          if (net > 0) {
            // ANTI-GHOST GATE: reconstruct ONLY if Alpaca actually holds UNCOVERED contracts
            // for this OCC (held − already claimed by OTHER channels' open rows). If the
            // contracts are gone (sold by a sibling / pre-fix manual close / rejected exit),
            // net stays long forever with nothing behind it → the old code resurrected a GHOST
            // row at the stale entry every cycle (orb 735P / grind-manual 736C). Then neither
            // reconstruct NOR re-buy a liquidated position. Preserves the re-buy SAFETY: when
            // Alpaca DOES hold the contracts (true lost insert) it still reconstructs, never buys.
            const alpHeld = Math.abs(Math.round(Number((positions.find((p) => String(p.symbol) === occ))?.qty ?? 0)));
            const uncovered = alpHeld - (openRowQtyByOcc.get(occ) ?? 0); // this channel has no open row
            if (uncovered >= net) {
              const buys = filled.filter((o) => String(o.side) === "buy");
              const totBuy = buys.reduce((q, o) => q + Number(o.filled_qty ?? 0), 0);
              const avg = totBuy ? buys.reduce((s2, o) => s2 + Number(o.filled_avg_price ?? 0) * Number(o.filled_qty ?? 0), 0) / totBuy : 0;
              await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: sym, expiration: entryExpiry ?? todayET, strike, opt_type: dir, qty: net, avg_entry_price: avg, current_mark: avg, unrealized_pnl: 0, status: "open" });
              await journal("WARN", `${s.slug}: recovered ${net} ${occ} from filled orders (lost insert) — not re-buying`);
              openRowQtyByOcc.set(occ, (openRowQtyByOcc.get(occ) ?? 0) + net); // it now claims these
              blocked = "reconstructed";
            } else {
              // contracts liquidated elsewhere — don't ghost, don't re-buy the dead position.
              blocked = "liquidated_elsewhere";
            }
          }
        }
        // Stop knob (daily_stop_usd): halt NEW entries once this channel's REALIZED
        // P&L today is at/under its loss budget. Open positions keep managing their
        // own exits — this only stops ADDING risk. (Was a no-op before.)
        if (!blocked && Number(cfg.daily_stop_usd) > 0) {
          const { data: closed } = await sb.from("positions").select("realized_pnl,closed_at").eq("strategist_id", s.id).eq("status", "closed").order("closed_at", { ascending: false }).limit(100);
          let realizedToday = 0;
          for (const c of (closed ?? [])) if (c.closed_at && etParts(Date.parse(c.closed_at as string)).date === todayET) realizedToday += Number(c.realized_pnl ?? 0);
          if (realizedToday <= -Number(cfg.daily_stop_usd)) blocked = "daily_stop";
        }
        let qty = 0, ask = 0, bid = 0, delta = ATM_DELTA, roundTrip = 0, expectedMove = 0;
        if (!blocked) {
          const { data: q } = await sb.from("option_quotes").select("ask,bid,delta").eq("occ_symbol", occ).order("captured_at", { ascending: false }).limit(1).maybeSingle();
          ask = Number(q?.ask ?? 0);
          bid = Number(q?.bid ?? 0);
          if (q?.delta != null && Number(q.delta) !== 0) delta = Math.abs(Number(q.delta)); // puts carry δ<0; magnitude is what we want
          if (!ask) blocked = "no_quote";
        }
        // COST GATE (entry veto): the dominant 0DTE cost is the round-trip spread.
        // Block an entry whose expected premium move on a ~1·ATR favorable move
        // doesn't clear that cost by COST_GATE_RATIO. Uses the REAL bid/ask + the
        // quote's delta (ATM 0.5 proxy when absent). Mirrors engine/manage.ts
        // costGatePass — this is what cut grind's churn in the A/B. COST_GATE_EXEMPT is
        // now EMPTY (the `power` exemption was removed 2026-06-09 — see its definition).
        if (!blocked && !COST_GATE_EXEMPT.has(s.slug)) {
          roundTrip = roundTripCostUsd(bid, ask);
          expectedMove = delta * Math.max(0, f.atr) * 100;
          if (expectedMove < COST_GATE_RATIO * roundTrip) blocked = "cost_gate";
        }
        if (!blocked) {
          // RISK-BASED sizing (two-dial model): capital_pct now holds RISK $/trade. Risk
          // per contract = the −50% premium stop = 0.5 × ask × 100. qty = riskUsd ÷ that,
          // capped by max_contracts (hidden ceiling). Replaces the inert capital%×aggr%
          // budget that pinned qty to max every time.
          const riskUsd = Number(cfg.capital_pct);
          const riskPerContract = 0.5 * ask * 100;
          qty = riskPerContract > 0 ? Math.max(0, Math.min(Math.floor(riskUsd / riskPerContract), Number(cfg.max_contracts))) : 0;
          if (qty === 0) blocked = "insufficient_capital";
        }
        await sb.from("signals").insert({ strategist_id: s.id, signal_type: intent.reason, underlying_price: f.close, direction: dir, acted_on: !blocked, blocked_reason: blocked, rationale: { occ, ask, bid, qty, delta: Number(delta.toFixed(3)), roundTrip: Number(roundTrip.toFixed(2)), expectedMove: Number(expectedMove.toFixed(2)), atr: Number(f.atr.toFixed(2)), er: Number(f.er.toFixed(2)), relVol: Number(f.relVol.toFixed(2)) } });
        if (!blocked && qty > 0 && !DRY_RUN) {
          try {
            // Book entry at the ACTUAL buy fill (poll the order), not the quoted
            // ask — so the round-trip P&L matches the account. Fallback to ask.
            const o = await aOrderAndFill({ symbol: occ, qty: String(qty), side: "buy", type: "market", time_in_force: "day", client_order_id: `${s.slug}-${occ}-${etMin}` });
            const entryPx = o.fill > 0 ? o.fill : ask;
            // Record the ACTUAL filled qty (de-dup Fix 1) so the desk row mirrors what
            // Alpaca really holds — else Σ(shared rows) drifts ABOVE the netted lot and the
            // last channel to exit gets starved (the trap class). The terminal-status poll
            // (2026-06-11a) makes filledQty FINAL: 0 on a known-terminal order means NOTHING
            // filled → no row (pre-fix this inserted the INTENDED qty = a ghost). Fall back
            // to the intended qty only when the status couldn't be read at all.
            const fillQty = o.filledQty > 0 ? o.filledQty : (TERMINAL_ORDER_STATUS.has(o.status) ? 0 : qty);
            if (fillQty <= 0) {
              await journal("WARN", `${s.slug}: buy ${occ} ended ${o.status || "unfilled"} ×0 — no contracts, no row`, { order_id: o.id });
            } else {
              // CRITICAL: confirm the position row was recorded. A silent insert
              // failure here is what caused the re-buy loop — if it fails, journal
              // LOUD (the per-channel guards above still prevent another buy).
              const { error: posErr } = await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: sym, expiration: entryExpiry ?? todayET, strike, opt_type: dir, qty: fillQty, avg_entry_price: entryPx, current_mark: entryPx, unrealized_pnl: 0, status: "open" });
              if (posErr) await journal("WARN", `${s.slug}: ORDER FILLED but position insert FAILED (${posErr.message}) — reconcile manually`, { occ, order_id: o.id });
              else {
                await journal("EXEC", `${s.slug}: buy ${fillQty} ${occ} @ ${entryPx.toFixed(2)} (${intent.reason})`, { order_id: o.id });
                // de-dup Fix 2: a buy adds to the shared lot — keep remaining in sync so a
                // sibling exiting this OCC later this cycle sees the larger leftover.
                remainingByOcc.set(occ, (remainingByOcc.get(occ) ?? 0) + fillQty);
                // MANUAL-EXIT twin: ping the operator to go own the exit (Phase 2 web push).
                if (isManual) await firePush(`✋ ${s.name ?? s.slug}`, `opened ${strike}${dir === "call" ? "C" : "P"} ×${fillQty} — your exit`);
              }
            }
          } catch (e) {
            // Order rejected (e.g. Alpaca 422) — journal the reason, don't crash
            // the run or insert a phantom position; just record the blocked signal.
            await journal("WARN", `${s.slug}: buy ${occ} rejected — ${(e as Error).message}`);
          }
        }
        out.push({ slug: s.slug, dir, blocked, qty });
      } else if (row && alp) {
        // mark-to-market the open desk row. Compute unrealized PER CHANNEL —
        // (mark − THIS channel's entry) × its qty — NOT alp.unrealized_pl, which is
        // the NETTED lot when several channels hold the same OCC (so every mirror row
        // showed the same wrong number, unreconciled with its own entry). The mark is
        // shared/correct; entry+qty are per-channel. Display-only — no decision reads
        // unrealized_pnl (exits use the mark; the fund snapshot still uses Alpaca's net).
        const markPx = Number(alp.current_price ?? 0);
        const unreal = Math.round((markPx - Number(row.avg_entry_price ?? 0)) * Number(row.qty) * 10000) / 100;
        await sb.from("positions").update({ current_mark: markPx, unrealized_pnl: unreal }).eq("id", row.id);
      }
     } catch (chErr) {
       // Isolate this channel's failure; the rest of the fleet still runs this minute.
       await journal("WARN", `dispatcher: channel ${(s as { slug?: string }).slug ?? "?"} failed — ${(chErr as Error).message}`);
       out.push({ slug: (s as { slug?: string }).slug, note: "error", error: (chErr as Error).message });
     }
    }
    return Response.json({ ok: true, dryRun: DRY_RUN, channels: out });
  } catch (e) {
    await journal("WARN", `paper-trader(dispatcher) failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
