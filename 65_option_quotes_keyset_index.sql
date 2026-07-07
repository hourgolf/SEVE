-- 65 · option_quotes keyset index — kills the statement-timeout under capture-window load
-- (2026-07-06, APPLIED to prod via Supabase MCP the same evening; this file is the paper trail.)
--
-- The engine's same-week real-NBBO loader (engine/optionsource.ts loadOptionQuotesByDay) and
-- the nightly export keyset-paginate:
--   where expiration = $1 and underlying = $2 [and id > $lastId] order by id limit 1000
-- No index served that shape — the planner walked option_quotes_pkey (id order) and FILTERED
-- each row on (expiration, underlying): page 1 = 2,368 ms discarding 12k rows, and every later
-- page walks deeper into the ~343k-row table → statement timeouts whenever the free-tier box
-- had concurrent load. That was the trigger of the −144.96/−487.31 two-state backtest flicker
-- (the silent Black-Scholes degrade is fixed engine-side in a5c5726; this closes the DB side).
-- Bloat ruled out first: 0 dead tuples, autovacuum current.
--
-- After: pure Index Cond scan, 3.0 ms for the same page (~780×). Index size 13 MB (cap-friendly;
-- prunes with the 7d retention like the table). Existing idx_oq_chain/(underlying,expiration,
-- captured_at) stays — it serves the dashboard's captured_at-ordered reads, not the id keyset.
--
-- Run in the Supabase SQL editor (already applied; safe to re-run):
create index concurrently if not exists idx_oq_keyset
  on option_quotes (expiration, underlying, id);
