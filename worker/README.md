# SEVE streaming worker — the third engine driver

A persistent Node/TS service that holds Alpaca's real-time websocket, keeps bars +
the NTM option chain + config **in memory**, and on every **bar-close** runs the
**same `engine/*`** the backtest uses to decide each channel — with **zero cron
lag**. This is the long-term fix for the per-minute cron worker's three lags
(reaction lag, 1-min decision granularity, 15-min-delayed quotes).

**"One engine, three drivers":** `engine/backtest.ts` · `supabase/functions/paper-trader`
(cron) · **this** (streaming). Full design: [`../docs/streaming-worker.md`](../docs/streaming-worker.md).

The big structural win: it **imports `engine/*` directly** (registry, the spec
interpreter, the cost model) — **no inlined twin**, so it can't drift from the
backtest the way the cron worker does (see the `add-channel-vocab-parity` memory).

## Status: Phase A — SHADOW (this build)

It **places NO orders and writes NO prod tables.** Each bar-close it logs what it
*would* do per channel (enter/exit/blocked, with sizing + the cost-gate / premium
-stop / power-trail decision). `DRY_RUN=false` is **refused** in v1 — going live is
Phase B (below), only after shadow validates against the cron worker for a few
sessions.

It already applies the full live gate stack (parity with the cron dispatcher
`2026-06-02b`): per-channel sizing, the **cost gate** (power-exempt), the **premium
−50% catastrophic stop**, the **power giveback trail**, the 0DTE→1DTE roll, the Stop
knob, and the state reconstruction (entryUnderlying / peakFavorable).

Two deliberate corrections vs the cron path, documented in the source:
- **VWAP**: computes cumulative *session* VWAP in memory (matches `engine/realsource.ts`
  / the backtest), not Alpaca's per-minute `vw` (the cron's legacy approximation).
- **Features**: reuses `engine.computeFeatures`, overriding only `minutesToClose`
  with the real time-to-16:00 (that one field is bars-relative in the engine).

## Prereqs (user-side, gating)

1. **Alpaca Algo Trader Plus** (real-time SIP + OPRA) — for live streams. Until then
   it runs on the free **iex** stock websocket + **indicative** option snapshots
   (delayed) — perfect for shadow plumbing validation.
2. **Railway account + project** — the always-on host.
3. At Phase B cutover: accept that the stream becomes the **sole trader** and the
   cron `paper-trader` is disabled.

## Run locally (read-only shadow)

```bash
cd worker
npm install
npm start          # tsx src/index.ts
```

With only the repo-root `.env.local` (ALPACA_KEY/SECRET + the **anon** key, no
service role), it runs **read-only**: reads config + quotes, logs intents, writes
nothing. It connects the **iex** websocket and decides once on boot against the
latest bar; during market hours every closed minute bar triggers a fresh cycle.

`npm run typecheck` runs `tsc` over the worker + the engine/lib files it imports.

## Deploy to Railway

1. New project → **Deploy from GitHub repo** (`hourgolf/SEVE`).
2. Service settings:
   - **Root Directory:** repo root (so `engine/` + `lib/` are in the build context).
   - **Dockerfile path:** `worker/Dockerfile` (or let `worker/railway.json` set it).
3. Variables: `ALPACA_KEY`, `ALPACA_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `STOCK_FEED` (`iex`→`sip`), `OPT_FEED`
   (`indicative`→`opra`), `DRY_RUN=true`, optional `SHADOW_WRITE_EVENTS=true`.
4. **1 replica** (set in the repo-root `railway.json`). Two instances = double
   orders in Phase B — never scale this service.

With the service role set, `SHADOW_WRITE_EVENTS=true` mirrors intents into the
`events` table (tagged `stream-shadow:`) so you can compare them to the cron
worker's `signals` in the dashboard log.

## Migration (phased — see the doc)

- **Phase A — SHADOW (this build):** stream + decide + log. Validate in-memory
  state + real-time quotes vs the cron worker's signals for a few sessions.
- **Phase B — CUTOVER:** wire live order placement (Alpaca order POST + position
  writes + reconcile-on-exit, mirroring the cron dispatcher) behind a verified
  `DRY_RUN=false`, then **disable the cron** (`select cron.unschedule('seve-paper-trader')`)
  so only ONE trader runs. Keep `market-ingest` (feeds the dashboard tape).
- **Phase C — TICK (optional):** subscribe trades for sub-minute / intra-bar logic
  (new edges, re-backtested at that resolution).

## Files

- `src/index.ts` — boot, seed, ws wiring, the bar-close cycle, config reload, RTH gate.
- `src/decide.ts` — the per-channel decision pipeline (imports `engine/*`).
- `src/stream.ts` — the Alpaca stock-bar websocket (auth/subscribe/reconnect).
- `src/alpaca.ts` — Alpaca REST (account/positions/clock, bar backfill, chain snapshot).
- `src/store.ts` — Supabase reads/writes + the realtime KILL-switch subscription.
- `src/state.ts` — in-memory bar window + NTM chain.
- `src/config.ts` — env + policy constants (parity with the cron dispatcher).
