# SEVE — Live Market Monitor

**Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE

A read-only live window over the SEVE paper-trading desk: SPY 0DTE/1DTE option
tape ingested into Supabase Postgres every minute. This is a faithful Next.js
reproduction of `live-market-monitor.html` — same dark trading-terminal look,
same panels, same queries, same 5-second polling refresh.

It reads three tables (`option_quotes`, `underlying_bars`, `events`) using the
**public anon key** with row-level-security SELECT policies in place. The
service-role/secret key is never used or referenced anywhere in this app.

## What it shows

- **Top bar** — live SPY spot, a LIVE/STALE/ERROR indicator (stale when the
  latest snapshot is older than 3 minutes), and last-updated time.
- **SPY intraday sparkline** — last ~60 one-minute closes (inline SVG).
- **Live option chain** — calls left, puts right, strike center, ATM row
  highlighted; bid / ask / mid / delta from the most recent snapshot.
- **Tape Health** — total `option_quotes` rows, last ingest time, contracts in
  the latest snapshot, expirations tracked.
- **System Event Log** — latest ~14 rows from `events`.
- **Error banner** — a graceful red banner if reads fail (missing key / RLS).

## Screens

The app has three routes, switchable from the top nav:

- **`/` — Monitor** — the read-only live market dashboard (above).
- **`/console` — The SEVE Console** — a skeuomorphic Roland TR-909-style control
  surface for the strategist desk. Four channel strips (Fade · Breakout · Power
  Hour · Grinder), each with LEVEL (capital %) and AGGR (aggression) knobs, MAX /
  STOP dials, MUTE/SOLO pads, and a live P&L meter. A master strip carries the
  fund: a red 7-segment LED (NAV / day P&L, click to toggle), the CAPITAL knob,
  START/STOP, a guarded PAPER↔LIVE switch, and a KILL switch. A 16-step tape
  lights recent signals in each strategist's color.
- **`/desk` — Desk** — open positions, per-strategist + fund P&L with an equity
  sparkline, and a live signals tape.

### Data: real reads (writes deferred)

The desk now **reads real Supabase data**, but controls still drive **local
state only** (persisted writes are a later phase). Two seam hooks own this:

- [`hooks/useDeskState.ts`](hooks/useDeskState.ts) + [`lib/desk/load.ts`](lib/desk/load.ts)
  — the console config. [`DeskProvider`](components/console/DeskProvider.tsx) does
  a **one-time** read of `strategists` ⋈ `strategist_config` + `fund_state` on
  mount and `HYDRATE`s the reducer; if the read fails it falls back to
  [`lib/desk/seed.ts`](lib/desk/seed.ts). Not polled, so local knob turns aren't
  clobbered. *To enable writes:* fire authenticated `update`s on `SET_CONFIG` /
  `SET_FUND` / `KILL` (the knob's `onCommit`, fired on pointer release, is the
  write boundary).
- [`hooks/useDeskFeed.ts`](hooks/useDeskFeed.ts) — polls real `positions` /
  `signals` / `equity_snapshots` every 5s (same structure as `useMarketData`),
  deriving P&L via [`lib/desk/derive.ts`](lib/desk/derive.ts). Honest empty
  states until the bots trade; a header badge shows **LIVE** / awaiting activity
  / "tables not readable".

**Required one-time setup:** run [`04_dashboard_read_policies.sql`](04_dashboard_read_policies.sql)
in your Supabase SQL editor to grant the anon key SELECT access (+ RLS read
policies) to the desk tables. Until then the desk shows the seed config and a
red "tables not readable" badge — it never crashes.

Mute/solo/halt are **derived, never cross-mutated** — soloing one channel dims
the others via a selector, so un-soloing instantly restores prior states.

## Greeks (hybrid model)

Alpaca returns real, broker-computed greeks for 1DTE and later expiries, and
those **always win**. But Alpaca suppresses greeks for same-day (0DTE) expiries
— its model divides by time-to-expiry, which → 0 at the bell. Since 0DTE is the
core of this desk, [`lib/greeks.ts`](lib/greeks.ts) fills only those null deltas
with a Black-Scholes model: per strike it backs implied vol out of the OTM leg
(pure time value, always solvable) and applies that one IV to both legs, so
calls/puts stay arbitrage-consistent (delta difference = 1). Modeled boards show
a small amber **Δ model** tag. The hook prefers the DB's real greek on every
row, so if your feed ever supplies 0DTE greeks, the model silently stands down.

## Tech

- Next.js (App Router) + TypeScript
- `@supabase/supabase-js` (read-only, anon key)
- Plain inline SVG sparkline (no chart library), plain CSS (no UI framework)

All data fetching lives in one client hook, [`hooks/useMarketData.ts`](hooks/useMarketData.ts),
so a later phase can swap polling for Supabase realtime without touching the
panels.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file and fill in the keys:

   ```bash
   cp .env.local.example .env.local
   ```

   Set both values (both are public/safe to expose to the browser):

   - `NEXT_PUBLIC_SUPABASE_URL` — your project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Settings → API → publishable (anon) key

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

If the tables can't be read you'll see the red banner with the likely cause
(missing anon key, or the read-access SQL hasn't run).

## Deploy to Vercel

1. Push this folder to a Git repo and import it in Vercel (it auto-detects
   Next.js — no build config needed).
2. In **Project → Settings → Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your publishable (anon) key |

3. Deploy. Because both vars are `NEXT_PUBLIC_*`, they're embedded at build
   time — redeploy after changing them.

> Only ever paste the **anon/publishable** key. The service-role key must never
> be added to this project.

`vercel.json` pins the framework to Next.js so the build output is handled
correctly (otherwise Vercel may look for a static `public/` directory and fail).

## Making changes after deploy

The repo is connected to Vercel for automatic deploys. To ship a change:

```bash
git add -A
git commit -m "your message"
git push
```

Vercel rebuilds and redeploys `main` automatically. Pushing uses an SSH **deploy
key** stored on this machine (`~/.ssh/seve_deploy`), configured per-repo via
`git config core.sshCommand` — no username/password prompt. If you ever clone
fresh elsewhere, you'll re-authenticate there with your own GitHub credentials.

## Project layout

```
app/
  layout.tsx        # fonts (IBM Plex Sans + JetBrains Mono) + metadata
  page.tsx          # composes the panels, consumes the data hook
  globals.css       # terminal theme, reproduced from the reference HTML
components/
  TopBar.tsx        # spot, LIVE/STALE indicator, updated time
  Sparkline.tsx     # inline-SVG intraday sparkline
  OptionChain.tsx   # calls/puts board with ATM highlight
  TapeHealth.tsx    # ingestion vitals
  EventLog.tsx      # system event journal
  ErrorBanner.tsx   # graceful read-failure banner
hooks/
  useMarketData.ts  # single polling source of truth (swap to realtime later)
lib/
  supabaseClient.ts # read-only anon client
  types.ts          # row types for the three tables
  format.ts         # money / time / number helpers
```

## Extending (later phases)

The schema (`trading-desk-schema.sql`) already defines `positions`, `fills`,
`orders`, `equity_snapshots`, and `strategist_config` for upcoming phases
(positions, P&L, and the strategist "mixer" control panel). Add new panels as
components and extend the hook (or add sibling hooks) to query those tables.
