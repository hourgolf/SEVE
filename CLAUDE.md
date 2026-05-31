# SEVE — project memory / session handoff

SEVE is a SPY 0DTE/1DTE paper-trading "desk": a Next.js dashboard over a Supabase
Postgres DB, a backtest engine, and a live paper-trading worker. This file is the
durable context for a new session. Read it first.

- **Live:** https://seve-henna.vercel.app · **Repo:** https://github.com/hourgolf/SEVE
- **Supabase project ref:** `xvdfsxwwedltvdktqdac` (free tier — mind the 0.5 GB cap).
- Deploys auto on `git push` to `main` (Vercel; SSH deploy key already configured).

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

## NEXT SESSION: UI/UX tweaks (continuing the off-market polish)
Recent sessions did a big UI arc: merged the 3 routes into one 909 surface,
redesigned the header (`$EVE · DESK`, head master + day-P&L/SPY readout LEDs),
built the **mobile phone app** (3-tab shell, see Responsive split), added **knob
LED glow rings + a cream 909 re-theme**, and gave the chart **zoom/pan + ~15 days
of history**. All shipped to `main` and live.

Frontier is incremental tweaks — the user iterates fast via real-device
screenshots, so keep the preview server up and screenshot at 390px (mobile) AND
1280px (desktop) for every change. Known candidate areas / things mid-flight:
- **Mobile fit & feel:** the "less dark / more cream / more 909 buttons" direction
  is ongoing — keep pulling the aesthetic back toward the drum machine. Mix knobs
  are horizontal with LED meters; the SPY/day-P&L captions and tap-target sizes
  may still want tuning.
- **Chart depth:** optional follow-ups noted — lazy-load older bars at the far-left
  pan edge (table has 2+ yrs), and/or bump the 15-day default deeper.
- The **Desk worker is still `DRY_RUN=true`** — once it trades, the Desk/P&L/equity
  visualizations get real data and may deserve another visual pass.

Workflow gotcha: **stop the preview dev server before `npm run build`** (they share
`.next`; running both corrupts it — see the user memory note). `npx tsc --noEmit`
is always safe. Verify clean tsc + build before `git push` (push auto-deploys).

## Conventions
Plain CSS (no Tailwind), inline SVG (no chart libs), minimal deps, the data-seam
pattern, faithful 909 aesthetic, honest data labeling (modeled vs real). Commit
messages end with the Co-Authored-By line. Branch is `main`; push deploys.
