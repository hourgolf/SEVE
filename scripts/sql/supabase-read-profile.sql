-- SEVE read-only Supabase/Postgres profile. Safe to run in the SQL editor.
-- This does not reset statistics, change schema, create indexes, or write rows.

select stats_reset
from pg_stat_statements_info;

select
  queryid,
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  round(max_exec_time::numeric, 2) as max_exec_ms,
  rows,
  shared_blks_read,
  shared_blks_hit,
  temp_blks_written,
  left(regexp_replace(query, '\s+', ' ', 'g'), 280) as normalized_query
from pg_stat_statements
where userid <> (select usesysid from pg_user where usename = 'supabase_admin')
order by total_exec_time desc
limit 30;

select
  relname as table_name,
  n_live_tup,
  seq_scan,
  idx_scan,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 25;

select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
order by pg_relation_size(indexrelid) desc
limit 40;
