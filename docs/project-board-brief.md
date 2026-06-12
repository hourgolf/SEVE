# SEVE project board — design/visualization brief

> Paste-ready brief for any design or visualization tool (claude.ai artifacts,
> Figma/FigJam AI, a whiteboard tool) — or for Claude Code itself, which renders
> this as an interactive inline board on request ("show me the board") and keeps
> THIS FILE as the single source of truth. Update the Data section as items move;
> everything else is stable.

## What this is

SEVE is a single-operator SPY/QQQ 0DTE paper-trading desk: a Next.js dashboard
(TR-909 mixer aesthetic), a Supabase DB, a backtest engine, and a live streaming
executor on Railway. The project runs as an evidence machine: strategies
("channels") earn promotion through probes → paper → live ladders. The board's
job: show the course (dependency chain to live-$ trading) and track the to-dos
per workstream, at a glance, for one operator + one AI pair.

## Deliverables wanted

1. **Critical-path strip** (two flows, horizontal):
   - This week: `9:31 gap check → 10-channel stream day clean → QQQ shadow
     proof + flip → 06-17 FOMC stand-down (hard date)`
   - Course to live $: `W3/W4 single executor → accounts (paper×2) → limit
     ladder → multi-leg → live $ (clone-promote V3)`
2. **Workstream lanes** (kanban-ish cards, statuses: done / in-flight / queued /
   gated / hard-date): see Data.
3. **A "shipped" footer line** (rolling count, keeps momentum visible).
4. Optional: a dependency graph view (the gates: QQQ flip gated on shadow proof;
   FOMC coverage gated on flip; accounts gated on W4; multi-leg gated on limit
   ladder; live $ gated on all of the above + paper×2).

## Data (update this section as things move)

**Lane: Validation week (now → 06-17) — ACTIVE**
- done · 10 SPY machine channels live on the stream executor
- done · gap_min armed on V3 + ALT — LIVE-CONFIRMED 06-12 (gap 0.424 in rationales; V3 traded the open gate)
- done · FOMC 2pm stand-down live, per-channel posture, symbol-scoped events
- done · 06-12 validation day PASSED (coverage ✓ 13 OCCs, books Δ$172, 21 stream trades/11 channels)
- done · QQQ shadow proof (entry lockstep exact) → trio FLIPPED to stream 06-12 close → 13 stream / 4 twins cron
- done · pre-open heartbeat + BAR_HISTORY 2400 (worker stream-2026-06-12a)
- next · 06-15 first QQQ stream session + first quiet pre-open (no WARN flood)
- next · manual-twin entry-push on the worker → migrate 4 twins
- HARD DATE · 06-17 first live FOMC stand-down — whole machine roster covered ✓

**Lane: Executor consolidation — QUEUED**
- W3 narrow ingest (option_quotes 94 MB/7d dominant table)
- W4 retire the cron trader → single executor
- equity snapshots move to the worker (B4 flag)

**Lane: Month-end governance — QUEUED**
- roster cut (operator decision; receipts: cut-list bleeders vs power-smart
  +$1,151 counter-receipt)
- inputs: mfe-drift monitor + participation/close-reason dataset

**Lane: UI sweep phase 1 — QUEUED (parallel-safe after validation week)**
- channel state lights (last decision + blocked_reason on every strip)
- knobs vs DNA split (config slides freely; validated spec = read-only chips)
- ops header (pre-flight lights + account selector, always visible)
- day report rendered in-app (audit view)
- declutter into fly / tune / audit groupings

**Lane: Accounts → live $ — GATED on W4**
- accounts schema + per-account worker loop (the W2 multi-symbol pattern)
- paper×2 dress rehearsal (paper-main + paper-lab sandbox)
- limit-order ladder (measure real capture before any live $)
- multi-leg routing (unlocks the chop iron-fly + event structures)
- live interlocks: clone-promote flow, account budgets, edit-lock, red chassis

**Lane: Research track — PROBE-GATED, ongoing**
- done · ema-stretch (band-blindness protective — 3rd geometry refutation; V3 as-armed +$20k print)
- done · ema-pullback + band-squeeze (new shapes, both KILLED at 0DTE; fingerprints filed)
- done · one-dte 5-window verdict (keepers STAY 0DTE — convexity > survival, quantified)
- done · PB-ride@1DTE DRAFTED (operator's word 06-12): builtin + entry_dte policy, golden-proven, status=draft — arming is a future operator action
- gap_min live validation → extend beyond V3/ALT if clean
- chop classifier v2 (realized-vs-implied morning move; +$20/day oracle ceiling)
- FOMC tuned edges (post-2:30 resolution re-entry; presser window 2:30–3:15) — data owned
- event admission queue (FOMC minutes, Treasury auctions, ISM — probe-gated admission)

## Style notes (if matching the desk)

Cream chassis + dark recessed panels, silkscreen labels, LED status dots
(green/amber/red/gray), JetBrains Mono for data, IBM Plex Sans for labels.
Statuses: done=green, in-flight=amber, queued/gated=gray, hard-date=red.
Sentence case. The desk's existing OPS·PRE-FLIGHT panel is the visual anchor.

## Cadence

The board is a VIEW; truth lives in CLAUDE.md session handoffs + this file.
Refresh ritual: at each session close, update the Data section here, then ask
Claude Code to re-render ("show me the board").
