# Dashboard presentation consolidation — 2026-07-19

Status: implementation receipt for the single consolidation branch. This work changes presentation only. It does not change the RC5 paper roster, worker, Supabase, R2, strategy configuration, orders, or the page-owned subscription seam.

## Why this branch exists

The dashboard work had begun to repeat a costly loop: one small workspace adjustment, one protected preview, one authentication handoff, and another merge. That was useful while Markets, Positions, Channels, Sentinel, Review, and Ops were still placeholders. It is no longer the correct unit of work now that those destinations are functional.

This branch therefore consolidates the completed Folio study onto the latest 909 workstation instead of opening another panel-specific slice. Both presentations consume the same `SurfaceProps` and the same guarded operator actions. No presentation owns a remote hook, fetch, subscription, policy derivation, or mutation path.

## Presentation contract

- `909` remains the production/default workstation at `/`.
- `folio` remains available only from `/skin-lab` in local development and Vercel previews.
- Production resolves an attempted Folio presentation to `909` and the `/skin-lab` route fails closed.
- Desktop presentations expose Dashboard/Home, Markets, Positions/Book, Channels, Sentinel, Review, Ops, Legacy Rooms, operator access, and the protected KILL control.
- Mobile presentations expose Chart/Home, Channels, Book, Review, Ops, account selection, settings/auth, and KILL.
- Both presentations reuse the latest mobile Chart/Chain switch and the three-mode Review contract (`SESSION`, `EVIDENCE`, `SENTINEL`).
- 909 and Folio may use different density and layout while preserving the same truth and actions.

## Exit from micro-slice mode

After this consolidation, a separate dashboard branch is justified only when at least one of these is true:

1. it adds or repairs an operator job, not merely a panel treatment;
2. it changes a shared truth/action contract and therefore needs an isolated safety review;
3. it closes a complete cross-workspace visual system (typography, density, responsive behavior, or a presentation), not one local cosmetic detail;
4. it fixes a production regression.

Ordinary visual adjustments should accumulate into one bounded presentation release rather than generating repeated preview/login cycles.

## Remaining gates

### Monday evidence-dependent

- observe the first RC5 candidate/fill/capture/manager/collision/close chain;
- complete the authenticated natural-paper-position manual-close drill when a real position exists;
- reconcile the first session without changing the frozen release during trading.

### Post-Day-1 functional

- authorize and implement cartridge-backed channel mutations only after their versioned write contract is separately reviewed;
- apply the Gate 2 candidate/exact-path schema only under separate migration authorization;
- retire Legacy Rooms only after every native operator job has passed desktop and mobile drills.

### Presentation

- compare 909 and Folio as complete systems, not panel fragments;
- perform later 909 typography/density/cream-blackout polish as one release-sized pass;
- promote an alternate presentation only after explicit visual approval and equivalent authenticated operator drills.

## Verification

- presentation self-test: 8/8;
- Perform: 27/27;
- Studio: 12/12;
- mobile Review: 7/7;
- channel passport: 127/127;
- Ops readiness: 43/43;
- Sentinel receipt: 19/19;
- Event Tape: 18/18;
- workstation telemetry: 11/11;
- TypeScript: clean;
- production build: clean.

The one merge conflict was the mobile Book/Review seam. It was resolved in favor of latest `main`: Book retains direct Chart and Chain destinations, Review retains the explicit three-mode hierarchy, and Folio adapts to those shared contracts.
