# Phase 1K-G — held-contract OPRA capture foundation

## Status

Review branch only. The pure model, private schema, and default-off runtime adapter are built. The
migration is not applied, Railway has no enabled flag, no worker-version bump was made, and no Supabase
or R2 write is active. Production remains at `main@241525d`.

This phase is observation-only. It cannot place, alter, cancel, resize, or close an order. It does not
change the strict 15-second provider-event rule used by `manager-shadow-book-v1/v2`.

## Why this is the next evidence build

The worker already requests targeted OPRA snapshots for held OCCs on the fast exit/manager clock, but
it does not retain that path. Broad `option_quotes` persistence remains roughly one snapshot per minute,
which is too sparse to assess intratrade peaks, giveback, rational scale points, stop timing, or broker
fill leakage. Phase 1K-G retains only contracts that belong to actual positions and active manager runs;
it does not increase full-chain database traffic.

The evidence must preserve two different clocks:

- **snapshot freshness:** when the targeted request started and completed, plus when the observer handled it;
- **quote-event freshness:** Alpaca's authoritative `latestQuote.t` for the exchange NBBO event.

A recently completed REST response may contain an old exchange quote. The model records both facts and
never substitutes one for the other.

## Pure contract now implemented

`worker/src/heldContractCaptureModel.ts` defines `held-contract-opra-snapshot-v1`:

- position, channel, account, OCC, underlying, worker boot, and worker-version identity;
- request outcome and bounded failure code;
- bid/ask and optional bid/ask sizes only when the NBBO is valid;
- provider quote-event, fetch-start, fetch-complete, and observation clocks;
- separate snapshot age and quote-event age;
- explicit quality: eligible, snapshot stale, quote-event stale, missing, invalid, crossed, future, or request failed;
- deterministic sample IDs for logical idempotence;
- a synchronous bounded queue that sheds evidence—not execution—and attributes drops to position/OCC;
- ET/DST-correct partitions scoped to position, OCC, worker boot, version, date, and hour;
- canonical NDJSON and SHA-256 content addressing;
- gap counts, maximum observation gap, drop/oversize counts, and provider-age p50/p95/max;
- deterministic R2 object and manifest keys.

The 52-check self-test pins invalid/future/crossed/missing behavior, dual freshness clocks, bounded queue
pressure, position-scoped drop attribution, DST partitioning, canonical content hashes, gap math,
position fan-out, shared-OCC isolation, default-off loading, asynchronous compression, retry-stable
manifests, and the absence of provider, broker, position, or order imports in the capture path.

## Draft storage contract

Migration `20260717052246_phase_1k_g_held_contract_capture_receipts.sql` is intentionally unapplied.
It proposes two append-only private tables:

1. `held_contract_capture_receipts` — one compact receipt per immutable R2 segment, including checksums,
   identity, time bounds, sample/quality counts, gaps, provider-age distribution, and drops.
2. `held_contract_capture_health` — explicit queue, R2, receipt, and schema failures when a normal segment
   receipt cannot truthfully carry the missing evidence.

Both tables enable RLS, revoke public/anonymous access, grant the service role `SELECT/INSERT` only, and
allow authenticated reads only for operator JWTs using `app_metadata.seve_role`. Raw samples remain in
R2; Supabase receives compact verification receipts, not the high-cadence quote path.

## Runtime adapter now implemented

The default-off adapter now:

1. Extends targeted snapshot normalization to retain optional sizes while the manager seam stamps fetch start/end timestamps.
2. Fans each OCC observation to every open position that owns it, including lots below the manager cohort's modeled-size floor, without pooling position identity.
3. Continues capturing active shadow-manager paths after the actual position closes.
4. Enqueues synchronously after a targeted request settles; manager code never awaits storage, and high-water work is deferred beyond the callback.
5. Flushes on a timer/high-water mark through a narrow adapter patterned after Phase 1H capture.
6. Compresses canonical NDJSON asynchronously, calculates the compressed checksum, uploads object then manifest, `HEAD`-verifies
   both, and only then appends the Supabase receipt.
7. Emits health evidence for queue, R2, receipt, and schema failures; persistence failures cannot escape into manager state.
8. Remains default-off and refuses activation unless the manager observer, paper mode, OPRA, service role, R2 credentials, schema,
   and safe queue bounds all pass.

If open-position-only OCCs would exceed the tested 500-symbol provider cap, active manager OCCs retain
priority. Omitted capture targets receive an explicit `not_requested / targeted_option_hard_cap_shed`
sample and a rate-limited warning; the capture expansion cannot suppress a manager quote request.

The runtime is dynamically imported only when `HELD_CONTRACT_CAPTURE_ENABLED=true`. Its own prefix,
flush cadence, sample cap, and byte cap are separate from the Phase 1H SIP capture. R2 objects and
manifests are content-addressed; manifest completion uses the last included fetch clock so an idempotent
retry cannot rewrite evidence identity with a new wall-clock timestamp.

## Acceptance gates before activation

- migration review plus Supabase security/performance advisors;
- runtime isolation tests proving capture fan-out/enqueue failures cannot suppress manager advancement and storage work starts outside the manager callback;
- root and worker TypeScript clean, full runner/manager/capture suites green;
- flat paper desk before applying the private migration;
- separately approved worker-version bump and manual Railway deploy;
- first session has one successful sample per healthy fast-exit tick, no unexplained gap above 15 seconds,
  no silent drops, exact broker/desk reconciliation, and no heartbeat degradation;
- at least three clean paper sessions before snapshot-fresh evidence may inform a new manager-policy version;
- manager-v1 strict quote-event semantics remain unchanged throughout the comparison.

## Explicit non-goals

- No OPRA websocket subscription in V1.
- No full-chain write-frequency increase.
- No production strategy, size, stop, target, scaling, manager, or channel change.
- No claim that a snapshot-fresh but provider-stale quote is executable evidence.
- No automated promotion, relegation, or alert threshold.
