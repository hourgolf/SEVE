-- 48_spy_itm_clones.sql — SPY ITM1 paper-lab clones of V3/ALT (the strike-moneyness forward test).
--
-- WHY: the strike-isolation/decomp probes showed (faithfully — lever-shared CH carries the live +100%
-- cap + −50% stop) that ONE strike ITM is a large, 5/5-window, drop-best-surviving lift on the momentum
-- book (BREAK ALT +$2.4→+$108.8/t same trades; V3 +$6.7→+$120.1/t) — mostly delta capture, plus the
-- −50% stop becomes sane at ITM. This stages the LIVE forward test as a clean A/B: live SPY V3/ALT stay
-- ATM (Core), these clones run the IDENTICAL spec one strike ITM (strike_offset=−1) on a SEPARATE bucket
-- (Resurrected) so the ATM-vs-ITM divergence is bucket-clean.
--
-- WHAT (overrides vs the SPY source): slug/name (-itm) · account = Resurrected (isolation) · status =
-- armed (SPY is a proven symbol → no shadow gate) · strike_offset = −1 (ITM1) · pyramid_adds = 0 (FLAT —
-- the strike finding was tested flat; ITM+pyramid is a separate untested combo) · premium_stop_pct left
-- NULL = keep the −50% stop (the decomp showed it's GOOD at ITM). spec_json (entries + +100% cap +
-- −50% stop + 15:25 flatten) copied verbatim → the clone faithfully = the tested ITM config.
-- Idempotent. Resurrected creds (ALPACA_KEY_3) are live (reconcile reached it).

-- ── BREAK(ALT V3) → SPY ITM1 ─────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-alt-v3'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-alt-v3-itm', 'BREAK(ALT V3) · ITM',
         mandate, regime, color, accent, true, 'armed',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'SPY', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-alt-v3-itm')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, -1
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── BREAK(ALT) → SPY ITM1 ────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-smart-entries'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-smart-entries-itm', 'BREAK(ALT) · ITM',
         mandate, regime, color, accent, true, 'armed',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'SPY', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-smart-entries-itm')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, -1
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── verify ───────────────────────────────────────────────────────────────────────────────────
select s.slug, s.name, s.status, s.underlying, a.name as account, c.strike_offset, c.premium_stop_pct,
       c.capital_pct as risk_usd, c.max_contracts, c.pyramid_adds
from strategists s left join strategist_config c on c.strategist_id = s.id left join accounts a on a.id = s.account_id
where s.slug in ('breakout-alt-v3-itm', 'breakout-smart-entries-itm') order by s.slug;

-- ROLLBACK: delete from strategist_config where strategist_id in (select id from strategists where slug like '%-itm');
--           delete from strategists where slug like '%-itm';
