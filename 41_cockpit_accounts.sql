-- ============================================================================
-- 41_cockpit_accounts.sql — cockpit P3: the 3 hypothesis-bucket accounts
--
-- RUN WHILE THE DESK IS FLAT (post-close / pre-open) — like every prior executor
-- migration. A reassigned channel's OPEN position lives in its OLD account; moving
-- account_id while a position is open would make the new account read flat and
-- RECONCILE-close the desk row. Flat = nothing to strand.
--
-- SHADOW-FIRST: accounts 2 & 3 are created is_armed=FALSE → the worker fully decides
-- + logs their channels but places NO orders, until you flip is_armed=true (step 4
-- of the rollout). Account 1 (paper-main, the existing bleeders bucket) keeps trading
-- live throughout.
--
-- Buckets:  acct1 paper-main = BLEEDERS  ·  acct2 Core  ·  acct3 Resurrected
-- Risk:     accts 2 & 3 get a flat 4× on RISK $/trade + daily-stop + max-contracts.
-- cred_ref: '2' → env ALPACA_KEY_2/SECRET_2 · '3' → ALPACA_KEY_3/SECRET_3 (Railway).
-- total_capital_usd is left 0 here (display-only; the worker sizes by RISK $, not
-- balance) — it gets corrected from the first per-account equity snapshot.
-- ============================================================================

-- 1. Two bigger-balance accounts, SHADOW (is_armed=false). Guarded so re-running is a no-op.
insert into public.accounts (name, broker, mode, is_active, is_armed, is_halted, total_capital_usd, master_daily_stop_usd, accent, sort_order, cred_ref)
select 'Core', 'alpaca', 'paper', true, false, false, 0, 2000, 'blue', 1, '2'
where not exists (select 1 from public.accounts where cred_ref = '2');

insert into public.accounts (name, broker, mode, is_active, is_armed, is_halted, total_capital_usd, master_daily_stop_usd, accent, sort_order, cred_ref)
select 'Resurrected', 'alpaca', 'paper', true, false, false, 0, 2000, 'amber', 2, '3'
where not exists (select 1 from public.accounts where cred_ref = '3');

-- 2. Route channels to buckets (everything not listed stays on paper-main = bleeders).
update public.strategists set account_id = (select id from public.accounts where cred_ref = '2')
  where slug in ('breakout-alt-v3','breakout-smart-entries','orb-qqq-trail');               -- Core (acct 2)
update public.strategists set account_id = (select id from public.accounts where cred_ref = '3')
  where slug in ('momo-shape','pb-ride','pb-ride-2');                                        -- Resurrected (acct 3)

-- 3. 4× risk on the bigger accounts (EXPLICIT values = idempotent; current = 500/500 + caps).
--    RISK $2000 → base lot ~13 contracts at a $3 ask. V3/ALT max_contracts = 24 (operator's call:
--    the pyramid stack cap, validated at cap12, set to 24 "for now" — 2× not the full 4×).
update public.strategist_config c set capital_pct = 2000, daily_stop_usd = 2000, max_contracts = 24
  from public.strategists s where c.strategist_id = s.id and s.slug in ('breakout-alt-v3','breakout-smart-entries');
update public.strategist_config c set capital_pct = 2000, daily_stop_usd = 2000, max_contracts = 16
  from public.strategists s where c.strategist_id = s.id and s.slug = 'orb-qqq-trail';
update public.strategist_config c set capital_pct = 2000, daily_stop_usd = 2000, max_contracts = 24
  from public.strategists s where c.strategist_id = s.id and s.slug = 'momo-shape';
update public.strategist_config c set capital_pct = 2000, daily_stop_usd = 2000, max_contracts = 16
  from public.strategists s where c.strategist_id = s.id and s.slug in ('pb-ride','pb-ride-2');

-- 4. (LATER, on your word) ARM the buckets once shadow routing is verified:
--    update public.accounts set is_armed = true where cred_ref in ('2','3');
-- ROLLBACK everything:
--    update public.strategists set account_id = (select id from public.accounts where cred_ref is null);
--    update public.accounts set is_armed = false where cred_ref in ('2','3');
--    (then restore the 500/500 + original caps on the 6 channels if desired)
