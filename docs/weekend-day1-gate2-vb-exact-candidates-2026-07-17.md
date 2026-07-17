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

The deterministic fixture test produced:

| Fact | Dry-run result |
|---|---|
| External writes | `false` |
| Exact OCC / raw symbol | `QQQ260720C00600000` / `QQQ   260720C00600000` |
| Candidate decision / exact entry quote | `13:35:00.200Z` / `13:35:00.500Z` |
| Live observed ask / exact Databento entry ask | `9.99` non-exact / `1.05` exact |
| Boundary lags / maximum internal gap | `300 ms` / `500 ms` / `1,000 ms` |
| Canonical content SHA-256 | `edfb1526719008a8519f85dbfe691171bb90f8cb99f5b8a6a3d8f06b992ffe9b` |
| Compressed SHA-256 | `57fc1dd23d5a8405cff90d258625f9001b9bf4d7e7a921ab2068ea5fc4454869` |
| Manager arms | 8/8 exact ask-to-executable-bid arms |
| Censors / eligible | none / true |
| Order path authorized | false |

This is only a synthetic deterministic fixture. It proves adapter behavior; it is not described as an
actual Databento response or historical result.

## Real-object zero-write integration receipt

A second proof read the already-downloaded July 15 gzip object, verified its frozen compressed checksum,
decompressed its saved provider-derived CBBO rows, passed all 555,969 rows through the strict persisted
Databento object parser, selected an exact OCC/window that met every boundary rule, and invoked the same
candidate/object/manifest/SQL/manager adapter. It imported no Supabase or R2 client and wrote nothing.

The historical audit does not retain the original candidate decision timestamp. This fixture therefore
uses the position `openedAtMs` as an explicit historical clock proxy. It proves checksum/parser, adapter,
boundary-validation, canonical-content, SQL-payload, and manager-scorecard integrity; it does **not** prove
recovery of the original decision timestamp or make `openedAtMs` equivalent to that timestamp. The dry-run
receipt labels both the proxy basis and this limited proof scope.

| Fact | Real-object result |
|---|---|
| Frozen input object | `2026-07-15-cffdfe787793a084.json.gz` |
| Input compressed SHA-256 | `cffdfe787793a0849227f92b25440dec607d93f6fa0648d5d95941623e0ba9b4` |
| Manifest SHA-256 | `39dccfe72068ea6ded6ae879e1a9dd91f9399cc8c4077b3cba0745d19f747400` |
| Dataset / schema / parsed rows | `OPRA.PILLAR` / `cbbo-1s` / 555,969 |
| Exact OCC | `SPY260715P00751000` |
| Decision window | `2026-07-15T16:16:03.006Z` → `16:20:53.546Z` |
| Boundary lags / maximum gap | 994 ms / 454 ms / 1,000 ms |
| Exact entry ask / manager arms | $0.92 / 8 of 8 |
| Canonical output SHA-256 | `cd936a4bf32c7d0498e6c78b1789b4d3f4f1524a5ecb14eb48721e998f3a8e28` |
| Canonical gzip SHA-256 | `4c619f3592848f1503592bf7b2bda91eb10571efe0b09bf02074af882344b028` |
| External writes / order authorization | false / false |

The saved historical object contains normalized rows written by the real downloader after the raw
Databento JSON-line parser accepted them; the integration proof reparses the actual checksum-verified saved
bytes rather than inventing quotes. No alternative contract or synthetic path was substituted.

## SQL payload alignment

The self-test parses both proposed `create table` statements and compares their ordered SQL columns to the
canonical TypeScript field contracts and to the actual generated payload keys. All four comparisons are
exact:

- candidate SQL columns = `VB_CANDIDATE_SQL_FIELDS` = generated candidate keys;
- exact-path SQL columns = `VB_EXACT_PATH_SQL_FIELDS` = generated exact-path keys.

Candidate `source_version` remains the worker/channel observation source. Exact-path
`path_builder_version=vb-exact-path-builder-v1` is separately embedded in canonical content, manifest, and
SQL receipt; dataset and schema remain `OPRA.PILLAR` / `cbbo-1s`. The exact-path payload also includes entry
quote time/ask, both boundary lags, maximum internal gap, content and compressed checksums, content-addressed
keys, and verification flags. The migration
remains only a local proposal and has not been applied.

## Verification

- VB candidate adversarial evidence self-test: 35/35 pass;
- left/right boundary, internal-gap, invalid quote, response-contract mismatch, stale/unproven live ask,
  and approximate-contract cases fail closed;
- deterministic end-to-end dry-run: eligible, 8/8 manager arms, zero external writes;
- checksum-verified real-object integration: eligible, 8/8 manager arms, zero external writes;
- candidate and exact-path SQL/payload field alignment: pass;
- legacy live adapter stays read-only and historical pre-stamp rows stay censored.

## Operator-review boundary

An operator must review the proposed schema and separately authorize any migration. Only after that approval
could a later change apply it, run Supabase advisors, verify grants/RLS/append-only insert behavior, and
consider R2 publication. This correction pass performed none of those actions.
