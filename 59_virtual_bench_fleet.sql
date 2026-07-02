-- ============================================================================
-- 59_virtual_bench_fleet.sql — the VIRTUAL BENCH fleet (approved 2026-07-01).
--
-- Ten mechanism-diverse DRAFT channels that NEVER trade: a draft on an armed bucket
-- still DECIDES every bar and writes a `not_armed` signal row with full entry context
-- (decide.ts → executeEntry insertSignal). The nightly gate-shadow job reconstructs
-- each first-signal-of-day's would-have outcome (entry ask → its own TP/stop → 15:25
-- flatten) from the option_quotes tape before the 7d prune → `virtual_trades` → the
-- §03 LAB panel. Zero orders, zero P&L, zero shared-OCC pollution.
--
-- ⚠ RULES (docs/pre-registered-tests-2026-07.md, "virtual fleet"): virtual data is
-- CAPITAL-BLIND and mid/ask-basis — it can inform HYPOTHESES, never an arm. Graduation
-- path: virtual → paper-lab at A1 sizing (RISK ≤$500) → a pre-registered gate. The
-- mining pass over this data waits for ~2 months of accrual or a regime change (the
-- June lesson: one month of one regime produced sign-flipping levers, twice).
-- Mechanism spread (deliberately NOT knob-permutations of one idea):
--   revert: vwap-stretch fade · rsi/stale exhaustion · OR-edge rejection
--   structure: pdh/pdl break · compressed-range break
--   indicator: MACD-state momentum · EMA ribbon cross · afternoon trend-align
--   candle/other: stale-extreme curl reversal · gap-day VWAP drift
-- All paper. No profitability claim anywhere in this file.
-- Rollback: delete from strategists where slug like 'vb-%';
-- ============================================================================

with fleet(slug, name, mandate, tp, spec) as (values
  ('vb-vwap-revert', 'VB · VWAP revert', 'VIRTUAL BENCH (never trades): fade a >=2-ATR VWAP stretch back toward VWAP. Mean-reversion mechanism.', 15,
   '{"meta":{"strategyId":"vb-vwap-revert","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"put","reason":"vwap_stretch","all":[{"kind":"vwap_dev","atr":2,"cmp":">"},{"kind":"time_between","startET":"10:00","endET":"14:45"}]},
     {"direction":"call","reason":"vwap_stretch","all":[{"kind":"vwap_dev","atr":2,"cmp":"<"},{"kind":"time_between","startET":"10:00","endET":"14:45"}]}]}'),
  ('vb-rsi-revert', 'VB · RSI exhaustion', 'VIRTUAL BENCH: fade RSI(14) extremes once the session extreme has gone stale. Exhaustion-reversion mechanism.', 15,
   '{"meta":{"strategyId":"vb-rsi-revert","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"put","reason":"rsi_high","all":[{"kind":"rsi","period":14,"cmp":">","value":72},{"kind":"stale_extreme","dir":"up","sinceMin":6},{"kind":"time_between","startET":"10:00","endET":"14:45"}]},
     {"direction":"call","reason":"rsi_low","all":[{"kind":"rsi","period":14,"cmp":"<","value":28},{"kind":"stale_extreme","dir":"down","sinceMin":6},{"kind":"time_between","startET":"10:00","endET":"14:45"}]}]}'),
  ('vb-level-break', 'VB · PDH/PDL break', 'VIRTUAL BENCH: prior-day high/low breakout with volume + momentum. Structure-level mechanism (not OR-anchored).', 25,
   '{"meta":{"strategyId":"vb-level-break","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"pdh_break","all":[{"kind":"level","ref":"pdh","cmp":">"},{"kind":"rel_vol","min":1.3},{"kind":"momentum_atr","op":">=","value":0.3,"lookback":5},{"kind":"time_before","et":"15:00"}]},
     {"direction":"put","reason":"pdl_break","all":[{"kind":"level","ref":"pdl","cmp":"<"},{"kind":"rel_vol","min":1.3},{"kind":"momentum_atr","op":"<=","value":-0.3,"lookback":5},{"kind":"time_before","et":"15:00"}]}]}'),
  ('vb-or-fail', 'VB · OR rejection', 'VIRTUAL BENCH: engulfing rejection at the opening-range edge — fade the failed break. Reversal-at-structure mechanism.', 15,
   '{"meta":{"strategyId":"vb-or-fail","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"put","reason":"orhi_reject","all":[{"kind":"level","ref":"orb_hi","cmp":"near","withinPct":0.05},{"kind":"engulfing","dir":"down"},{"kind":"time_between","startET":"10:00","endET":"14:00"}]},
     {"direction":"call","reason":"orlo_reject","all":[{"kind":"level","ref":"orb_lo","cmp":"near","withinPct":0.05},{"kind":"engulfing","dir":"up"},{"kind":"time_between","startET":"10:00","endET":"14:00"}]}]}'),
  ('vb-macd-state', 'VB · MACD state', 'VIRTUAL BENCH: MACD state-alignment + strong trend bar + volume. Indicator-momentum mechanism.', 25,
   '{"meta":{"strategyId":"vb-macd-state","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"macd_bull","all":[{"kind":"macd","fast":12,"slow":26,"signal":9,"cmp":"bull","mode":"state"},{"kind":"strong_trend","dir":"up"},{"kind":"rel_vol","min":1.2},{"kind":"time_before","et":"15:00"}]},
     {"direction":"put","reason":"macd_bear","all":[{"kind":"macd","fast":12,"slow":26,"signal":9,"cmp":"bear","mode":"state"},{"kind":"strong_trend","dir":"down"},{"kind":"rel_vol","min":1.2},{"kind":"time_before","et":"15:00"}]}]}'),
  ('vb-curl-reversal', 'VB · stale curl', 'VIRTUAL BENCH: N-bar curl off a stale session extreme. Candle-geometry reversal mechanism.', 20,
   '{"meta":{"strategyId":"vb-curl-reversal","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"curl_up","all":[{"kind":"stale_extreme","dir":"down","sinceMin":8},{"kind":"curl","dir":"up","bars":7},{"kind":"time_between","startET":"10:00","endET":"14:45"}]},
     {"direction":"put","reason":"rollover","all":[{"kind":"stale_extreme","dir":"up","sinceMin":8},{"kind":"curl","dir":"down","bars":7},{"kind":"time_between","startET":"10:00","endET":"14:45"}]}]}'),
  ('vb-squeeze-break', 'VB · squeeze break', 'VIRTUAL BENCH: break of a compressed rolling 10-bar range (NOT the opening range) with volume. Compression mechanism.', 25,
   '{"meta":{"strategyId":"vb-squeeze-break","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"squeeze_up","all":[{"kind":"range_break","dir":"up","bars":10,"maxWidthPct":0.0035},{"kind":"rel_vol","min":1.2},{"kind":"time_between","startET":"10:30","endET":"15:00"}]},
     {"direction":"put","reason":"squeeze_dn","all":[{"kind":"range_break","dir":"down","bars":10,"maxWidthPct":0.0035},{"kind":"rel_vol","min":1.2},{"kind":"time_between","startET":"10:30","endET":"15:00"}]}]}'),
  ('vb-pm-trend', 'VB · PM trend-align', 'VIRTUAL BENCH: afternoon continuation — EMA ribbon aligned + momentum, 13:00-15:00 only. Time-of-day axis, deliberately.', 25,
   '{"meta":{"strategyId":"vb-pm-trend","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"pm_up","all":[{"kind":"time_between","startET":"13:00","endET":"15:00"},{"kind":"trend_align","side":"up"},{"kind":"momentum_atr","op":">=","value":0.4,"lookback":5}]},
     {"direction":"put","reason":"pm_dn","all":[{"kind":"time_between","startET":"13:00","endET":"15:00"},{"kind":"trend_align","side":"down"},{"kind":"momentum_atr","op":"<=","value":-0.4,"lookback":5}]}]}'),
  ('vb-gap-drift', 'VB · gap-day drift', 'VIRTUAL BENCH: gap-day early VWAP-side momentum (first 90 min). Gap-catalyst mechanism at a different window than V3.', 25,
   '{"meta":{"strategyId":"vb-gap-drift","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"gap_up_drift","all":[{"kind":"gap_min","pct":0.35},{"kind":"vwap_side","side":"above"},{"kind":"momentum_atr","op":">=","value":0.3,"lookback":5},{"kind":"time_before","et":"11:00"}]},
     {"direction":"put","reason":"gap_dn_drift","all":[{"kind":"gap_min","pct":0.35},{"kind":"vwap_side","side":"below"},{"kind":"momentum_atr","op":"<=","value":-0.3,"lookback":5},{"kind":"time_before","et":"11:00"}]}]}'),
  ('vb-ribbon-cross', 'VB · ribbon cross', 'VIRTUAL BENCH: EMA9/21 cross event + volume. Indicator-cross mechanism (the crossover lineage at 1m, watched not traded).', 25,
   '{"meta":{"strategyId":"vb-ribbon-cross","instrument":"SPY","structure":"single-leg","direction":"directional"},"exits":[{"timeET":"15:25"}],"entries":[
     {"direction":"call","reason":"x_up","all":[{"kind":"ma_cross","fast":9,"slow":21,"dir":"up"},{"kind":"rel_vol","min":1.2},{"kind":"time_before","et":"14:00"}]},
     {"direction":"put","reason":"x_dn","all":[{"kind":"ma_cross","fast":9,"slow":21,"dir":"down"},{"kind":"rel_vol","min":1.2},{"kind":"time_before","et":"14:00"}]}]}')
),
ins as (
  insert into strategists (slug, name, mandate, regime, underlying, executor, account_id, status, is_active, spec_json)
  select f.slug, f.name, f.mandate, 'virtual bench (never trades)', 'SPY', 'stream', a.id, 'draft', true, f.spec::jsonb
  from fleet f
  join accounts a on a.name = 'Resurrected'
  where not exists (select 1 from strategists s where s.slug = f.slug)
  returning id, slug
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd,
  muted, soloed, underlying_stop_pct, premium_stop_pct, take_profit_pct, event_policy, entry_dte)
select i.id, 350, 0, 6, 350, false, false, 0, 30, f.tp, 'standdown', 0
from ins i join fleet f on f.slug = i.slug;
