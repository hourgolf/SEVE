# Supabase containment, hot retention, and remote publisher plan — 2026-07-20

Status: design and read-only evidence only. No database row was deleted, no
migration was applied, no R2 or Supabase object was written, and no service was
deployed by this plan.

## Verdict

The Pro upgrade was the correct emergency buffer. A later return to Free looks
technically possible, but it should not be promised until the system proves two
things over several live sessions:

1. bounded dashboard reads keep uncached egress below the Free allowance; and
2. quote history is checksum-verified outside Postgres before a shorter hot
   window deletes anything.

Today the database is about 428.5 MB. `option_quotes` alone is about 216.9 MB,
so the storage problem is primarily an intentionally retained research tape,
not normal application state. The current seven-calendar-day retention job is
active and deletes quote rows blindly; it does not require proof that the day
was archived. That was acceptable as a temporary backstop, but it is not a
durable archive contract.

## Current exact inventory

Indexed per-day counts and Supabase Storage metadata at the close showed:

| ET day | DB quote rows | Existing `forward-data` gzip |
| --- | ---: | ---: |
| 2026-07-13 | 80,584 | 5,573,933 bytes |
| 2026-07-14 | 80,594 | 5,528,126 bytes |
| 2026-07-15 | 68,976 | 4,302,840 bytes |
| 2026-07-16 | 79,104 | 5,143,042 bytes |
| 2026-07-17 | 80,746 | 5,624,780 bytes |
| 2026-07-20 | 81,270 | **not yet present at the audit clock** |

The missing July 20 object is not yet a failure: the always-on worker waits
until 16:15 ET and checks on a 20-minute timer. It is an absolute deletion
blocker until the completed object and a trustworthy manifest are verified.

The current `seve-retention` job runs at 06:17 UTC and performs:

- `option_quotes`: delete older than 7 days;
- `events`: delete older than 30 days;
- `equity_snapshots`: delete older than 90 days;
- daily-bar aggregation and deletion of one-minute bars older than 60 days.

The quote archive currently goes to Supabase Storage rather than Cloudflare R2.
That protects against Mac sleep, but it retains the archive inside the same
vendor boundary and lacks a compact database receipt containing row count and
content hashes.

## Target architecture

### A. Bound the reads first

Ship the isolated dashboard containment branch only after authenticated preview
smoke. It uses bounded fallback queries, avoids repeated broad history reads,
and suspends deep OPS reads while OPS is not visible. This should reduce both
statement timeouts and database egress without changing capture or trading.

Measure daily uncached egress and timeout frequency for at least five full
sessions after deployment. A plan downgrade should not be based on one quiet
hour or on cache-hit rate alone.

### B. Make R2 the immutable quote archive

The next quote-archive version should reuse the existing R2 credentials and
content-addressed evidence conventions:

1. select one complete ET day using keyset pagination;
2. canonicalize the verbatim quote rows and gzip them;
3. compute uncompressed and compressed SHA-256 hashes;
4. upload an immutable R2 object whose key contains the compressed hash;
5. upload a manifest containing session date, row count, first/last quote,
   both hashes, schema version, source, and completion clock;
6. read back object/manifest metadata and verify identity;
7. insert one compact, idempotent Supabase receipt only after verification.

The receipt is research provenance, never an execution source. Missing object,
manifest, checksum, count, boundary, or read-back verification must leave the
day unarchived. Existing Supabase Storage objects remain immutable during the
transition; they are not deleted merely because an R2 writer exists.

### C. Replace blind retention with receipt-gated retention

After two consecutive sessions prove the R2 path, replace the quote portion of
the current job with a bounded procedure:

- target a **four-calendar-day hot window** initially;
- identify only complete dates older than that window;
- require a verified archive receipt for the exact date and row count;
- delete in bounded batches outside market hours;
- record the pre-delete count, deleted count, archive identity, elapsed time,
  and any timeout;
- stop on the first discrepancy rather than continuing to later dates.

Four calendar days normally retains two to three recent sessions in Postgres
while the full corpus remains in R2. At today's density, removing July 13–15
would reclaim roughly 100 MB of quote-table payload and leave materially more
room under a 500 MB database limit. This is an estimate, not a deletion
authorization or guarantee of immediate file-size shrinkage.

Do not shorten `events`, evidence receipts, or manager ledgers in the same
change. Their semantic retention requirements are different and bundling them
would make rollback and evidence review harder.

The logically empty `cron.job_run_details` relation currently occupies about
28.5 MB physically. Reclaiming it is a separate scheduled maintenance action
because operations such as truncation or table rewrite can lock system state.
It should not be performed during a trading session or combined with the quote
retention migration.

## Return-to-Free gate

Downgrade only when all of these remain green for a rolling week:

1. database size stays below 375 MB, leaving at least 25% headroom under 500 MB;
2. projected monthly uncached egress is below 4 GB, leaving headroom under 5 GB;
3. no dashboard statement timeout appears during an active session;
4. every complete quote day has a verified R2 object, manifest, and compact
   receipt before its hot rows expire;
5. research replays can resolve archived paths without querying pruned rows;
6. the retention job has no count/hash mismatch or partial deletion;
7. pre-open, order management, and risk-reducing exits do not depend on cold
   archive access.

If those gates do not hold, Pro is infrastructure cost, not waste. A forced
downgrade that recreates lag or loses research evidence would be more expensive
than the subscription.

## Remote morning publisher

The current `morning-brief` is explicitly Mac-dependent and calls local archive
utilities before publishing Sentinel. The always-on worker already runs the
post-close quote archive and forensic publisher, but the pre-open Sentinel
artifact still needs a remote owner.

Do not simply spawn the existing Mac wrapper inside the trading loop. It reads
and writes local `data/` artifacts, may invoke expensive child jobs, and could
compete with the executor for memory or database IO.

Build a separate idempotent remote publisher entry point with this contract:

- reads durable Supabase/R2 inputs with the service role;
- derives `session` and `forDate` using the market calendar in
  `America/New_York`;
- publishes at most once per target session;
- treats IV/dealer refresh as separately classified optional evidence;
- emits a durable start/finish/error receipt with input freshness and exact
  target identity;
- times out independently and has no imports from order placement;
- fails yellow/red on stale or conflicting Sentinel evidence even when the
  worker is healthy.

The preferred deployment is a separate Railway cron/service built from the
same commit, not the executor process. Because Railway cron schedules use UTC,
run both DST candidate clocks on weekdays and have the script self-gate to a
narrow 08:55–09:10 ET window. Idempotency prevents a double publish. A separate
service also makes its CPU, memory, logs, and retries observable without
jeopardizing heartbeat or exits.

## Safe implementation order

1. merge and measure dashboard read containment;
2. verify the July 20 existing archive after its post-close gate;
3. implement R2 quote object + manifest + compact receipt locally with
   adversarial tests;
4. review the migration and worker diff separately;
5. deploy the archive path while retaining seven days of hot quotes;
6. prove two sessions and cold-read parity;
7. separately authorize receipt-gated four-day retention;
8. implement and deploy the isolated remote morning publisher;
9. observe a full week before considering a Supabase downgrade.

No step authorizes a strategy change, order, migration, data deletion, R2 write,
merge, or deployment without its own review boundary.
