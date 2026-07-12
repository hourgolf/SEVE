# Databento backfill v2 — storage and spend policy

## Decision

The research corpus is stored outside the application database at:

`data/databento-v2/`

This directory is already covered by the repository's `data/` ignore rule. It is local research state, never committed to Git, never bundled into Vercel, and never read by the live Railway worker.

Layout:

- `raw/opra-pillar/cbbo-1m/` — immutable Databento batch downloads in their original compressed form.
- `derived/parquet/` — normalized, research-ready partitions for repeatable replays.
- `manifests/` — request parameters, Databento metadata, checksums, completeness, lineage, and cost receipts.

Supabase Postgres remains the live operational ledger. It should hold compact run/trade/results facts and, later, a small corpus catalog—not historical quote payloads. Supabase Storage on the current Free organization is also too small for this archive.

## Initial scope

- Underlyings: SPY, QQQ, IWM.
- Options: actual listed contracts, 0–2 DTE, bounded around the tradable region required by the channel replays.
- Options truth: OPRA.PILLAR `cbbo-1m` plus definitions.
- Underlying truth: production-consistent SIP minute bars, separately manifested.
- Target window: 2022-01-03 through 2026-07-10, subject to source availability and the exact cost quote.

This is deliberately not a full OPRA dump. Full-market, tick-level OPRA is orders of magnitude larger than the evidence needed to test these channels.

## Capacity guardrails

The planner derives its baseline from the existing SPY/QQQ/IWM multi-DTE caches and checks the current filesystem before any batch request.

- Hard local working-set cap: 40 GiB.
- Minimum disk space left free: 50 GiB.
- If either guard fails, the batch is not ordered.
- Local is staging, not the only durable copy. Before deleting Databento's 30-day redownload window, copy the immutable raw partitions and manifests to versioned object storage.

Baseline measured 2026-07-12:

- Existing Databento caches: 3.08 GiB.
- Workstation free space: 106.81 GiB.
- Space usable while preserving the reserve: 56.81 GiB.
- Projected v2 canonical corpus: 18.26 GiB.
- Projected peak local working set: 36.51 GiB.
- Capacity gate: PASS.

Run the no-spend planner:

`npm run databento:plan`

Machine-readable output:

`npm run databento:plan -- --json`

Request the no-spend, full-chain price ceiling from Databento:

`npm run databento:cost-envelope`

The cost-envelope command can only call `metadata.get_cost`; it contains no data-download or batch-submit path.

## Spend gates

1. Inventory existing coverage and calculate the storage projection.
2. Request Databento metadata/cost estimates only. This does not order data.
3. Present the exact dollar/credit estimate and expected bytes.
4. Submit batch jobs only with an explicit maximum cost and maximum byte ceiling.
5. Download once, verify Databento's checksums, and retain the original manifest.
6. Build derived partitions from the immutable source; never silently overwrite raw data.

The legacy streaming script remains available for its existing caches, but it is not the v2 bulk-backfill path: retries can rebill, its synthetic integer-strike list can omit real contracts, and JSON is inefficient as the canonical format.

## Budget model

There are three separate budgets:

- **Databento acquisition:** exact and request-specific; no guess is treated as authorization. The quote gate establishes this before ordering.
- **Local staging:** no incremental subscription cost, but strictly capped because the workstation disk is already heavily used.
- **Durable archive:** object storage sized to the verified canonical corpus. The provider is intentionally not coupled to the ingest code; the manifest/checksum layout can move to S3-compatible storage without changing replay semantics.

The planner's `peakWorkingGiB` is the number to reserve locally. It includes compressed raw data, a derived copy, manifests, and one in-progress batch. It is deliberately higher than the final canonical archive size.

The 2026-07-12 Databento metadata quote established a deliberately broad full-chain ceiling of $1,470.57 for `cbbo-1m` plus $41.99 for definitions. That is not an approved order and is evidence that a parent-symbol full-chain pull is wasteful. V2 must resolve and filter the listed contracts first, then quote the exact filtered symbol set under a hard maximum.

For the durable copy, Cloudflare R2 Standard is the current default recommendation because it is S3-compatible, includes 10 GB-month, charges $0.015/GB-month beyond that, and does not charge internet egress. At the current projection:

- 18.26 GB canonical archive: roughly $0.13/month for storage after the included 10 GB.
- 36.51 GB if raw and all working derivatives are retained remotely: roughly $0.40/month.
- Reserve $1/month initially; request counts should remain inside the included operation tiers because the archive uses coarse partitions rather than millions of tiny objects.

No R2 account or bucket is created by this slice. Until credentials and lifecycle policy are approved, the local copy remains staging only and no paid Databento batch should be ordered.
