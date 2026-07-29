# Supabase hot quote-storage audit — 2026-07-28

Status: **LIVE READ-ONLY AUDIT · LOCAL RECOMMENDATION · NO CHANGE AUTHORITY**

No row, index, schedule, function, retention policy, schema, or production
setting was changed during this audit.

## Executive conclusion

SEVE's option tape explains why the project outgrew Supabase Free, but it does
not justify another plan upgrade.

- Current database size: **491 MB**.
- Current public-table total: **441 MB**.
- `option_quotes`: **197 MB**, or about 40% of the database.
- Supabase Pro includes 8 GB of disk per project before metered overage.
- The correct near-term posture is therefore: keep Pro, reduce avoidable hot
  retention, and preserve exact evidence in the existing immutable R2 archive.

The largest safe opportunity is not an index deletion. It is a receipt-gated
move from seven calendar days of hot option quotes toward two completed trading
sessions after cold-read parity is proven.

## Live measurements

### `option_quotes`

- 490,696 live rows and zero estimated dead rows.
- 75 MB heap.
- 122 MB indexes.
- Approximately 80,000–84,000 rows per full session.
- Six completed sessions currently remain hot: July 21–24 and July 27–28.
- Approximate hot growth: 32–33 MB per retained session including indexes.

All five indexes have real scan history and must be treated as used:

| Index | Size | Recorded scans | Disposition |
| --- | ---: | ---: | --- |
| `idx_oq_symbol_time` | 53 MB | 397,818 | keep |
| `idx_oq_keyset` | 33 MB | 113,400 | keep; archive pagination depends on it |
| `option_quotes_pkey` | 20 MB | 810,725 | keep |
| `idx_oq_chain` | 9 MB | 226,984 | keep |
| `idx_oq_underlying_captured_at` | 7.3 MB | 12,873 | keep pending query-plan review |

This rules out a casual "drop the big indexes" response.

### Immutable archive

Seven verified `r2-option-quotes-v1` archive receipts exist for July 20–28.
Each completed session compresses to approximately 4.4–4.7 MB, versus roughly
32–33 MB in the indexed hot table.

The archive already carries:

- exact session identity;
- row and per-underlying counts;
- first and last capture clocks;
- raw, compressed, and manifest SHA-256 identities;
- object and manifest keys;
- completion and verification clocks.

That is the correct evidence substrate for shorter hot retention, provided a
clean cold-read replay proves parity first.

## Confirmed ingest-window mismatch

The active `market-ingest-1m` cron runs:

`* 13-20 * * 1-5`

The schedule is UTC-hour based, not market-calendar or DST aware. The deployed
edge function itself has no market-session guard. During EDT it therefore keeps
writing through 16:59 ET.

July 28 illustrates the mismatch:

- hot table: 80,404 rows, last quote at 16:59:01 ET;
- verified archive: 75,532 rows, last quote at 16:30:08 ET;
- approximately 4,872 later hot rows were not part of the sealed archive.

Across the six retained sessions, about 6.3% of rows arrive at or after 16:30
ET, and about 9.4% arrive at or after 16:15 ET.

Those rows are not automatically bad, but the current system has no explicit
claim for why they are needed and does not consistently include them in the
immutable session object.

## Recommended implementation sequence

### Phase A — local-only

Status: **IMPLEMENTED AND TESTED LOCALLY · NOT DEPLOYED**

1. `lib/market/marketIngestWindow.ts` adds a pure, DST-safe window using the
   maintained market calendar and true full-day or half-day close.
2. The final allowed capture minute is session close plus 15 minutes.
3. Normal-session, half-day, holiday, weekend, pre-open, DST, next-session, and
   stale-calendar fixtures pass in `marketIngestWindow.selftest.ts`.
4. `market-ingest.ts` now skips without fetching or writing outside the window
   and derives 1DTE from the maintained next trading session.
5. Do not change the deployed cron during this phase.

Local validation:

- `npm run market-ingest-window-selftest` — pass
- `npm run market-ingest-edge:selftest` — pass
- `npm run market-calendar-selftest` — pass
- `npx tsc --noEmit` — pass
- `npm run build` — pass

The review found that the root source's relative imports were not directly
represented in the repository's Supabase function layout. That packaging gap
is now closed without duplicating calendar authority:

- `npm run market-ingest-edge:build` bundles the reviewed root source and its
  two pure local dependencies into
  `supabase/functions/market-ingest/index.ts`;
- the checked-in file is a generated, self-contained deployment artifact;
- `npm run market-ingest-edge:selftest` regenerates it in memory, proves the
  exact three-file source graph, permits only the Supabase JSR import, checks
  the fail-closed guard markers, and byte-compares it with the checked-in file.

The reviewed deployment command is:

`npx supabase functions deploy market-ingest --project-ref xvdfsxwwedltvdktqdac`

The live pre-deployment metadata check confirmed that deployed
`market-ingest` v10 is active with `verify_jwt=true`; omitting
`--no-verify-jwt` preserves that authentication boundary. The command is
documented for the separately approved production phase; it was not run during
local implementation or PR review.

No Supabase function or cron was changed by this local work.

### Phase B — archive parity

Status: **PURE FAIL-CLOSED PARITY MODEL IMPLEMENTED LOCALLY · LIVE COLD READ NOT RUN**

1. Generate an archive from the exact bounded window.
2. Prove hot-row count equals archived row count for each underlying.
3. Verify object HEAD metadata, checksums, manifest, and cold-read replay.
4. Fail closed: no successful receipt means no retention deletion.

`worker/src/quoteArchiveParityModel.ts` now provides the deletion-inert proof
gate. It requires the hot bounded rows, cold compressed object, manifest, both
HEAD receipts, and the compact Supabase receipt to agree on:

- session and archive contract;
- total and per-underlying counts;
- first/last capture clocks;
- canonical hot/cold content identity;
- compressed object, manifest, and content SHA-256 values;
- object sizes and HEAD metadata;
- receipt completion/verification ordering;
- unique row identity and the bounded ingest window.

Any missing receipt, corrupt object, manifest mismatch, out-of-window row,
duplicate identity, count mismatch, or checksum mismatch returns
`retentionEligible: false`. The model has no storage deletion, database write,
broker, order, or configuration capability.

Local validation:

- `npm run quote-archive-parity-selftest` — 10/10 pass
- `npm run quote-archive-selftest` — 23/23 pass
- worker TypeScript — pass

The read-only adapter now exists at `scripts/quote-archive-parity.ts`. Its
structural contract forbids insert, update, upsert, delete, PUT, and DELETE
operations; it only SELECTs Supabase and GETs/HEADs R2 evidence.

### July 28 live baseline

The adapter was run read-only against July 28 and correctly returned:

- `ok: false`
- `retentionEligible: false`
- 80,404 hot rows
- 75,532 cold archived rows
- 7,392 hot rows outside the proposed 08:55–16:15:59 ET window
- mismatched total/per-underlying counts, capture bounds, content checksum, and
  hot-versus-cold canonical row identity

The archived object, manifest, HEAD metadata, and receipt agree with one
another; the mismatch is between that sealed archive and the broader hot
session. This is the expected pre-change baseline and proves why current hot
rows cannot be pruned based on the existing receipt.

No live retention change is justified until the bounded ingest and archive
window are reviewed together and at least two new sessions pass this adapter.

### Phase C — separately approved production change

1. Deploy the bounded ingest guard.
2. Observe at least two completed sessions.
3. Shorten hot retention from seven calendar days to two completed trading
   sessions only after both sessions have verified immutable receipts.
4. Keep the most recent two sessions hot for dashboard, same-week analysis, and
   rapid operator review.

At current density, two-session retention should reduce `option_quotes` from
roughly 197 MB toward 65–75 MB. The exact post-delete disk result must be
measured; PostgreSQL may require ordinary vacuum/reuse before file-level disk
usage visibly contracts.

## Explicit non-recommendations

- Do not downgrade from Pro merely to save $25 while SEVE is production-facing.
- Do not buy more Supabase storage now.
- Do not delete unarchived rows.
- Do not drop the quote indexes based only on size.
- Do not let a retention job infer archive success from date alone.
- Do not treat the R2 archive as broker, OCC, or execution authority.

## Current official references

- Supabase pricing: https://supabase.com/pricing
- Supabase database and disk sizing:
  https://supabase.com/docs/guides/platform/database-size
