-- 27_breakout_alt_v3.sql — arm BREAK(ALT V3): BREAK(ALT) minus the momentum_atr gate.
--
-- WHY: bootstrap Monte Carlo on real SPY Databento fills (Mar–Jun 2026, 10k block-paths)
-- showed the momentum_atr ≥0.3 entry gate was PURE over-filtering — dropping it is
-- Pareto-better on every axis (not a risk-for-return trade):
--      metric              BREAK(ALT)      BREAK(ALT V3)
--      median (p50)        +$1,842         +$4,151
--      P(period < $0)      33%             20%
--      p95 max-drawdown    −$7,273         −$6,949   (smaller)
--      downside (p5)       −$5,087         −$3,627   (smaller)
--      Sharpe×√252         0.83            1.54
-- Everything else is identical (opening-range break · VWAP side · efficiency_ratio ≥0.45
-- · rel_vol ≥1.3 · 15:25 cutoff · fixed +100%/−50% bracket). rel_vol is the load-bearing
-- filter (removing IT collapses the edge); the efficiency-ratio gate is kept because the
-- MC shows it earns its keep as drawdown control.
--
-- Clones BREAK(ALT)'s live settings (RISK $500 / STOP $500 / underlying-stop / max_contracts)
-- so the two run a FAIR side-by-side A/B. Runs as a compiled-spec channel (no worker change).
-- Run this in the Supabase SQL editor. Idempotent: re-running is a no-op once armed.
--
-- ⚠ Running this ARMS V3 LIVE (paper) — it places trades next worker cycle alongside
--   BREAK(ALT). To stage it muted instead, change `false` (muted) → `true` in the config
--   insert, or set status 'draft' below, and flip it on from the Console when ready.

with new_strat as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, spec_json, created_at)
  select
    gen_random_uuid(),
    'breakout-alt-v3',
    'BREAK(ALT V3)',
    'Compiled spec — trending / momentum (V3: −momentum_atr gate, MC-validated)',
    'trending / momentum',
    null,
    'indigo',
    true,
    'armed',
    (select coalesce(max(sort_order), 0) + 1 from strategists),
    'SPY',
    '{"meta":{"name":"Breakout (Smart Entries V3)","regime":"trending / momentum","dteRange":[0,1],"direction":"directional","structure":"single-leg","instrument":"SPX","strategyId":"breakout-alt-v3","sessionWindow":"10:00-15:25 ET"},"exits":[{"note":"Take profit at +100% of premium","profitPct":100},{"note":"Stop out at -50% of premium","stopPct":50},{"note":"Flatten any open position by 15:25 ET","timeET":"15:25"}],"sizing":{"note":"Simple premium-based risk; size per account risk tolerance","riskPctOfAccount":2},"entries":[{"all":[{"kind":"opening_range","side":"break_above","minutes":30},{"kind":"vwap_side","side":"above"},{"op":">=","kind":"efficiency_ratio","value":0.45,"lookback":20},{"min":1.3,"kind":"rel_vol"},{"et":"15:25","kind":"time_before"}],"reason":"Price breaks above 30-min opening-range high with strong volume, and efficiency above VWAP","direction":"call"},{"all":[{"kind":"opening_range","side":"break_below","minutes":30},{"kind":"vwap_side","side":"below"},{"op":">=","kind":"efficiency_ratio","value":0.45,"lookback":20},{"min":1.3,"kind":"rel_vol"},{"et":"15:25","kind":"time_before"}],"reason":"Price breaks below 30-min opening-range low with strong downside volume, and efficiency below VWAP","direction":"put"}]}'::jsonb,
    now()
  where not exists (select 1 from strategists where slug = 'breakout-alt-v3')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct)
select n.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct
from new_strat n
cross join strategist_config c
where c.strategist_id = (select id from strategists where slug = 'breakout-smart-entries');

-- verify (BREAK(ALT) should have 6 entry-conditions, V3 should have 5):
select s.slug, s.name, s.status, s.accent, s.sort_order,
       jsonb_array_length(s.spec_json->'entries'->0->'all') as entry_conditions,
       c.capital_pct as risk_usd, c.daily_stop_usd as stop_usd, c.muted
from strategists s left join strategist_config c on c.strategist_id = s.id
where s.slug in ('breakout-smart-entries', 'breakout-alt-v3')
order by s.slug;
