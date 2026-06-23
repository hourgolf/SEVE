-- ============================================================================
-- 40_equity_snapshots_account.sql — cockpit P3: per-bucket forward NAV
--
-- Tag equity snapshots with the Alpaca paper account (bucket) they belong to so
-- each bucket's forward NAV reads cleanly. The worker writes:
--   · one row per account  (strategist_id NULL, account_id = the bucket)
--   · one desk-TOTAL row    (strategist_id NULL, account_id NULL = sum across buckets)
-- The existing dashboard reads (useDeskFeed / useWindowedPnl / useOpsStatus) now
-- filter `account_id IS NULL` → they keep reading the desk total, unchanged.
--
-- Additive + nullable: every existing row stays account_id NULL (= desk total),
-- so this is safe to apply before the worker deploy. ON DELETE SET NULL keeps a
-- snapshot history even if a bucket account row is ever removed.
-- ============================================================================

alter table public.equity_snapshots
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create index if not exists idx_equity_snapshots_account
  on public.equity_snapshots (account_id, captured_at desc);

-- Realtime: the worker subscribes to `accounts` so an is_armed flip / reassignment
-- propagates in <1s (else the 30s poll fallback covers it). Idempotent add.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'accounts'
  ) then
    alter publication supabase_realtime add table public.accounts;
  end if;
end $$;
