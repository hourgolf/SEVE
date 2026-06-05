-- ============================================================================
--  21_v2_trail_channels.sql · "v2" trailed momentum channels (ARMABLE TRAIL)
--  Two compiled channels that run a SELECTIVE AM ORB-momentum entry + a live
--  ATR-chandelier trail (worker 2026-06-04e). On real H1-2026 fills they BEAT
--  their base breakout code channels: SPY +$455 net (+$12.64/trade, vs code
--  -$9,853) · QQQ -$1,439 (vs code -$4,936), DD halved. Created as DRAFT — arm
--  next week to A/B live vs the base `breakout` / `breakout-qqq` channels.
--  Slugs end in -trail (NOT -spy/-qqq) so the worker uses the spec, not the code.
--  PREREQ: paste worker 2026-06-04e first (it executes the trail).
-- ============================================================================

insert into strategists (slug, underlying, name, mandate, regime, color, accent, status, sort_order, spec_json)
values
 ('orb-spy-trail','SPY','Breakout · SPY (trailed v2)','Momentum — selective AM opening-range break, ATR-chandelier trail.','trending / momentum','blue','blue','draft',20,'{"meta":{"name":"Breakout \u00b7 SPY (trailed v2)","regime":"trending / momentum","dteRange":[0,1],"direction":"directional","structure":"single-leg","instrument":"SPY","strategyId":"orb-spy-trail","sessionWindow":"09:45-15:00 ET"},"exits":[{"timeET":"15:30","profitPct":500}],"sizing":{"note":"Risk 1% of account per trade (standard conservative sizing for 0DTE directional plays)","riskPctOfAccount":1},"entries":[{"all":[{"kind":"opening_range","side":"break_above","minutes":30},{"kind":"or_width_min","pct":0.5},{"kind":"vwap_side","side":"above"},{"kind":"momentum_atr","op":">=","value":0.6,"lookback":5},{"kind":"rel_vol","min":1.8},{"kind":"time_before","et":"11:30"}],"direction":"call","reason":"orb"},{"all":[{"kind":"opening_range","side":"break_below","minutes":30},{"kind":"or_width_min","pct":0.5},{"kind":"vwap_side","side":"below"},{"kind":"momentum_atr","op":"<=","value":-0.6,"lookback":5},{"kind":"rel_vol","min":1.8},{"kind":"time_before","et":"11:30"}],"direction":"put","reason":"orb"}],"management":{"risk":{"defineR":"premium_stop","premiumStopPct":50},"trail":{"mode":"atr_chandelier","atrChandelier":{"baseK":1.5,"kMin":0.6,"rTighten":0.2,"timeTighten":0.5}},"eodFlattenMinToClose":30}}'::jsonb),
 ('orb-qqq-trail','QQQ','Breakout · QQQ (trailed v2)','Momentum — selective AM opening-range break, ATR-chandelier trail.','trending / momentum','blue','blue','draft',21,'{"meta":{"name":"Breakout \u00b7 QQQ (trailed v2)","regime":"trending / momentum","dteRange":[0,1],"direction":"directional","structure":"single-leg","instrument":"QQQ","strategyId":"orb-qqq-trail","sessionWindow":"09:45-15:00 ET"},"exits":[{"timeET":"15:30","profitPct":500}],"sizing":{"note":"Risk 1% of account per trade (standard conservative sizing for 0DTE directional plays)","riskPctOfAccount":1},"entries":[{"all":[{"kind":"opening_range","side":"break_above","minutes":30},{"kind":"or_width_min","pct":0.5},{"kind":"vwap_side","side":"above"},{"kind":"momentum_atr","op":">=","value":0.6,"lookback":5},{"kind":"rel_vol","min":1.8},{"kind":"time_before","et":"11:30"}],"direction":"call","reason":"R5-amstrict-nostop"},{"all":[{"kind":"opening_range","side":"break_below","minutes":30},{"kind":"or_width_min","pct":0.5},{"kind":"vwap_side","side":"below"},{"kind":"momentum_atr","op":"<=","value":-0.6,"lookback":5},{"kind":"rel_vol","min":1.8},{"kind":"time_before","et":"11:30"}],"direction":"put","reason":"R5-amstrict-nostop"}],"management":{"risk":{"defineR":"premium_stop","premiumStopPct":50},"trail":{"mode":"atr_chandelier","atrChandelier":{"baseK":1.5,"kMin":0.6,"rTighten":0.2,"timeTighten":0.5}},"eodFlattenMinToClose":30}}'::jsonb)
on conflict (slug) do update set spec_json = excluded.spec_json, underlying = excluded.underlying;

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed)
select q.id, 200, 0, 6, 300, false, false
from strategists q where q.slug in ('orb-spy-trail','orb-qqq-trail')
on conflict (strategist_id) do nothing;

-- verify: select slug, underlying, status, spec_json->'management'->'trail'->>'mode' as trail
--   from strategists where slug like 'orb-%-trail';
-- ARM next week:  update strategists set status='armed' where slug in ('orb-spy-trail','orb-qqq-trail');
