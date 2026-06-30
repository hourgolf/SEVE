-- 53_forensics_ledgers.sql — move the override + foul-out ledgers from local JSON
-- (data/override-ledger.json / data/foulout-ledger.json on the operator's Mac) to
-- Supabase tables. WHY: the §03 shadow scorecard accumulates over weeks, but it lived
-- only on the Mac — so the panel was Mac-dependent (it published only when the Mac
-- capture ran). Moving the ledgers to the cloud lets the ALWAYS-ON Railway worker
-- compute + publish the panel post-close (Mac-independent), and keeps ONE source of
-- truth shared between the Mac CLI day-report and the worker. The accumulation must be
-- cloud-durable (it can't be recomputed — option_quotes prune at 7d).
--
-- Each table mirrors the JSON map 1:1 (key → full record as jsonb), so the ledger I/O
-- refactor is a drop-in swap of fs for Supabase (the scorecard still aggregates in JS).
-- Writes are SERVICE-ROLE (both day-report's .env.local and the worker have it; they
-- bypass RLS); reads granted to anon+authenticated for the override-scorecard CLI / panel.

create table if not exists override_ledger (
  id           text primary key,        -- positions.id — one row per closed override-eligible trade
  report_date  date,                    -- ET trading date (windowing/inspection)
  entry        jsonb not null,          -- the full LedgerEntry (actual/ride/delta/tag/name/occ/…)
  recorded_at  timestamptz not null default now()
);
create index if not exists idx_override_ledger_date on override_ledger (report_date);

create table if not exists foulout_ledger (
  k            text primary key,        -- "<ET-date>|<slug>" channel-day key
  report_date  date,
  entry        jsonb not null,          -- the full FouloutEntry (gross/foul-aware deltas, foreclosed)
  recorded_at  timestamptz not null default now()
);
create index if not exists idx_foulout_ledger_date on foulout_ledger (report_date);

alter table override_ledger enable row level security;
alter table foulout_ledger  enable row level security;

-- service-role writes bypass RLS; both roles get SELECT (default privileges don't auto-grant
-- on this project — the 06-13 accounts-table gotcha — so the explicit grant is required).
drop policy if exists "read override_ledger" on override_ledger;
drop policy if exists "read foulout_ledger"  on foulout_ledger;
create policy "read override_ledger" on override_ledger for select to anon, authenticated using (true);
create policy "read foulout_ledger"  on foulout_ledger  for select to anon, authenticated using (true);
grant select on override_ledger to anon, authenticated;
grant select on foulout_ledger  to anon, authenticated;
