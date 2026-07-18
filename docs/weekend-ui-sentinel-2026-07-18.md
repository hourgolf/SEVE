# Weekend UI functional slice — Sentinel and Review

Date: 2026-07-18  
Branch: `weekend-ui-functional`

## Outcome

The desktop Sentinel destination is now a real evidence workspace instead of an expanded compact rail. Mobile Review now exposes the same Sentinel receipt identity and deterministic scan without duplicating the page-owned subscription.

This slice does not change the Day 1 roster, order behavior, Railway configuration, Supabase schema, or the frozen July 17 receipt.

## Truthful states

- The existing July 17 receipt is shown as `CURRENT · SESSION INFERRED` because it contains semantically correct `date/asOf` and `forDate` fields but no literal `session` field.
- Future publisher output is versioned as Sentinel receipt schema v2 and includes explicit `session`, `forDate`, `publishedAt`, and publisher identity.
- Missing, loading, read-error, inferred-identity, current, and stale-target states are deterministic and self-tested.
- Interpretive judgment is visibly separated from deterministic scan evidence and is never presented as a worker-health or arm-state claim.

## Verification

- `sentinel-receipt-selftest`: 11/11 passed
- `tsc --noEmit`: passed
- production build: passed
- desktop Sentinel browser smoke: passed
- mobile Review at 390x844: passed; zero horizontal overflow
- desktop and mobile console warnings/errors: zero

## Event Tape follow-on

The same branch now also replaces the expanded compact desktop Tape with a full operational ledger workspace. It exposes query health, the 14-row retention boundary, latest-row time, adjacent-repeat collapsing, and execution/risk/data/Sentinel/system filters. Mobile Play uses the same status model and no longer labels a weekend ledger `LIVE` merely because rows exist.

Additional verification:

- `event-tape-selftest`: 13/13 passed
- desktop filters exercised against real retained rows
- mobile Tape at 390x844: 14 rows, zero horizontal overflow
- final production build: passed

## Ops follow-on

Desktop now has a real read-only Ops destination. It separates the 24/7 process ledger from the RTH stream beat and cron snapshot, reports each app market read independently, exposes the most recent Day 1 startup receipt without treating it as liveness, and labels database assignments separately from the runtime release overlay. The mobile Ops room carries the same release receipt and now labels its roster counts as database state.

The release parser is deterministic and rejects malformed/incomplete hashes. No Railway configuration or runtime behavior is changed by this UI.

## Remaining dashboard order

1. Channels workspace and evidence passports.
2. Deeper capture/observer receipts once their evidence is available at the shared seam.
3. Shared interaction, contrast, sizing, and cream/blackout polish after functional parity.

Legacy Rooms remain available until each dependency has an equivalent or better destination.
