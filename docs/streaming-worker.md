# Streaming worker — the third engine driver (scope)

Status: **Phase B EXECUTION BUILT (`stream-2026-06-10a`) — per-channel cutover, OFF
by default.** The worker can now place real orders, but ONLY for channels whose
`strategists.executor='stream'` (30_executor_cutover.sql, applied) AND only after
the TWO-KEY turn on Railway env: `DRY_RUN=false` + `LIVE_TRADING=true` (+ service
role). Out of the box nothing changes: every channel defaults `executor='cron'`,
Railway env stays `DRY_RUN=true`, so the deploy is inert shadow exactly as Phase A.

## Phase B cutover runbook (per-channel, reversible)
1. **B0 (this deploy, inert):** push → Railway redeploys shadow. Cron `2026-06-10a`
   (paste/MCP-deploy) adds the executor gate: stream-owned channels are skipped
   while `worker_heartbeat('stream')` is fresh (<5 min), and fall back to
   **EXIT-ONLY failover** (never entries) when it's stale — a dead Railway box
   can't strand an open 0DTE.
2. **B1 (first channel):** set Railway env `DRY_RUN=false LIVE_TRADING=true`, then
   `update strategists set executor='stream' where slug='grind-v3';` (small RISK,
   trades often = fastest validation). Watch: heartbeat rows, `stream:` events,
   fills booking fill-net, cron logging `stream_owned` skips. Rollback at ANY
   moment: set executor back to 'cron' (cron resumes within a cycle).
3. **B2:** migrate the SPY roster tier-by-tier (probation channels first, the
   proven BREAK(ALT)/V3 last).
4. **B3:** add QQQ support (second symbol/stream or a second instance with
   `SYMBOL=QQQ` — the `ownedBy` guard already scopes each instance to its symbol),
   then migrate QQQ channels.
5. **B4 (full cutover):** `select cron.unschedule('seve-paper-trader');`, flip
   `WRITE_EQUITY_SNAPSHOTS=true` on Railway (snapshot writer moves over). KEEP
   `market-ingest` — the dashboard tape doesn't move.

What the executor adds over the cron (same defense stack, transcribed 1:1 —
fill-net booking 04a, actual-filled-qty 09c, sell-min + reconcile-close 09b,
anti-ghost reconstruct gate 09d): **stateful entry context** (real entryUnderlying
/ peak, no reconstruction drift), **fast premium exits** (stop/target/giveback
checked every `FAST_EXIT_SEC` ≈10s on the live chain instead of once a minute),
and **cycle reliability** (no missed minutes — the fill-lag probe showed the 180s
missed-cycle cliff is where latency actually costs money).

**Build-session decisions (the "open questions" below, resolved):** (1) bar source =
Alpaca minute bars over the ws (trade stream = Phase C); (2) the worker is
trading/decision-only — `market-ingest` keeps feeding the dashboard tape +
option_quotes; (3) config = Supabase Realtime subscription + a 30s poll fallback.
Option quotes in v1 come from a REST chain snapshot per bar-close (feed-selectable
indicative→opra); the OPRA *websocket* push is a later latency optimization. Two
deliberate corrections vs the cron path: cumulative SESSION vwap (matches
`engine/realsource.ts`, the backtest) instead of Alpaca's per-minute vw, and reuse
of `engine.computeFeatures` overriding only `minutesToClose` (the one bars-relative
field). See `worker/README.md`.

## Why
The live worker is a **per-minute cron**. Three lags stack up: (1) reaction lag — a move
at 14:30:15 isn't seen until the 14:31:00 tick (up to ~60s late); (2) decision
granularity — it only ever sees 1-min bar closes, can't react intra-bar; (3) stale
quotes — option_quotes is on Alpaca's `indicative` feed (~15-min DELAYED). The bots
"act on signals as they're allowed to view them, not as they happen." Streaming kills
all three.

## Shape
A **persistent Node/TS service = the streaming driver**, hosted on **Railway** (or
Render/Fly/VPS). Real-time data arrives over a **websocket**, which needs an always-on
process to hold open — Supabase edge fns and Vercel are invocation-based and
structurally can't. This is **"one engine, THREE drivers"**: backtest (`engine/backtest.ts`),
cron (`supabase/functions/paper-trader`), and now streaming.

Crucial win: the streaming driver **imports `engine/*` directly** (`STRATEGY_REGISTRY`,
`specToStrategyDef`, `computeFeatures`, `engine/cost.ts`, `engine/manage.ts`) — NO
inlined twin. That **eliminates the parity-drift problem** (the paper-trader's
hand-mirrored `compileSpec`/strategy interpreters — see add-channel-vocab-parity memory)
for this path, because there's a real bundler.

## Data subscriptions (Alpaca, paid: Algo Trader Plus — real-time SIP + OPRA)
- Stocks: `wss://stream.data.alpaca.markets/v2/sip` → subscribe `b.SPY` (minute bars)
  and optionally `t.SPY` (trades, to build a live forming bar / enable sub-minute).
- Options: `wss://stream.data.alpaca.markets/v1beta1/opra` → subscribe `q.<NTM SPY
  0DTE+1DTE>` (real-time NBBO). Re-subscribe the strike window as spot moves.
- On startup: REST backfill to seed the rolling bar window (today + prior session for
  pdh/pdl/level conditions).

## In-memory state (the second big win)
Hold the rolling bars + features, live spot, the NTM chain (real-time bid/ask), and
**per-channel position state** — entryUnderlying, entryMinute, peakFavorable, peak
premium — CORRECTLY in memory. This **fixes the state-parity bugs at the source**: the
cron worker had to reconstruct entryUnderlying≈strike + peakFavorable from session bars
(the 2026-06-02a fix); a stateful streaming worker just KEEPS the real entry values, so
grind's stops/targets and breakout's trail are exact, and power's giveback trail tracks
the true peak premium without re-querying option_quotes.

## Decision loop (v1)
On each bar close: `computeFeatures` → for each ARMED channel `evaluate(f, pos)` →
place/close orders on Alpaca paper **instantly**, with sizing / cost-gate / premium-stop
/ power-trail computed off the **real-time** option quotes (not 15-min-delayed). Same
engine, same smart-layer guards (cost gate, premium −50% stop, power giveback trail).
Write signals/positions/equity to Supabase for the dashboard (unchanged schema).

## Reliability / ops
- Startup reconcile: in-memory positions ← Alpaca `/v2/positions` + the `positions` table.
- Websocket reconnect + reseed on drop; heartbeat event so you know it's alive.
- RTH gating (trade 09:30–16:00 ET; force-flat 0DTE by EOD; 1DTE may ride).
- Config: read `fund_state` (KILL/halt/paper) + `strategist_config` (mute/solo/knobs/
  status). Use **Supabase Realtime** (subscribe) so the KILL switch bites in <1s, with a
  ~5s poll fallback.
- Idempotency: per-channel `client_order_id` (`slug-occ-min`), same as the cron worker.
- **SINGLE INSTANCE ONLY** — two streaming workers = double orders. Railway: 1 replica,
  restart-on-crash. It must be the SOLE order-placer.

## Migration (phased)
- **Phase A — SHADOW (dry-run):** stream + run the engine + LOG intended signals, place
  NO orders. Validate in-memory state + real-time quotes against the cron worker's
  signals for a few sessions.
- **Phase B — CUTOVER:** flip streaming to live; **DISABLE the cron paper-trader**
  (`select cron.unschedule('seve-paper-trader')`) so only ONE trader runs. KEEP the
  `market-ingest` cron — it still feeds the dashboard tape + option_quotes history.
- **Phase C — TICK LOGIC (optional):** add intra-bar / tick-reactive strategies (NEW
  logic, re-backtest at that resolution). v1 acts on bar close (matches the backtested
  edges) but with zero lag + live quotes.

## Stack
Node 20 + TypeScript (`tsx` or `tsup`-compiled), imports `engine/*`. `ws` (or
`@alpacahq/alpaca-trade-api`), `@supabase/supabase-js` (service role). Railway:
Dockerfile/nixpacks, long-running `npm start`, 1 replica. Env: `ALPACA_KEY`/`ALPACA_SECRET`
(paper + the paid data sub on the SAME account), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Prereqs (user side, before the build)
1. **Alpaca Algo Trader Plus** (real-time SIP + OPRA) — required for the live streams.
   (Also flip `market-ingest.ts`: `STOCK_FEED iex→sip`, `OPT_FEED indicative→opra` to
   fix the delay immediately, independent of streaming.)
2. **Railway account + project.**
3. Accept that the streaming worker becomes the SOLE trader → the cron paper-trader is
   disabled at cutover.

## Cost
Railway ~$5–20/mo · Alpaca Algo Trader Plus ~$99/mo (unlocks BOTH real-time REST now AND
the websocket later — one sub). MarketData.app NOT needed: BS delta is fine for the ATM
cost-gate, and the BS *pricing* flaw was a BACKTEST issue already fixed with real NBBO.

## Open questions for the build session
- Bar source: subscribe to Alpaca minute bars, or build 1-min bars from the trade
  stream? (Minute bars simplest; trade stream enables sub-minute.)
- Does the streaming worker also write underlying_bars/option_quotes (replacing
  market-ingest), or stay trading-only? (Recommend: keep market-ingest for the dashboard.)
- Realtime config subscription vs poll for KILL-switch latency.
