# SEVE — Codex handoff (2026-07-11)

Handoff from the Claude/Opus session that shipped **P5 Slice 3A** (external-review-driven UI rebuild).
Codex will (1) do the strategy-channel + UX analysis **read-only**, then (2) **take repository write
ownership from a fresh branch**. This doc is the durable context for that transition.

> SEVE is a SPY/QQQ/IWM 0DTE/1DTE **paper**-trading desk. Everything is paper money on Alpaca paper.
> Read `CLAUDE.md` first (project memory + session handoffs); this file is the mechanical state on top of it.

---

## 1. Production state

| | |
|---|---|
| **Repo** | `github.com/hourgolf/SEVE` (git remote `origin`) |
| **Production URL** | https://seve-henna.vercel.app (Vercel; **push to `main` auto-deploys**) |
| **`main` HEAD** | `386e2d7` — `docs(p5): Slice 3A merged + production-smoke-verified` (docs-only) |
| **Deployed code commit** | `d8c24dd` — Slice 3A incident foundation (386e2d7 is a docs-only commit on top) |
| **Slice 3A base** | `5d29c2e` (feat) → `d8c24dd` (review follow-up fixes) |
| **Working tree** | **CLEAN** (`git status` empty) |
| **`origin/main` vs local `main`** | in sync (0 ahead / 0 behind) |
| **Supabase project ref** | `xvdfsxwwedltvdktqdac` (free tier, 0.5 GB cap) |
| **Worker version (live)** | `stream-2026-07-11b` (verify via `select note from worker_heartbeat where id='stream'`) |

**Slice 3A production smoke test — all green** (run post-deploy against the live URL):
`data-incident="normal"` · health strip `MARKET CLOSED · OPEN 0 · SESSION weekend` · PERFORM grid rows
`0px/568px/84px` (banner collapsed) · **7 chart canvases** intact · STUDIO one shell + rack · Legacy rooms
mount as a **replacement** (0 `.shell-root` while open, 5 rooms, single master KILL) → Back restores STUDIO ·
`/incident-preview` → **404 in prod** · **zero console errors**.

---

## 2. Branches & worktrees (⚠ a parallel session is LIVE on this repo)

```
* main                         386e2d7  [origin/main]   ← production
  p5-slice-3a                  d8c24dd  [origin/...]     ← MERGED into main; safe to delete
  strategy-channels            c4824bc  [origin/...]     ← DRAFT pluggable-channel registry (old, unmerged)
  feat/gsap-motion             49d3599  [origin/...]     ← unmerged UI motion experiment
  redesign/te-cream-rooms      0b626e9  [origin/... +19] ← unmerged redesign spur
  (remote-only) origin/data-archive                      ← data snapshots
```
Worktree (**LIVE parallel Claude session — do NOT assume `main` is frozen**):
```
/Users/mattlynch/seve-dashboard/.claude/worktrees/friendly-shtern-dca25d
    → branch claude/friendly-shtern-dca25d @ de520c7 (registry/A13 + worker calibration work)
```
**Implication for Codex:** another session commits to `main`. When you take write ownership, **branch from
the latest `origin/main` (fetch first), stage scoped commits (never `git add -A`/`git commit -a`), and
re-fetch/rebase before each push.** Parallel commits here are the norm, not an exception.

---

## 3. Slice status (the P5 external-review rebuild — NOT the older S1–S6 weekend build)

There are two slice-numbering schemes; use the **P5 rebuild** one below (`docs/p5-implementation-log.md`).
(The `perform-build-spec.md` S1–S6 scheme was the weekend Mission-2 build; S1–S5 already shipped and are
what the reviewer critiqued.)

| Slice | Scope | Status |
|---|---|---|
| **1 — seam** | lift `useSentinelDigest`/`useWorkerRuns`/`usePositionPeaks` to `app/page.tsx`, carry via `SurfaceProps` | ✅ merged `4522987` |
| **2 — de-dup** | stop mounting `DesktopSurface` under STUDIO; legacy 5 rooms behind one "Legacy rooms" replacement view | ✅ merged `4522987` |
| **3A — incident foundation** | deterministic incident engine (`lib/incident/*`) + desktop-PERFORM banner + system-health strip | ✅ merged `d8c24dd`, **deployed + smoke-tested** |
| **3B — desktop PERFORM rest** | adaptive hierarchy (chart is not always the hero), incident **detail**, dock chicklets polish | ⛔ **NOT started (next)** |
| **4 — desktop STUDIO** | CUT the current rack; REBUILD as fleet-summary + **sortable armed-first EXCEPTION table** | ⛔ not started |
| **5 — mobile parity** | bring the same seam/incident/adaptive treatment to mobile2 | ⛔ not started |
| **6 — gated executor admin** | authenticated executor/lease admin surface | ⛔ not started |
| **7 — deletion + regression cleanup** | retire the legacy replacement view + unmounted `components/mobile/MobileApp.tsx` + `mobile.css` scroll-lock; remove the legacy double-read | ⛔ not started |

**Per the operator's instruction, pause here: do NOT start Slice 3B or Slice 4 until Codex owns the branch.**

---

## 4. Remaining acceptance criteria & the reviewer's KEEP/CUT/REBUILD verdict

Per-slice gate (unchanged, every slice): `npx tsc --noEmit` clean · `npm run build` clean · browser
verification (desktop 1440 & 2560, mobile 390) · independent diff+preview review **before** merge · scoped
commit. The relevant selftest(s) for the slice must pass (`incident-selftest` for any `lib/incident` change).

Reviewer's adopted list (`docs/external-review-triage-2026-07-11.md`, Round 4–5; the operator's "genuinely
awful" STUDIO drove this):
- **KEEP** — PERFORM mode, chart hero + SENT level overlay + entry markers, the shared shell, cream-as-default.
- **CUT** — the current STUDIO channel **rack** (24 near-identical strips = the operator's core complaint).
- **REBUILD** — STUDIO as a **fleet summary + sortable armed-first exception table** (show only what differs
  / needs attention), and **ADAPTIVE HIERARCHY**: "a chart can be excellent and still be the wrong hero" —
  the hero should escalate to the incident/positions when something needs the operator, not always the chart.
- **Provenance rule (methodology, Bucket 3):** every number carries its basis — broker-real vs estimated,
  gross vs net, mid vs bid. Slice 3A's health strip already models "can't-prove-death" wording; keep that
  discipline (never assert "WORKER DOWN" from fail-open telemetry — say "PROCESS NOT OBSERVED"/"HEARTBEAT STALE").

The incident **policy** that 3A implements (thresholds, truth table, wording) is frozen at
`docs/p5-slice3-incident-policy.md` (design v4). 3B builds the **detail** view on top of the same
`deriveIncident` output — do not re-derive severity in the UI.

---

## 5. Known debt (do not lose these)

- **Desktop responsive overflow < ~1366px** (pre-existing, NOT a P5 regression): doc width ~1123px @ 820vw,
  ~1206px @ 1080vw. The shell targets ≥~1366px. Fold a fluid/min-width fix into Slice 3B/4.
- **Legacy-view double-read** (spec-sanctioned, transitional): while the "Legacy rooms" replacement view is
  mounted, its own lazy panels still perform their documented reads. Retired with the legacy view at Slice 7.
- **`daily_stop_usd` UI semantics** (Bucket-1 item 15, MEDIUM): it's a realized-entry latch, not a max-loss
  cap. Worker-side relabel shipped (`stream-2026-07-11b` "daily-latch relabel"); **verify the UI copy** matches.
- **Deferred Mission-1b worker fixes** (need broker samples / dormant): #12, #14, #17 (spread-capture dormant),
  #18 (per-strike chain staleness). See `memory/mission-1b-execution-hardening.md`.
- **Bucket 2 (the go-live backbone) — NOT started:** order/fill ledger → positions as a projection →
  immutable account identity → independent risk service → executor fencing → policy epochs. `reconcile` is a
  P&L gate today; nothing enforces broker-flat-after-close. This is the big architecture effort after the UI.
- **`pk·win` ERA BOUNDARY at the 07-11 deploy** (peak/trough mark moved mid→bid): analysis must not pool
  pre/post-07-11 peaks.

---

## 6. Strategy-analysis data sources (for the read-only analysis phase)

Read-only analysis runs against Supabase **anon** reads via `.env.local` (gitignored — holds the anon key +
Alpaca paper keys + service creds; **never commit it, never put the service-role key in the app**).

**Live DB tables** (anon SELECT policied): `positions`, `signals`, `equity_snapshots`, `strategists` +
`strategist_config`, `fund_state`, `virtual_trades` (bench fleet), `forensics_reports`, `daily_reports`,
`worker_heartbeat` (RTH-gated stream liveness ~10s), `worker_runs` (crash-attribution ledger, 60s 24/7),
`events`, `option_quotes` (7-day prune — irreplaceable), `underlying_bars`, `option_bars` (research-only, kept empty).

**Strategy definitions:** `engine/registry.ts` (`STRATEGY_REGISTRY`) + `engine/strategies/*.ts`. The worker
mirrors this logic (`worker/src/`); the three supported-condition vocabularies (capabilityCheck / engine /
worker) must stay in sync — see `memory/add-channel-vocab-parity.md`.

**Forensics substrate (`data/`, gitignored):** `forensics-dataset.jsonl` (flat per-trade substrate w/
stackAtEntry/occShare/bookingDelta + realized greeks; regen nightly), `broker-truth.json`, `foulout-ledger.json`,
`sentinel/<date>.md` + `brief-latest.json` + `snapshots.jsonl`, `bars-archive/`, `databento*/`.

**The governing registry:** `docs/pre-registered-tests-2026-07.md` (A1–A16 + C1 + R1 + calibration log) —
**check it before proposing any gate/TP/stop/size change** (thresholds are fixed pre-outcome). Analysis
entry points: `npm run day-report`, `reconcile-alpaca`, `gate-shadow`, `one-account-shadow`, `a6-read`,
`sentinel`, `weekly-readout`, `autopsy`. Doctrine + verdicts live in `memory/` (`MEMORY.md` is the index) and
`docs/strategy-channels.md`.

**Do NOT Black-Scholes 0DTE** (`memory/no-black-scholes.md`) — real NBBO / empirical greeks only; any BS
result is suspect.

---

## 7. Exact build / test / deployment workflow

**Setup:** Node + `tsx`. `npm install`. Secrets in `.env.local` (gitignored) — the analysis/probe scripts
load it via `--env-file=.env.local` (already wired in the npm script). No Supabase/Vercel/Railway CLI is
available in-session; DB DDL is run by the operator in the Supabase SQL editor (hand them copy-paste SQL,
numbered `NN_*.sql` in repo root).

**Typecheck (always safe, run constantly):**
```
npx tsc --noEmit
```
**Build (⚠ stop `npm run dev` first — dev + build share `.next` and corrupt it):**
```
npm run build
```
**Dev server:** `npm run dev` (or the Browser-pane `preview_start` with `.claude/launch.json`; never run a
dev server for the UI via a raw background shell if a preview tool is available).

**Tests — there is NO test framework.** Tests are custom `tsx` selftest scripts (`check(label,got,want)` +
`process.exit`). The ones that gate this work:
```
npm run incident-selftest        # 56 pure checks — REQUIRED for any lib/incident change
npm run market-calendar-selftest # session/holiday/coverage boundaries
npm run runner-selftest          # 41 checks — the worker pre-deploy gate (worker/src changes)
```
(Plus the many `engine/*` probes/selftests in §package.json for strategy analysis — none are CI-gated.)

**Deploy = push to `main`:**
- Push to `main` **auto-deploys the Vercel frontend** (the UI). This is the normal UI deploy path.
- ⚠ **`main` is a SHARED branch: historically a push also auto-deploys the WORKER to Railway.** The operator
  was reconfiguring Railway's deploy trigger / Watch Paths this session — **verify the current Railway trigger
  before pushing anything that touches `worker/` or `engine/`** (engine is imported by the worker). If the
  worker redeploys, **bump `worker/src/config.ts` `WORKER_VERSION` at the checkpoint and verify the heartbeat
  note** (`select note from worker_heartbeat`) — Railway deploy titles are image digests, not git SHAs, so the
  heartbeat note is the only reliable version signal. UI-only changes don't change worker behavior, but a
  redeploy under a stale version label is the trap.

**Merge discipline (non-negotiable, from the operator):** one slice = one branch off latest `origin/main`;
independent diff + browser preview review **before** merge; fast-forward merge to `main`; scoped commits only
(parallel sessions active — never `-A`); commit messages end with:
```
Co-Authored-By: <your model> <noreply@anthropic.com>
```

---

## 8. Operating rules (carried from CLAUDE.md + this session)

- **All paper money, open book** — nothing here is privileged, but **never commit secrets**. `.env.local`
  holds the anon key, Alpaca paper keys, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
  `ANTHROPIC_API_KEY`, `PUSH_SECRET`. The service-role key must **never** reach the app bundle.
- **No prod access-control changes from the agent** — hand the operator copy-paste SQL for RLS/grants.
- **Never invoke the armed live worker to "verify"** (a past runaway re-buy incident) — reason about it or use
  shadow scripts.
- **Review before merge/deploy** — every slice gets an independent diff + preview review first.

---

*Handoff prepared at `main`@`386e2d7`, clean tree, production green. Next action is Codex's: read-only
strategy-channel + UX analysis, then a fresh branch off latest `origin/main` for Slice 3B.*
