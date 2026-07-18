# Weekend UI — channel passports

Date: 2026-07-18
Branch: `weekend-channels-passports`
Production impact: none; review branch only

## Purpose

Make Channels tell the truth about the sealed Monday RC5 policy without replacing
the page-owned data seam or introducing another subscription.

The database roster is not runtime authority for RC5. Twenty-five database rows
may still read armed, while the sealed worker overlay authorizes only six paper
roots and treats every other channel as dark evidence. The workspace now shows
both states instead of collapsing them into one ambiguous `ARMED` label.

## Runtime contract

The browser-safe client contract is pinned to:

- release `weekend-day1-2026-07-20-rc5`;
- configuration SHA-256
  `5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba`;
- worker `stream-2026-07-17g`;
- six sealed paper roots and their quantity, DTE, premium/debit limits, risk
  budgets, family priority, catastrophe stop, bell exit, and version identities;
- eight observational manager arms;
- all non-root rows as dark/no-fill evidence.

An exact retained startup receipt is required before the UI asserts either
`PAPER ROOT` or `DARK EVIDENCE`. Missing or mismatched receipts produce
`UNVERIFIED`; the database is then shown only as database state.

The general Event Tape intentionally retains only 14 rows. Release identity is
therefore fetched by one additional targeted `events.message` SELECT inside the
existing 60-second market-data poll. This adds no timer or leaf subscription and
prevents normal live-session tape volume from evicting the startup receipt.

The self-test also compares every displayed sealed field against the committed
RC5 machine receipts. This prevents a later worker policy change from silently
leaving a plausible but false dashboard behind.

## Desktop and mobile behavior

- The fleet/rack has a release strip with exact hash evidence and account-scoped
  root/dark counts.
- Rows show runtime lifecycle separately from database state/executor.
- Runtime-dark rows cannot appear active merely because the old database row is
  armed.
- The inspector shows the sealed root policy or the dark T+1 evidence path.
- Existing database knobs are labeled as a future-epoch preview and are read-only
  while the sealed RC5 receipt is verified. Changing those rows would not change
  RC5 and would create policy drift.
- The evidence passport shows recent decisions/censors, recent fills, observer
  arms, and version identity.
- The existing five-session performance panel is explicitly labeled historical,
  mixed-epoch, pre-RC5 context—not prospective Day 1 evidence.

The architecture invariant remains:

`page.tsx owns hooks → SurfaceProps → shells compose → leaves remain subscription-free`.

## Verification

- `tsc --noEmit`
- `npm run channel-passport-selftest` — 110/110
- `npm run release-receipt-selftest` — 5/5
- `npm run studio-selftest` — 12/12
- `npm run sentinel-receipt-selftest` — 11/11
- `npm run event-tape-selftest` — 13/13
- `npm run build`
- local browser smoke at desktop and 390×844 mobile, including FIRST-TEAM and
  MORGUE account scoping and the expanded mobile passport

No Supabase/R2 write, schema migration, strategy/configuration change, order,
merge, deployment, or production mutation is part of this slice.
