# Streaming worker — the third engine driver (scope)

Status: **SCOPED, not built.** Prereqs (Alpaca real-time sub + Railway account) are on
the user. This is the long-term fix for the per-minute lag.

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
