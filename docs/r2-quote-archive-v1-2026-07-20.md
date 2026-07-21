# R2 complete-session quote archive v1 — 2026-07-20

Status: implemented locally, default-off, and review-only. No migration was
applied, no R2/Supabase object or row was written, no quote was deleted, and no
service was deployed.

## Outcome

This slice prepares the cold-storage prerequisite for reducing Supabase
storage, IO, and egress without sacrificing the exact option-quote research
tape. It does **not** shorten retention. It adds:

- per-underlying `(underlying,captured_at,id)` keyset traversal for one complete
  ET session, followed by an exact all-day row-count reconciliation;
- deterministic row and object canonicalization;
- immutable content-addressed R2 object and manifest keys;
- uncompressed, compressed, and manifest SHA-256 identities;
- R2 HEAD verification of length, hashes, row count, and content identity;
- one private, compact, idempotent Supabase receipt only after both R2 objects
  verify;
- retry-open behavior whenever schema, R2, verification, or receipt work fails;
- a default-off `QUOTE_ARCHIVE_R2_ENABLED` flag.

The existing Supabase Storage archive remains in place during the proof period.
When R2 is enabled, a day is independently considered complete only from its
verified `quote_archive_receipts` row. A pre-existing Storage object does not
stand in for an R2 receipt.

The two-session dual-write proof will temporarily use more outbound transfer
than the final architecture because the same source rows feed both archive
destinations. That short, measured overlap is intentional; Supabase Storage is
not retired until R2 cold-read parity is proven. The eventual egress reduction
comes from bounded dashboard reads, a shorter receipt-gated Postgres hot window,
and replay reads resolving to R2 rather than repeatedly exporting from Postgres.

## Truth and deletion boundary

The receipt table is research provenance, not an execution source. A day with
an absent object, absent manifest, length mismatch, hash mismatch, row-count
mismatch, missing underlying, receipt conflict, or receipt-write failure remains
**unarchived** for retention purposes.

This branch does not include any DELETE, retention change, object removal, or
automatic fallback to approximate data. The proposed `(underlying,
captured_at,id)` index and private receipt table are migration review only.

## Proposed proof sequence

1. Review the code and migration independently.
2. Apply only the private receipt/index migration with explicit authorization,
   outside market hours, and observe index-build IO.
3. Deploy with `QUOTE_ARCHIVE_R2_ENABLED=1` and the existing R2 credentials,
   keeping the seven-day Supabase hot window unchanged.
4. Verify two consecutive complete sessions: object, manifest, receipt, counts,
   boundaries, hashes, and a cold read/replay.
5. Only then draft a separate receipt-gated bounded-retention migration.

No step above is an authorization to migrate, deploy, write R2/Supabase, delete
data, merge, or change trading policy.

## Local verification

- quote archive: 20/20
- existing archive retry policy: 4/4
- runner: 150/150
- market calendar: pass
- root and worker TypeScript: clean
