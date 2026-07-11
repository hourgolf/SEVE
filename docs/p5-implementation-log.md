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

## Deferred to later slices (flagged by the reviewer — do NOT lose these)

### Slice 3+ cleanups
- **Stale comment in `app/page.tsx`** (the DESKTOP block, ~just above `const mkt = marketSummary`):
  "STUDIO renders today's DesktopSurface verbatim; PERFORM = the S2 stub" is now INACCURATE — STUDIO
  renders `StudioSurface` and PERFORM is a real surface. Clean it when next touching that section (kept as-is
  for the slices-1-2 merge so the merged tree == the approved commit 4522987).

### Pre-existing DESKTOP responsive debt (NOT a slice-1-2 regression — reviewer-measured)
- At **820px** viewport, the desktop document is **~1123px wide** (horizontal overflow).
- At **1080px** viewport, the desktop document is **~1206px wide** (horizontal overflow).
- The desktop shell layout targets ≥~1366px; below that it overflows horizontally. This predates the P5
  rebuild (slice 1-2 didn't touch desktop layout widths). Must be addressed in the responsive-layout work
  (spec slice 3 desktop-PERFORM acceptance targets 1366×768; the <1366 range needs a fluid/min-width fix).

## Not started (per instruction)
- Slice 3 (desktop PERFORM), 4 (desktop STUDIO table), 5 (mobile parity), 6 (gated executor admin),
  7 (deletion + regression cleanup) — see docs/external-review-triage-2026-07-11.md / the P5 spec.
