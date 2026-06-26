-- 52_spy_control_clones.sql — the shadow-lab CONTROL (ATM · er 0.45 · flat) for clean lever A/Bs.
--
-- WHY: the Resurrected shadow clones each differ from the live Core SPY V3/ALT by MULTIPLE variables
-- (account + pyramid + their own lever), so isolating each lever's FORWARD effect was muddied. This adds a
-- clean baseline on the SAME bucket: SPY V3/ALT at ATM (strike_offset 0), er 0.45 (UNMODIFIED spec), FLAT
-- (pyramid_adds 0). Now the A/Bs are 1-variable: er-40 vs CTL = the er lever; ITM vs CTL = the strike lever.
-- spec_json copied verbatim (NO er replace — stays 0.45). RISK/max copied so sizing matches the other clones.
-- Slug -ctl is not a resolver-stripped suffix → resolves via its own spec_json. Resurrected, armed/stream. Idempotent.

-- ── BREAK(ALT V3) → control ──────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-alt-v3'),
ins as (
  insert into strategists (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-alt-v3-ctl', 'BREAK(ALT V3) · CTL', mandate, regime, color, accent, true, 'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists), 'SPY', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src where not exists (select 1 from strategists where slug = 'breakout-alt-v3-ctl')
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c where c.strategist_id = (select id from src);

-- ── BREAK(ALT) → control ─────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-smart-entries'),
ins as (
  insert into strategists (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-smart-entries-ctl', 'BREAK(ALT) · CTL', mandate, regime, color, accent, true, 'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists), 'SPY', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src where not exists (select 1 from strategists where slug = 'breakout-smart-entries-ctl')
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c where c.strategist_id = (select id from src);

select s.slug, s.name, s.status, a.name as acct, c.strike_offset, c.pyramid_adds, c.capital_pct as risk,
  (s.spec_json::text like '%0.45%') as er45, (s.spec_json::text like '%0.40%') as er40
from strategists s join strategist_config c on c.strategist_id = s.id left join accounts a on a.id = s.account_id
where s.slug in ('breakout-alt-v3-ctl','breakout-smart-entries-ctl') order by s.slug;

-- ROLLBACK: delete from strategist_config where strategist_id in (select id from strategists where slug in ('breakout-alt-v3-ctl','breakout-smart-entries-ctl'));
--           delete from strategists where slug in ('breakout-alt-v3-ctl','breakout-smart-entries-ctl');
