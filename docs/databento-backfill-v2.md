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

Build the exact strategy-tradable quote from local SIP ranges:

`npm run databento:target-quote`

This requests one cost estimate per real session for standard integer-strike SPY/QQQ/IWM contracts within the session's RTH low/high plus $10, for expirations 0–2 sessions forward. The worker's live chain window is $8 and the widest current research structure is five strikes from its anchor, so $10 is a conservative replay boundary. This command also has no data-download or batch-submit endpoint.

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

The 2026-07-12 Databento metadata quote established a deliberately broad full-chain ceiling of $1,470.57 for `cbbo-1m` plus $41.99 for definitions. That is not an approved order and is evidence that a parent-symbol full-chain pull is wasteful.

The exact strategy-tradable quote then reduced the request to:

- 1,133 common SPY/QQQ/IWM sessions from 2022-01-03 through 2026-07-10.
- 560,922 symbol-days.
- Standard integer-strike contracts within each underlying's RTH low/high plus $10.
- Expirations from the session through two trading sessions forward.
- Exact Databento `metadata.get_cost` result: **$29.79**.

The $29.79 is still a quote, not an approved or submitted order. The local quote receipt is gitignored at `data/databento-v2/manifests/quotes/target-2022-01-03_2026-07-10-w10-dte2.json`.

The operator approved a $35 hard ceiling on 2026-07-12. Acquisition uses one compressed DBN stream per session rather than 1,133 tiny batch jobs. Combining sessions into larger jobs was rejected because each date has a different causal 0–2 DTE/strike universe; a combined request would purchase irrelevant pre-expiry history and invalidate the exact quote. The downloader has no automatic paid retry, writes atomically, verifies the quoted symbol count before each request, checksums every completed file, and resumes by skipping completed files.

`npm run databento:download-target -- --max-usd 35`

The underlying scope was built from production-consistent Alpaca SIP minute bars. The local archives now contain 1,133 sessions for each of SPY, QQQ, and IWM over the target interval. Using the completed session's RTH range to define the acquisition universe does not enter the replay's decision logic; it only ensures the stored corpus contains every strike the causal strategy could have selected at signal time.

For the durable copy, Cloudflare R2 Standard is the current default recommendation because it is S3-compatible, includes 10 GB-month, charges $0.015/GB-month beyond that, and does not charge internet egress. At the current projection:

- 18.26 GB canonical archive: roughly $0.13/month for storage after the included 10 GB.
- 36.51 GB if raw and all working derivatives are retained remotely: roughly $0.40/month.
- Reserve $1/month initially; request counts should remain inside the included operation tiers because the archive uses coarse partitions rather than millions of tiny objects.

No R2 account or bucket is created by this slice. Until credentials and lifecycle policy are approved, the local copy remains staging only and no paid Databento batch should be ordered.

## R2 durable copy

Create a private Standard-class bucket named `seve-market-archive`. Create an R2 S3 token with Object Read & Write scoped only to that bucket. Put the account ID, S3 Access Key ID, S3 Secret Access Key, bucket, and optional prefix into `.env.local` using `.env.local.example`; never paste them into chat or any `NEXT_PUBLIC_` variable.

After the acquisition receipt is green, run `npm run databento:r2-sync`. It refuses partial acquisitions, uploads raw DBN plus provenance receipts, attaches a SHA-256 to every object, verifies every object with `HeadObject`, skips already-matching objects on resume, and never deletes local or remote data.

Completed 2026-07-12: 1,133/1,133 Databento sessions (4.11 GiB compressed) plus two provenance receipts were uploaded to the private `seve-market-archive` bucket under `seve/databento-v2`. All 1,135 objects passed post-upload byte-size and SHA-256 metadata verification. `npm run databento:r2-sync -- --check` provides a read-only credential/bucket reachability test.

The local decode environment is isolated in `.venv-databento` and reproducible from `requirements-databento.txt`. `npm run databento:validate` verifies every raw file against the acquisition receipt and decodes representative sessions across every year. Only after that gate passes may `npm run databento:convert` create atomic, resumable daily Zstd Parquet partitions under `data/databento-v2/derived/parquet`.

Validation and conversion completed 2026-07-12: all 1,133 raw hashes matched; 15 cross-year sample sessions decoded through Databento's official library; and 1,133 daily Parquet partitions were written with zero partial files. The derived layer is 1.1 GiB (1,192,197,155 bytes). Cross-year Parquet reads match raw row counts and expose the pinned replay schema (`ts_recv`, OCC symbol, underlying, expiration, strike, option type, bid/ask, sizes, publisher/instrument IDs, flags).

When the conversion receipt is green, the R2 sync also mirrors all derived Parquet partitions plus the validation and conversion receipts. Raw remains canonical; derived partitions are included so the workstation copy can eventually be offloaded without paying the decode cost again.

Final R2 verification: 2,270 objects / 5,601,840,536 bytes. The second sync uploaded 1,135 new derived/receipt objects and independently re-verified all 1,135 existing raw/provenance objects as matching skips. The local working tree occupies approximately 5.2 GiB across raw, derived, and manifests.

The feed contains a small number of crossed snapshots (`ask < bid`; about 0.05% in the validation sample). They remain in immutable/derived evidence for provenance. The replay adapter must reject or quarantine them for executable fill simulation rather than silently repairing or deleting source rows.

`npm run databento:compat` builds a gzip compatibility cache for the existing TypeScript engine. It records every crossed/invalid rejection, writes atomically, and never mutates Parquet. The backtest opts into this source explicitly with `--options databento-v2`; this mode preserves the existing one-minute causal fill lag and three-minute stale-quote guard, crosses the observed spread, and fails closed on missing real-NBBO sessions. It checks coverage up front, then inflates one session at a time so multi-year studies remain memory-bounded. The legacy `--options databento` behavior remains available for controlled comparisons.

The completed compatibility build contains 3,399 underlying/session files and 195,523,086 executable snapshots (1,709,269,682 bytes compressed). It excluded 26,994 crossed snapshots, 56,971 nonpositive quotes, and 4,321,298 rows missing a required executable field. Every excluded row remains preserved in raw DBN and Parquet evidence.

The gzip compatibility cache is disposable local acceleration and can be regenerated from Parquet. R2 stores its checksum-rich conversion receipt, not the 1.6 GiB cache itself.

Post-adapter R2 verification: 2,271 objects / 5,602,693,941 bytes. The compatibility receipt was uploaded and all 2,270 pre-existing objects were independently verified as checksum-matching skips.
