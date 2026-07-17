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
7. Open plus sealed/retry state is jointly bounded at 10,000 retained samples and 8 MiB of estimated
   in-memory evidence. The ingress queue remains independently bounded.
8. At either state bound, only the incoming research observation is shed. Execution and manager state are
   untouched, while the retained partition and health facts record truthful sample/byte shedding.
9. Drop-only drains remain attached to an existing open partition, while queue/state-drop health remains
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
- A failed batch is attempted at most five times. Normal flushes use exponential retry times of 0, 30, 90,
  210, and 450 seconds after sealing; a failed batch is then explicitly censored and released. It is not
  retried on every 30-second flush forever.
- Shutdown bypasses delay but not the finite retry budget. It serially awaits all pending partitions through
  at most five forced passes. The former 1.5-second race is removed; shutdown either completes all receipts
  or logs the exact remaining censored sample/byte count after budget exhaustion.

Abrupt process death can still lose an in-memory open or sealed batch. The sample and byte caps prevent
unbounded memory, but they are not durable staging. The measured windows below include the open timer phase
and the full normal retry schedule. Adapter call duration itself has no local upper bound, so a deploy also
needs platform shutdown grace long enough for the awaited calls or a later durable staging design. It must
not claim crash-proof capture.

## July 17 sequence replay and storage projection

A SELECT-only replay at `2026-07-17T20:56:54.375Z` grouped the actual July 17 receipt sequence within
the immutable partition keys and sealed at the proposed 24-sample/120-second bounds:

| Measure | July 17 V1 | 24 samples / 120 sec | 12 samples / 60 sec |
|---|---:|---:|---:|
| Receipts | 20,794 | 6,022 | 9,218 |
| Receipt reduction | — | 71.04% | 55.67% |
| Maximum open loss window | about 30 sec | 150 sec | 90 sec |
| Retry attempts / schedule after seal | immediate segment | 5 / 0,30,90,210,450 sec | 5 / 0,30,90,210,450 sec |
| Maximum retained evidence-loss exposure | about 30 sec | 600 sec | 540 sec |
| Supabase bytes/session, linear | 37,724,160 | 10,925,022 | 16,723,156 |
| Raw gzip bytes/session | 16,139,289 | 16,139,289 conservative | 16,139,289 conservative |

The replay gives no gzip-compression credit and scales receipt bytes linearly. It is a planning projection,
not a post-deploy measurement. Short-lived positions, state pressure, retries, and real shutdown timing can
produce different segment counts. The **recommendation is 12 samples / 60 seconds**: it still removes 55.67%
of July 17 receipts while reducing the normal open window by 60 seconds and total bounded retained exposure
by 60 seconds versus 24/120. This is a review recommendation only; defaults remain 24/120 and nothing was
deployed.

## Verification completed

- root TypeScript: pass;
- worker TypeScript: pass;
- held-contract capture: 79/79 pass;
- runner: 146/146 pass;
- manager shadow: 17/17 pass;
- manager shadow book: 149/149 pass.

The focused tests additionally prove combined open/sealed sample and byte bounds, sustained R2 outage,
sustained Supabase-receipt outage, finite backoff/eviction, research-only shedding, truthful attribution,
multi-partition shutdown, and forced shutdown retry without the former timeout race.

## Review gates before deployment

1. Decide whether the recommended 12/60 option and its 540-second maximum retained exposure are acceptable,
   whether to retain 24/120 and 600 seconds, or require durable staging/recovery.
2. Review the 10,000-sample/8-MiB state bounds and five-attempt retry budget.
3. Verify the prepared `stream-2026-07-17b` identity against the final reviewed diff.
4. Re-run the complete Gate 6 suite and flat broker/desk gate.
5. Manually deploy Railway only after explicit operator approval.
6. Verify heartbeat/version and one dark receipt whose sample density is materially larger without any
   changed quality or clock semantics.
