-- 36_accounts_foundation.sql — multi-account cockpit, Phase 1 (ADDITIVE / back-compat).
-- The desk goes from one implicit account (the singleton fund_state + a flat strategists
-- list) to N accounts. This migration is PURELY ADDITIVE: a new `accounts` table + a
-- nullable `account_id` on strategists, with every existing channel migrated to a default
-- 'paper-main' account. The worker/cron select NAMED columns, so they never see account_id
-- and behave IDENTICALLY — zero trading-path impact. fund_state stays the live master for
-- now (absorbed into accounts in a later phase). Reversible: drop the column + the table.
-- See docs/multi-account-cockpit-design.md.

create table if not exists accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,        -- 'paper-main', 'live-$', 'paper-lab'
  broker                text not null default 'alpaca',
  mode                  text not null default 'paper',  -- 'paper' | 'live' (structural broker target)
  is_active             boolean not null default true,  -- soft-retire
  is_armed              boolean not null default false, -- per-account live turn (paper ignores)
  is_halted             boolean not null default false, -- per-account kill
  total_capital_usd     numeric,
  master_daily_stop_usd numeric,
  accent                text default 'green',           -- chrome (live-$ → red)
  sort_order            int default 0,
  cred_ref              text,                           -- pointer to the secret store, NOT the secret
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create trigger trg_accounts_updated before update on accounts
  for each row execute function set_updated_at();

-- Seed the default account from today's fund_state (idempotent).
insert into accounts (name, mode, total_capital_usd, master_daily_stop_usd, is_armed, sort_order, accent)
select 'paper-main', coalesce(f.mode, 'paper'), f.total_capital_usd, f.master_daily_stop_usd, true, 0, 'green'
from fund_state f
where f.id = 1
  and not exists (select 1 from accounts where name = 'paper-main');

-- Channels gain an account; default everyone to paper-main.
alter table strategists add column if not exists account_id uuid references accounts(id);
update strategists
   set account_id = (select id from accounts where name = 'paper-main' limit 1)
 where account_id is null;

-- RLS: anon reads the account list (dashboard); the operator (authenticated) can tune knobs.
alter table accounts enable row level security;
drop policy if exists accounts_anon_read on accounts;
create policy accounts_anon_read on accounts for select to anon using (true);
drop policy if exists accounts_auth_write on accounts;
create policy accounts_auth_write on accounts for all to authenticated using (true) with check (true);

-- ⚠ table-level GRANTs — this project's default privileges do NOT auto-grant SELECT to anon,
-- so the RLS policy above is moot without these (the dashboard read returns empty otherwise).
grant select on accounts to anon;
grant select, insert, update, delete on accounts to authenticated;
