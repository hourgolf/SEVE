-- ============================================================================
--  13_add_channel.sql   ·   run AFTER 05_console_write_policies.sql
--  Add-a-Channel persistence (phase 2). Lets a signed-in operator compile a
--  thesis → StrategySpec, backtest-gate it, and ARM it as a real desk channel.
--
--  Design (agreed): channels live on the EXISTING strategists table — colors /
--  order / status / the compiled spec become COLUMNS, so the dashboard renders
--  channels dynamically (no hardcoded COLOR_BY_SLUG / ORDER maps) and the worker
--  reads spec_json + status straight from the row.
--
--  Safe to re-run (idempotent): add-column-if-not-exists + upserts + policy
--  drop/create. Reads stay anon (04 already grants anon SELECT on strategists).
-- ============================================================================

-- ---- 1) new columns --------------------------------------------------------
alter table strategists
  add column if not exists spec_json  jsonb,            -- compiled StrategySpec (null for code channels)
  add column if not exists thesis_md  text,             -- the source thesis (for re-edit / audit)
  add column if not exists status     text not null default 'draft',  -- draft | armed | disabled
  add column if not exists accent     text,             -- UI accent token: green|blue|amber|cyan
  add column if not exists sort_order int  not null default 100;       -- display order (asc)

alter table strategists drop constraint if exists strategists_status_chk;
alter table strategists add  constraint strategists_status_chk
  check (status in ('draft', 'armed', 'disabled'));

-- ---- 2) backfill the four built-in (code) channels -------------------------
-- They are already trading via the dispatcher, so they are 'armed'. accent =
-- the PmColor token the UI uses; sort_order = the historical display order.
update strategists set status = 'armed', accent = 'green', sort_order = 0 where slug = 'fade';
update strategists set status = 'armed', accent = 'blue',  sort_order = 1 where slug = 'breakout';
update strategists set status = 'armed', accent = 'amber', sort_order = 2 where slug = 'power';
update strategists set status = 'armed', accent = 'cyan',  sort_order = 3 where slug = 'grind';

-- ---- 3) write policies: console can INSERT/UPDATE/DELETE channels -----------
-- (05 already grants authenticated UPDATE on strategist_config + fund_state.)
grant insert, update, delete on public.strategists       to authenticated;
grant insert,         delete on public.strategist_config to authenticated;

drop policy if exists auth_insert_strategists on public.strategists;
create policy auth_insert_strategists on public.strategists
  for insert to authenticated with check (true);

drop policy if exists auth_update_strategists on public.strategists;
create policy auth_update_strategists on public.strategists
  for update to authenticated using (true) with check (true);

drop policy if exists auth_delete_strategists on public.strategists;
create policy auth_delete_strategists on public.strategists
  for delete to authenticated using (true);

drop policy if exists auth_insert_strategist_config on public.strategist_config;
create policy auth_insert_strategist_config on public.strategist_config
  for insert to authenticated with check (true);

drop policy if exists auth_delete_strategist_config on public.strategist_config;
create policy auth_delete_strategist_config on public.strategist_config
  for delete to authenticated using (true);

-- Note: only single-leg, fully-runnable specs can be Armed from the UI (the
-- capability check + green backtest gate enforce this client-side). A draft
-- channel is stored but the dispatcher skips any row whose status <> 'armed'.
