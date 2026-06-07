# SEVE — project memory / session handoff

SEVE is a SPY 0DTE/1DTE paper-trading "desk": a Next.js dashboard over a Supabase
Postgres DB, a backtest engine, and a live paper-trading worker. This file is the
durable context for a new session. Read it first.

- **Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE
- **Supabase project ref:** `xvdfsxwwedltvdktqdac` (free tier — mind the 0.5 GB cap).
- Deploys auto on `git push` to `main` (Vercel; SSH deploy key already configured).

## SESSION HANDOFF — 2026-06-07 — READ THIS FIRST
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
- **ARM BREAK(ALT V3):** run `27_breakout_alt_v3.sql` → live paper A/B vs BREAK(ALT) this week; watch
  Desk P&L; if V3 leads across a trending stretch too, retire base BREAK.
- **power/grind:** let the live A/B decide — backtest can't rank them. Don't swap.
- **grind-v3 RISK = $500** (should be ~$150 small-validation) — still unresolved from the prior handoff.
- Optional: proper **regime study** = classify SESSIONS by intraday character (not monthly ER) + control
  spot-level cost. Optional: `drop index idx_bars_symbol_ts` (~14MB).
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
