# Channels evidence workspace — 2026-07-19

Status: preview implementation. Web-only; no worker, strategy, Supabase, R2, release, or order-path change.

## Purpose

The Channels workspace already contained the sealed RC5 runtime overlay, database configuration, safe local-only future-epoch drafts, and selected-channel controls. This pass makes the fleet usable as an operating and evidence surface instead of forcing the operator to scan all 68 inventory rows or infer why a channel did or did not trade.

## Behavior

- Desktop opens on the verified paper roots and can switch among `ROOTS`, `DARK`, `ATTENTION`, and `ALL` without changing lifecycle or configuration.
- Mobile opens on the same account-scoped roots and can switch among `ROOTS`, `DARK`, and `ALL` before expanding a channel.
- The selected-channel decision console and mobile passport show up to the three newest decision/censor receipts in the already page-owned account feed, with explicit ET timestamps and truthful `FIRED`, `POLICY HELD`, `OBSERVED`, or `REVIEW` classification.
- The receipt list is labeled as a bounded live feed. It is not presented as historical performance, a complete opportunity ledger, or a promotion score.
- Historical desk attribution remains explicitly pre-RC5 and mixed-epoch. Sealed root policy remains explicitly a baseline, not learned evidence.

## Safety invariants

- `app/page.tsx` still owns all hooks and subscriptions.
- Filtering and receipt presentation are pure leaf behavior over `SurfaceProps.channelWorkspace`.
- No configuration is persisted or activated by this pass.
- Sealed RC5 controls remain read-only; authenticated operators may only create an inert local draft for later review and sealing.
- Dark channels remain no-fill evidence lanes.

## Acceptance

- ROOTS displays only the account's sealed paper roots; DARK displays only no-fill evidence channels; ALL restores the complete account inventory.
- Changing scope never leaves an inspector pointing at a hidden row.
- Recent decision receipts preserve newest-first order and cap at three per channel.
- Desktop and 390×844 mobile remain horizontally contained in cream and blackout.
- Channel passport, Studio, TypeScript, and production build checks pass before preview publication.
