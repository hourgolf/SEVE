# Sunday Skin Lab and Monday gate — 2026-07-19

Status: review-branch implementation. No RC5, Railway, Supabase, R2, strategy,
configuration, order, or production mutation is authorized by this document.

## Outcome

The first alternate presentation is now a sibling shell over the existing
page-owned seam. `app/page.tsx` still owns every remote hook and cross-source
derivation. The 909 workstation and Atlas receive the same `SurfaceProps`,
authenticated actions, incident policy, channel release identity, position
close flow, Sentinel classification, tape model, and Ops readiness model.

Atlas is available only at `/skin-lab` in local development and Vercel preview
deployments. `VERCEL_ENV=production` fails closed with a 404. The production
root cannot select or persist Atlas, and 909 remains the only production shell.

The first proof intentionally reuses the mature workspace leaves. It evaluates
navigation, hierarchy, density, responsive composition, and visual direction
without forking functional logic. A future skin may replace more presentation
leaves only after equivalent contracts and tests exist.

## Skin Lab acceptance

- one set of page-owned hooks regardless of shell;
- no skin-owned fetch or subscription;
- no new mutation path;
- 909 remains `/` and Atlas remains preview/local `/skin-lab`;
- desktop exposes Overview, Markets, Positions, Channels, Sentinel, Review,
  Ops, Legacy Rooms, operator access, and KILL;
- mobile exposes Live, Channels, Book, Review, Ops, account selection,
  settings/auth, and KILL;
- loading, empty, error, stale, unreconciled, and incident states remain the
  shared model's states rather than presentation guesses;
- production build includes a fail-closed route guard.

## Monday gate remains separate

The Skin Lab does not change the sealed release. Before 06:30 PT on July 20,
run the existing authoritative read-only gate from latest `origin/main`:

```sh
npm run preopen
```

Require green for the paper boundary, release ID/hash, worker/run ledger,
account routing and broker/desk reconciliation, six roots, 12/60 held capture,
eight shadow-manager arms, Sentinel session/forDate, and local publisher
readiness. The absence of a first RC5 candidate/fill remains an expected yellow
before the cohort begins. Do not tune configuration during the check.

## Monday proof order

1. Confirm the first candidate's release, family, configuration, admission,
   OCC, source-bar, and quote provenance.
2. Confirm any fill belongs to one of the six roots, uses quantity two, and
   respects premium/debit/family/global limits.
3. Confirm bounded exact-contract capture or an explicit censor.
4. Confirm all eight manager arms share the native root path.
5. Confirm collision and dark-channel opportunities retain reasons/clocks.
6. If a natural paper position is closed manually, verify authenticated reason,
   broker result, desk state, and outcome partition.
7. After close, require flat books, successful publisher exit, object/manifest
   integrity, next-session Sentinel identity, and a non-pooled Day 1 scorecard.

## Promotion boundary

Atlas is not eligible for a production selector until its desktop and mobile
operator drills pass against the same functional checklist as 909. Monday
runtime evidence takes priority over aesthetic promotion. Skin work may continue
on review branches because it cannot alter the sealed release.

