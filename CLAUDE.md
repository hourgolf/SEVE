# SEVE — project memory / session handoff

SEVE is a SPY 0DTE/1DTE paper-trading "desk": a Next.js dashboard over a Supabase
Postgres DB, a backtest engine, and a live paper-trading worker. This file is the
durable context for a new session. Read it first.

- **Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE
- **Supabase project ref:** `xvdfsxwwedltvdktqdac` (free tier — mind the 0.5 GB cap).
- Deploys auto on `git push` to `main` (Vercel; SSH deploy key already configured).

## The three views (Next.js App Router, TypeScript, plain CSS, zero UI deps)
- `/` **Monitor** — live SPY: red 7-seg LED spot, cand/ line chart with timeframe
  (1m–1h) + VWAP + EMA(9/21) overlay + volume + MACD + hover crosshair, live
  option chain (click a leg → `ContractDetail` drill-down), Tape Health, event log.
- `/console` **Console** — skeuomorphic Roland TR-909: 4 strategist channel strips
  (knobs/pads via `useDragValue`), master strip (kill switch, paper/live, START/STOP),
  16-step tape. Drives `strategist_config` / `fund_state` (authenticated writes).
- `/desk` **Desk** — positions, per-PM + fund P&L, equity curve, signals tape.

All three share the cream **`Chassis`** wrapper (`app/console.css`, scoped under
`.console-root`); the dark data panels use `app/globals.css`. Fonts: IBM Plex Sans
+ JetBrains Mono.

## Data seam (the architecture spine)
One hook owns all reads; components are dumb/props-driven. Swap the hook to change
the source without touching UI.
- `hooks/useMarketData.ts` — Monitor (option_quotes / underlying_bars / events).
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

## Live paper-trading worker — Phase B (CURRENT FRONTIER)
`supabase/functions/paper-trader/index.ts` — self-contained Deno edge fn, cron'd
every minute (Mon–Fri market hours). Trades the 15m EMA cross as the **`breakout`**
strategist (so the Console's Breakout knobs + mute + kill switch control it).
Stateless: reconstructs state from Alpaca paper (`paper-api.alpaca.markets`,
`/v2/account|positions|orders`), places market orders, writes positions/signals/
equity_snapshots/events.
- **DEPLOYED + scheduled + verified** (call path works, writes equity). Currently
  **`DRY_RUN=true`** (writes signals/equity, places NO orders). The function has
  **Verify-JWT OFF** (internal cron worker) — that's why the cron's call succeeds.
- **To go live (paper):** set the function secret `DRY_RUN=false` and redeploy.
- Exits: opposite cross / premium stop (−50%) / 45m time-stop / EOD flatten.
- Sizing: off Alpaca equity ($100k paper) × capital_pct × aggression, capped at
  max_contracts. Note the $100k paper balance vs the $10k console master — capped
  by max-contracts so size stays sane.
- **Pending small redeploy:** equity now written only on a fresh 15m bar (15× fewer
  rows) — paste the updated file into the dashboard to pick it up.

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

## NEXT SESSION: UI improvements (off-market day work)
The user wants to fiddle with UI/UX while markets are closed. Likely areas:
dashboard polish, the Desk visualizations (now that the worker will feed it),
console interactions, mobile, the contract drill-down, chart indicators. Verify
changes with the preview tool + screenshots; `npx tsc --noEmit` + `npm run build`
clean before `git push`. The live worker + DB are healthy and self-sustaining —
UI work won't disturb them.

## Conventions
Plain CSS (no Tailwind), inline SVG (no chart libs), minimal deps, the data-seam
pattern, faithful 909 aesthetic, honest data labeling (modeled vs real). Commit
messages end with the Co-Authored-By line. Branch is `main`; push deploys.
