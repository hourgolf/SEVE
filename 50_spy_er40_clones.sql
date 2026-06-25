-- 50_spy_er40_clones.sql — SPY V3/ALT er-0.40 entry-COURAGE paper-lab clones (the courage forward test).
--
-- WHY: courage-probe + the ultracode courage-midday-analysis verdict [[courage-midday-verdict]] — the
-- efficiency_ratio gate (live 0.45) is TOO TIGHT *on SPY* (where V3/ALT are the marginal +$4.7/t edge with
-- slack to recover). Loosening to 0.40 ~doubles at-bats AND lifts expectancy (V3 +6.7→+51.5/t, ALT
-- +2.4→+55.1/t; drop-best survives both regimes; plateau .40–.35). SPY-ONLY: er-loosening INVERTS on IWM
-- (monotonic harm) and is saturated on QQQ V3 → those are deliberately NOT cloned. gap_min + rel_vol stay tight.
--
-- WHAT: clone breakout-alt-v3 + breakout-smart-entries with er 0.45→0.40 in spec_json. replace('0.45','0.40')
-- hits exactly the 2 efficiency_ratio values (call+put); verified no other 0.45 in either spec (gap 0.25 /
-- mom 0.3 / relVol 1.3). Held FLAT (pyramid_adds=0) + ATM (strike_offset=0) to ISOLATE the er variable — a
-- clean A/B of the entry gate vs the er-0.45 live twins on Core. Resurrected paper-lab, armed/stream. Idempotent.

-- ── BREAK(ALT V3) → SPY er40 ─────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-alt-v3'),
ins as (
  insert into strategists (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-alt-v3-er40', 'BREAK(ALT V3) · er40', mandate, regime, color, accent, true, 'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists), 'SPY', (select id from accounts where name = 'Resurrected'), 'stream',
    replace(spec_json::text, '0.45', '0.40')::jsonb, now()
  from src where not exists (select 1 from strategists where slug = 'breakout-alt-v3-er40')
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c where c.strategist_id = (select id from src);

-- ── BREAK(ALT) → SPY er40 ────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-smart-entries'),
ins as (
  insert into strategists (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-smart-entries-er40', 'BREAK(ALT) · er40', mandate, regime, color, accent, true, 'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists), 'SPY', (select id from accounts where name = 'Resurrected'), 'stream',
    replace(spec_json::text, '0.45', '0.40')::jsonb, now()
  from src where not exists (select 1 from strategists where slug = 'breakout-smart-entries-er40')
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c where c.strategist_id = (select id from src);

-- ── verify (has_er40 true + still_has_er45 false confirms the replace) ─────────────────────────
select s.slug, s.name, s.status, a.name as acct, c.strike_offset, c.pyramid_adds, c.capital_pct as risk, c.max_contracts,
  (s.spec_json::text like '%0.40%') as has_er40, (s.spec_json::text like '%0.45%') as still_has_er45
from strategists s join strategist_config c on c.strategist_id = s.id left join accounts a on a.id = s.account_id
where s.slug in ('breakout-alt-v3-er40', 'breakout-smart-entries-er40') order by s.slug;

-- ROLLBACK: delete from strategist_config where strategist_id in (select id from strategists where slug in ('breakout-alt-v3-er40','breakout-smart-entries-er40'));
--           delete from strategists where slug in ('breakout-alt-v3-er40','breakout-smart-entries-er40');
