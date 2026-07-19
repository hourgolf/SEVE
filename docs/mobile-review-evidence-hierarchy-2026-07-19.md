# Mobile Review evidence hierarchy — 2026-07-19

Status: implementation branch. UI-only; no worker, strategy, Supabase, R2, release, or order-path change.

## Outcome

Mobile Review no longer presents session results, the retained event tape, linked trade evidence, the interpretive nightly read, and the deterministic Sentinel scan as one undifferentiated scroll. It has three explicit operator modes over the existing page-owned seam:

- `SESSION` — current desk result, equity, and gross channel attribution.
- `EVIDENCE` — retained operational events and candidate → fill → capture → manager → close chains.
- `SENTINEL` — receipt provenance, the interpretive next-open read, and the separate deterministic scan.

`EVIDENCE` is the default because Review is an after-action workspace. Empty RC5 chains remain neutral and not-due; the retained 14-row tape remains explicitly bounded; Sentinel interpretation remains separate from deterministic health.

## Invariants

- `app/page.tsx` remains the only subscription owner.
- The modes filter already-derived `SurfaceProps` and create no reads or writes.
- Mobile and desktop retain the same evidence sources even though their information architecture differs.
- Cream and blackout share the same layout and touch targets.
- Legacy Rooms remain available.
