# Weekend Day 1 — corrected Gate 2 exact VB candidate extension

Status: **local dry-run implementation complete; migration, R2 publication, Supabase writes, strategy
changes, and deployment are not authorized**.

This extends the existing `signals` → `gate-shadow` → `virtual_trades` research lane. It cannot authorize
an order or policy change and imports no R2 or Supabase write client in the canonical dry-run adapter.

## Canonical candidate and provenance

Future worker rationale stamps the exact completed source-bar clock, its observation clock, strategist and
account identities, channel/configuration/manager/worker versions, underlying, side, and exact OCC. The
canonical TypeScript candidate payload and proposed SQL table now match exactly, including
`strategist_id` and `source_version`.

The live Alpaca snapshot ask is retained only as provenance:

- feed: `alpaca_snapshot`;
- provider timestamp: null unless actually proven;
- worker observation timestamp and freshness retained;
- `live_ask_exact=false` by invariant.

It is never called an exact executable entry ask and is never substituted into scoring. Candidate identity
is channel version + exact source clock + underlying + option side + OCC + configuration epoch. Account and
strategist remain provenance; a later valid re-entry receives a new deterministic ordinal.

## Exact path acceptance contract

The adapter requests the compact candidate OCC as one exact Databento raw symbol from `OPRA.PILLAR` /
`cbbo-1s`. It validates contract identity, source, finite positive executable quotes, and ordered timestamps.
It requires:

- an actual quote at/after the candidate decision boundary with lag <= 1,100 ms;
- an actual quote at/after the requested exit boundary with lag <= 1,100 ms;
- no internal observed quote gap above 5,000 ms through the right boundary;
- a positive, non-crossed Databento entry ask from the accepted left-boundary quote.

Failures retain explicit `left_boundary_censored`, `right_boundary_censored`, `internal_gap_censored`,
`path_identity_mismatch`, `invalid_exact_quote`, or `invalid_exact_entry_ask` codes. Missing paths are never
replaced with snapshots, mids, `option_quotes`, approximate OCCs, or synthetic VB results.

## End-to-end zero-write adapter proof

`buildVbExactCandidateDryRun` performs the complete in-memory chain:

candidate ledger → exact contract request → Databento response validation → canonical content-addressed
object and manifest → proposed Supabase payload → eight-arm manager scorecard.

The deterministic proof produced:

| Fact | Dry-run result |
|---|---|
| External writes | `false` |
| Exact OCC / raw symbol | `QQQ260720C00600000` / `QQQ   260720C00600000` |
| Candidate decision / exact entry quote | `13:35:00.000Z` / `13:35:00.500Z` |
| Live observed ask / exact Databento entry ask | `9.99` non-exact / `1.05` exact |
| Boundary lags / maximum internal gap | `500 ms` / `500 ms` / `1,000 ms` |
| Canonical content SHA-256 | `eb04d3307e4b0894cb3d65c20042181516549361194790e28fc52912d18e00b5` |
| Compressed SHA-256 | `e75188295a47f9398740ce734c120345ad02f2fc49b4267b27c89feaa6252946` |
| Manager arms | 8/8 exact ask-to-executable-bid arms |
| Censors / eligible | none / true |
| Order path authorized | false |

The proof is deterministic fixture evidence, not a historical result and not an external publication.

## SQL payload alignment

The self-test parses both proposed `create table` statements and compares their ordered SQL columns to the
canonical TypeScript field contracts and to the actual generated payload keys. All four comparisons are
exact:

- candidate SQL columns = `VB_CANDIDATE_SQL_FIELDS` = generated candidate keys;
- exact-path SQL columns = `VB_EXACT_PATH_SQL_FIELDS` = generated exact-path keys.

The exact-path payload includes entry quote time/ask, both boundary lags, maximum internal gap, source
version, content and compressed checksums, content-addressed keys, and verification flags. The migration
remains only a local proposal and has not been applied.

## Verification

- VB candidate adversarial evidence self-test: 32/32 pass;
- left/right boundary, internal-gap, invalid quote, response-contract mismatch, stale/unproven live ask,
  and approximate-contract cases fail closed;
- deterministic end-to-end dry-run: eligible, 8/8 manager arms, zero external writes;
- candidate and exact-path SQL/payload field alignment: pass;
- legacy live adapter stays read-only and historical pre-stamp rows stay censored.

## Operator-review boundary

An operator must review the proposed schema and separately authorize any migration. Only after that approval
could a later change apply it, run Supabase advisors, verify grants/RLS/append-only insert behavior, and
consider R2 publication. This correction pass performed none of those actions.
