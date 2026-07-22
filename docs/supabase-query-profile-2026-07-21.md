# Supabase query and error profile — 2026-07-21

Status: read-only profile complete; one worker write-path correction prepared. No schema migration,
statistics reset, data deletion or query-policy change was performed.

## Current resource picture

The Pro overview at review time showed 479 slow queries, 20/60 peak connections, 35% disk usage,
18% Disk IO, 64% memory, 7% CPU, 19,961 PostgREST requests, 3,783 Edge Function requests and 3.1%
Realtime warnings. These are mixed seven-day counters; they do not identify one current query by
themselves.

`pg_stat_statements` had not been reset since May 22, so its rankings combine legacy and current
dashboard behavior. The durable SELECT-only profile is in `scripts/sql/supabase-read-profile.sql`;
future comparisons must record `stats_reset` and use deltas rather than describing cumulative calls
as one day's load.

## Error source isolated

In the latest 100 PostgreSQL log rows, 29 of 30 errors were duplicate-key violations on
`execution_observations_pkey`; the remaining error was a statement timeout. Observation IDs are
deterministic, and a worker restart can replay a receipt before the process-local dedupe set warms.
The retry is valid but plain `INSERT` made it look like a database failure.

`insertExecutionObservation` now uses `upsert(..., { onConflict: "id", ignoreDuplicates: true })`.
This preserves append-only evidence, never updates the existing receipt, and removes the expected
duplicate from PostgreSQL's error path. It does not touch order authorization or execution timing.

## Cumulative expensive-read ranking

The dominant application-shaped statements since the May reset were:

| Shape | Calls | Mean | Interpretation |
| --- | ---: | ---: | --- |
| latest option chain by underlying | 73,043 | 325.78 ms | historical mix; current page hook is bounded to 200 rows / 60 s and pauses while hidden |
| option-quote count/read shape | 69,788 | 102.41 ms | archive/research plus legacy polling mix |
| option-quote inserts | 40,963 | 105.68 ms | capture cost, not dashboard egress |
| signal + strategist join | 31,719 | 102 ms | live feed / research mix |
| underlying-bar reads | 13,462 | 225 ms | chart/feed mix |
| event prefix search | 2,732 | 918.86 ms | legacy + Sentinel/release history; current reads are time-bounded |
| held-capture receipt reads | 2,647 | 651.79 ms | deep evidence surface; kept dormant outside OPS |
| desk-today-gaps RPC | 5,824 | 201.78 ms | operational evidence calculation |

Largest tables at review time included `option_quotes` at about 471,262 rows / 207 MB,
`events` at about 75,957 rows / 33 MB and `execution_observations` at about 11,985 rows / 20 MB.

## Tonight's decision

No index or retention mutation is justified from cumulative statistics immediately before a paper
session. The current dashboard already has the important bounded-read protections: one page-owned
market subscription, a 60-second bounded chain read, a five-minute release read, hidden-tab pause,
and OPS-only deep evidence reads. Wednesday should run unchanged while the duplicate-error fix makes
the remaining error rate easier to interpret.

After Wednesday close, rerun the SELECT-only profile and compare calls, total time and block reads
against this baseline. Optimize only a query that remains expensive in the new window; do not remove
"unused" indexes solely from cumulative advisor output.
