-- 51_pb_itm_clone.sql — ITM-PB shadow clone (theta-justified, from theta-v2).
--
-- WHY: theta-v2 named PB RIDER 1DTE the desk's costliest theta exposure (≈−$29k of decay over 226-min holds;
-- ~25% clean / up to ~46% raw of gross). PB is a no-tail take-profit RIDE (giveback-prone — like V3/ALT, NOT a
-- convex-tail ride like MOMO), so ITM (less extrinsic to bleed) should buy back its decay AND add delta the way it
-- does for V3/ALT [[strike-moneyness-finding]] [[theta-attribution]]. This shadow A/Bs ITM-PB vs the live ATM
-- pb-ride in the SAME Resurrected bucket. pb-ride is a REGISTRY BUILTIN (engine/strategies/pullback.ts, spec_json
-- NULL) → it resolves via the worker base-slug strip, which now strips -itm (worker stream-2026-06-25c: pb-ride-itm
-- → pb-ride builtin) and then applies strike_offset at the entry pick.
--
-- WHAT (overrides vs src pb-ride): slug/name (-itm) · strike_offset = −1 (ITM1) · pyramid_adds 0 (flat — isolate
-- the strike). entry_dte (=1, 1DTE), event_policy, stall-exit knobs, RISK/max_contracts all COPIED so the A/B
-- isolates ONLY the strike. Idempotent. Resurrected creds (ALPACA_KEY_3) live.

with src as (select * from strategists where slug = 'pb-ride'),
ins as (
  insert into strategists (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'pb-ride-itm', 'PB RIDER 1DTE · ITM', mandate, regime, color, accent, true, 'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists), underlying, account_id, 'stream', spec_json, now()
  from src where not exists (select 1 from strategists where slug = 'pb-ride-itm')
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, -1
from ins cross join strategist_config c where c.strategist_id = (select id from src);

select s.slug, s.name, s.status, a.name as acct, s.underlying, (s.spec_json is null) as builtin,
  c.strike_offset, c.entry_dte, c.pyramid_adds, c.capital_pct as risk, c.max_contracts, c.stall_minutes
from strategists s join strategist_config c on c.strategist_id = s.id left join accounts a on a.id = s.account_id
where s.slug = 'pb-ride-itm';

-- ROLLBACK: delete from strategist_config where strategist_id in (select id from strategists where slug='pb-ride-itm');
--           delete from strategists where slug='pb-ride-itm';
