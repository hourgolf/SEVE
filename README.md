# SEVE — Live Market Monitor

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
