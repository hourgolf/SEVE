# P5 implementation log (external-review-driven UI rebuild)

Tracks the code-constrained P5 rebuild (spec: the external reviewer / GPT, based on
docs/external-review-triage-2026-07-11.md). Slices land one at a time, each independently reviewed
by the external reviewer before merge. Do NOT jump ahead of the approved slice.

## ✅ Slices 1–2 — MERGED to main (2026-07-11, commit 4522987)
- **Slice 1 (seam):** `useSentinelDigest`, `useWorkerRuns`, `usePositionPeaks` lifted to `app/page.tsx`
  (called once), carried via `SurfaceProps`; active leaves de-hooked (PerformSurface/MobileShell consume
  `props.sentinel`; PerformRail/MobilePerform `PositionsSection` take a `peaks` prop). `workerRuns` wired
  to the seam but NOT yet rendered (banner = slice 3). Legacy console panels left isolated (spec-sanctioned).
- **Slice 2 (de-dup):** `DesktopSurface` no longer mounts beneath `StudioSurface`. The legacy five rooms
  (Play/Mix/Write/Tape/Ops) move behind ONE "Legacy rooms" link at the foot of STUDIO that opens the full
  legacy desk as a REPLACEMENT view (shell unmounts → one header/transport/KILL on screen) with a Back
  control. Reuses the single seam.
- Verified: tsc + production build clean; desktop STUDIO/PERFORM/legacy-toggle; mobile 390×844 (PERFORM +
  STUDIO accordion + PERFORM/STUDIO/COMMAND nav, no overflow); breakpoints 819=mobile / 820,821=desktop
  (one shell each); no console errors. Independently preview-reviewed + approved.

## ✅ Slice 3A — incident foundation — MERGED to main (2026-07-11, commit d8c24dd)
The deterministic incident policy (design ratified v1→v4, docs/p5-slice3-incident-policy.md) rendered as the
desktop-PERFORM **incident banner + always-visible system-health strip**. Pure core, browser-thin.
- **Pure incident engine** (`lib/incident/`): `deriveIncident.ts` (total function: tri-state `Read<T>` inputs →
  `Incident{primaryCode,activeCodes,severity,stopSuppressed}`; DEFAULT_THRESHOLDS ratified; STOP-gate demotes
  trading-liveness when stopped&flat; `streamHealthy` is a POSITIVE freshness predicate, never `!stale`),
  `marketSession.ts` (DST-correct America/New_York session/coverage), `positionsByExecutor.ts` (slug→executor
  join; unmatched→unknown), `readModel.ts` (reject-safe `applyOpsRead`/`applyWorkerRuns` reducers over
  `Promise.allSettled`), `devFixture.ts`. Thresholds: streamWarn45/streamStale120/cronStale180/runProcess180/
  opsRead60/workerRunsRead150/premarketBeat120/premarketReady600.
- **Hooks** (`useOpsStatus`, `useWorkerRuns`) refactored to tri-state + allSettled; a failed read → that read
  'error' (last-known held), never fabricated zeros; `loaded` = all reads finished first attempt (AND).
- **UI**: `IncidentBanner` (CRITICAL always expanded, only HIGH collapsible, warning/checking no toggle),
  `SystemHealthStrip` (open-position truth in every state). `.perform` = explicit 3-row grid
  `auto minmax(0,1fr) var(--h-dock)`; CRITICAL pre-empts the chart. `?incident=<sev>` dev override + the
  `/incident-preview` harness are BOTH production-gated (DCE'd / `notFound()`).
- **Tests/verify**: `npm run incident-selftest` = 56 pure checks (incl. real promise rejection, read
  independence, DST/coverage/freshness boundaries); market-calendar-selftest PASS; tsc + `next build` clean.
- **Production smoke test (2026-07-11, post-deploy https://seve-henna.vercel.app):** new build live (health
  strip = `MARKET CLOSED · OPEN 0 · SESSION weekend`); PERFORM `data-incident="normal"`, grid rows
  `0px/568px/84px` (banner collapsed), **7 chart canvases** intact, no banner; STUDIO one shell + rack;
  Legacy rooms mount as REPLACEMENT (0 `.shell-root` while open, 5 rooms, single master KILL) → Back restores
  STUDIO; `/incident-preview` → 404 in prod; **zero console errors** throughout.
- **NEXT: Slice 3B stays UNSTARTED** — this deployment is now confirmed, so 3B (the incident *detail*/rest of
  desktop PERFORM per the spec) is unblocked for a fresh reviewer-gated pass.

## Deferred to later slices (flagged by the reviewer — do NOT lose these)

### Slice 3+ cleanups
- ~~**Stale comment in `app/page.tsx`**~~ — ✅ RESOLVED in slice 3A (d8c24dd): the "STUDIO renders
  DesktopSurface verbatim; PERFORM = the S2 stub" comment is removed; the DESKTOP block now documents the real
  StudioSurface/PerformSurface + the once-computed incident seam (`positionsByExecutor`/`deriveIncident`).

### Pre-existing DESKTOP responsive debt (NOT a slice-1-2 regression — reviewer-measured)
- At **820px** viewport, the desktop document is **~1123px wide** (horizontal overflow).
- At **1080px** viewport, the desktop document is **~1206px wide** (horizontal overflow).
- The desktop shell layout targets ≥~1366px; below that it overflows horizontally. This predates the P5
  rebuild (slice 1-2 didn't touch desktop layout widths). Must be addressed in the responsive-layout work
  (spec slice 3 desktop-PERFORM acceptance targets 1366×768; the <1366 range needs a fluid/min-width fix).

## Not started (per instruction)
- Slice 3 (desktop PERFORM), 4 (desktop STUDIO table), 5 (mobile parity), 6 (gated executor admin),
  7 (deletion + regression cleanup) — see docs/external-review-triage-2026-07-11.md / the P5 spec.
