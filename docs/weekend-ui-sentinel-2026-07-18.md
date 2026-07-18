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

## Remaining dashboard order

1. Event Tape / Review provenance and useful operator filters.
2. Ops workspace and capture/observer receipts.
3. Channels workspace and evidence passports.
4. Shared interaction, contrast, sizing, and cream/blackout polish after functional parity.

Legacy Rooms remain available until each dependency has an equivalent or better destination.
