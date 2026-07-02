-- ============================================================================
-- 56_orb_ustop_twins.sql — ORB stop-structure A/B (phase-4 proposal A4, APPROVED 2026-07-01).
--
-- STRUCTURAL RATIONALE (orb-tightening-runway + phase-2 #2): the −50% premium stop fires on
-- theta/noise; a ~0.30% UNDERLYING-move stop fires on a real adverse move. The orb-ustop-sweep
-- (engine/orb-ustop-sweep.ts, real NBBO, faithful RISK) showed uStop0.30/prem-off beating
-- prem50 on the SAME entries. This was un-runnable until worker stream-2026-07-01c fixed the
-- premium_stop_pct=0 semantics (sizing ÷0 + sweep stop-at-entry). Forward test, paper only —
-- NO profitability claim; the backtest is modeled-options and the whole point is the live A/B.
--
-- DESIGN:
--  · Both twins carry the PROBE'S EXACT entry legs as spec_json (band 1.0 ATM, width 0.25,
--    mom ±0.3, rel_vol 1.3, →15:00, flatten 15:25) — NOT orb-spy-trail's trailed spec.
--  · orb-ustop-ctl (CONTROL): policy −50% premium stop (premium_stop_pct null), no u-stop.
--    Account paper-main.
--  · orb-ustop (VARIANT):    premium stop OFF (premium_stop_pct=0), underlying_stop_pct=0.30.
--    Account Resurrected (paper-lab).
--  · DIFFERENT accounts on purpose: identical entries → identical OCCs; on one account they'd
--    net into ONE Alpaca lot and confound the A/B (the shared-OCC isolation rule, cockpit P3).
--  · Paper-lab sizing rule (A1): RISK $500 · max_contracts 6 · daily stop $500.
--
-- PRE-REGISTERED (docs/pre-registered-tests-2026-07.md): run to N≥40 trades each.
-- KILL: variant's stop-out RATE exceeds the control's, or expectancy trails the control at
-- N≥40, or any session where the u-stop provably fails to fire on a >0.30% adverse move
-- (mechanical fault ⇒ immediate bench).
-- Rollback: update strategists set status='draft' where slug in ('orb-ustop','orb-ustop-ctl');
-- ============================================================================

insert into strategists (slug, name, mandate, regime, underlying, executor, account_id, status, is_active, spec_json)
select v.slug, v.name, v.mandate, 'trending / momentum', 'SPY', 'stream', a.id, 'armed', true, v.spec::jsonb
from (values
  ('orb-ustop-ctl', 'ORB A/B · prem-stop (ctl)',
   'Stop-structure A/B CONTROL: probe ORB legs, policy −50% premium stop. Paper only.',
   'paper-main',
   '{"meta":{"strategyId":"orb-ustop-ctl","name":"ORB A/B ctl","instrument":"SPY","structure":"single-leg","direction":"directional","dteRange":[0,1],"sessionWindow":"10:00-15:00 ET"},
     "entries":[
       {"direction":"call","reason":"orb","all":[{"kind":"opening_range","side":"break_above","minutes":30},{"kind":"or_width_min","pct":0.25},{"kind":"vwap_side","side":"above"},{"kind":"momentum_atr","op":">=","value":0.3,"lookback":5},{"kind":"rel_vol","min":1.3},{"kind":"time_before","et":"15:00"}]},
       {"direction":"put","reason":"orb","all":[{"kind":"opening_range","side":"break_below","minutes":30},{"kind":"or_width_min","pct":0.25},{"kind":"vwap_side","side":"below"},{"kind":"momentum_atr","op":"<=","value":-0.3,"lookback":5},{"kind":"rel_vol","min":1.3},{"kind":"time_before","et":"15:00"}]}],
     "exits":[{"timeET":"15:25"}]}'),
  ('orb-ustop', 'ORB A/B · u-stop 0.30',
   'Stop-structure A/B VARIANT: same probe ORB legs, premium stop OFF, 0.30% underlying stop. Paper only.',
   'Resurrected',
   '{"meta":{"strategyId":"orb-ustop","name":"ORB A/B u-stop","instrument":"SPY","structure":"single-leg","direction":"directional","dteRange":[0,1],"sessionWindow":"10:00-15:00 ET"},
     "entries":[
       {"direction":"call","reason":"orb","all":[{"kind":"opening_range","side":"break_above","minutes":30},{"kind":"or_width_min","pct":0.25},{"kind":"vwap_side","side":"above"},{"kind":"momentum_atr","op":">=","value":0.3,"lookback":5},{"kind":"rel_vol","min":1.3},{"kind":"time_before","et":"15:00"}]},
       {"direction":"put","reason":"orb","all":[{"kind":"opening_range","side":"break_below","minutes":30},{"kind":"or_width_min","pct":0.25},{"kind":"vwap_side","side":"below"},{"kind":"momentum_atr","op":"<=","value":-0.3,"lookback":5},{"kind":"rel_vol","min":1.3},{"kind":"time_before","et":"15:00"}]}],
     "exits":[{"timeET":"15:25"}]}')
) as v(slug, name, mandate, acct, spec)
join accounts a on a.name = v.acct
where not exists (select 1 from strategists s where s.slug = v.slug);

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd,
  muted, soloed, underlying_stop_pct, premium_stop_pct, take_profit_pct, event_policy, entry_dte)
select s.id, 500, 0, 6, 500, false, false,
  case s.slug when 'orb-ustop' then 0.30 else 0 end,
  case s.slug when 'orb-ustop' then 0 else null end,
  0, 'standdown', 0
from strategists s
where s.slug in ('orb-ustop', 'orb-ustop-ctl')
  and not exists (select 1 from strategist_config c where c.strategist_id = s.id);
