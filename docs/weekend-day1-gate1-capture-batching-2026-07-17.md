# SEVE Weekend Day 1 — Gate 1 Capture Batching

Status: safe local implementation prepared and verified. **Not deployed.** No migration, production
configuration, Supabase/R2 write, order action, merge, or Railway action is authorized by this record.
The prepared worker identity is `stream-2026-07-17b`; production remains `stream-2026-07-17a`.

Gate 0 is frozen at `746407a` before these changes.

## Reproduced failure mode

The deterministic July 17 fixture reproduces the production fragmentation exactly:

- 102,545 samples;
- 20,794 receipts;
- 4.9315 samples per receipt;
- 16,139,289 compressed raw bytes;
- 33,965,189 manifest bytes;
- 37,724,160 Supabase heap/index bytes.

The runtime drained and persisted every 30 seconds. Each drain immediately created a separate immutable
position/OCC/hour segment, even when the next drain belonged to the same evidence partition.

## Local batching contract

`HeldContractCaptureBatcher` now coalesces consecutive queue drains without changing capture sampling or
the immutable segment schema:

1. `capture()` remains synchronous and only enqueues normalized observations.
2. The 30-second timer drains the bounded queue into position/OCC/boot/version/date/hour partitions.
3. A partition seals at 24 samples, 120 seconds, an ET hour/session boundary, high water, or shutdown.
4. Sealing occurs before any R2 or Supabase I/O. Later samples enter a new open batch and cannot change a
   sealed batch's bytes, checksum, object key, manifest key, or receipt identity.
5. R2 or receipt failure retains the sealed batch for retry. A receipt acknowledgement removes only the
   exact sealed token that reached durable append-only receipt state.
6. Duplicate sample identities across drains coalesce deterministically.
7. Drop-only drains remain attached to an existing open partition, while queue-drop health remains
   explicit immediately.

Provider requests, manager advancement, execution, orders, channel configuration, source clocks, dual
freshness clocks, the strict 15-second quote-event rule, content addressing, and position/OCC identity
are unchanged. The receipt schema and RLS/grant contract are unchanged; no database migration is needed.

## Retry and failure semantics

- R2 object or manifest failure: the sealed batch remains in memory and retries with the same bytes and
  content-addressed keys.
- Receipt failure after verified R2 writes: the same batch retries; a server-committed response lost in
  transit resolves through the existing duplicate-receipt idempotence path.
- New samples never join a sealed retry batch.
- High water and shutdown seal all open batches.
- Execution and manager state do not import or await the batcher or storage adapters.

Abrupt process death can still lose an in-memory open or sealed batch. With the proposed defaults, the
normal open-batch exposure is bounded by the 120-second age plus at most one 30-second timer phase. This
is a larger crash window than V1's immediate 30-second segment persistence and remains a deployment
yellow. A reviewed deploy must either explicitly accept that bounded research-evidence exposure with
gap detection or add durable staging/recovery. It must not claim crash-proof capture.

## July 17 sequence replay and storage projection

A SELECT-only replay at `2026-07-17T20:56:54.375Z` grouped the actual July 17 receipt sequence within
the immutable partition keys and sealed at the proposed 24-sample/120-second bounds:

| Measure | July 17 V1 | Projected batcher |
|---|---:|---:|
| Receipts | 20,794 | 6,022 |
| Samples per receipt | 4.9315 | 17.0284 |
| Receipt reduction | — | 71.04% |
| Supabase bytes/session, linear | 37,724,160 | 10,925,022 |
| Manifest bytes/session, linear | 33,965,189 | 9,836,413 |
| Raw gzip bytes/session | 16,139,289 | 16,139,289 conservative |
| Supabase bytes/20 sessions | 754,483,200 | 218,500,425 |
| R2 bytes/20 sessions | 1,002,089,560 | 519,514,037 conservative |

The replay gives no gzip-compression credit and scales receipt/manifest bytes linearly. It is a planning
projection, not a post-deploy measurement. Short-lived positions, high-water pressure, retries, and real
shutdown timing can produce different segment counts. Acceptance still requires a dark post-deploy
smoke receipt after operator review.

## Verification completed

- root TypeScript: pass;
- worker TypeScript: pass;
- held-contract capture: 67/67 pass;
- runner: 146/146 pass;
- manager shadow: 17/17 pass;
- manager shadow book: 149/149 pass.

The focused tests pin the July 17 fragmentation fixture, timer batching, age seal, high-water seal,
shutdown seal, hour boundary, ET session boundary, shared-OCC position isolation, queue pressure,
drop-only attribution, deterministic retry identity, receipt-only acknowledgement, and later-sample
isolation.

## Review gates before deployment

1. Decide whether the bounded 150-second worst-phase crash exposure is acceptable or require durable
   staging/recovery.
2. Review the proposed 24-sample/120-second batch defaults.
3. Verify the prepared `stream-2026-07-17b` identity against the final reviewed diff.
4. Re-run the complete Gate 6 suite and flat broker/desk gate.
5. Manually deploy Railway only after explicit operator approval.
6. Verify heartbeat/version and one dark receipt whose sample density is materially larger without any
   changed quality or clock semantics.
