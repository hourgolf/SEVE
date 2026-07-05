-- 63: cross-index vb fleet — clone the 10 SPY vb-* virtual-bench drafts onto QQQ + IWM.
-- The cross-index verdict says the desk's edge is broad-market and stronger off-SPY
-- (IWM/QQQ), but the mechanism-diversity fleet (A8) mines SPY only. These clones triple
-- the signal-only substrate accruing toward the ≥2-month mining pass. DRAFTS: they
-- signal + replay into virtual_trades, never trade. option_quotes coverage confirmed
-- live for all three underlyings (SPY/QQQ 107k rows, IWM 48k). A8 rules extend as-is:
-- per-variant inert-kill (<10 first-of-day signals after 30 sessions), no arm from
-- virtual data, clocks start at each clone's first session (2026-07-06).

insert into strategists (slug, name, status, underlying, executor, account_id, spec_json, mandate, regime, color, accent, sort_order, is_active)
select s.slug || sfx.suffix,
       s.name || sfx.label,
       'draft', sfx.underlying, s.executor, s.account_id, s.spec_json, s.mandate, s.regime, s.color, s.accent, s.sort_order, s.is_active
from strategists s
cross join (values ('-qqq', ' (QQQ)', 'QQQ'), ('-iwm', ' (IWM)', 'IWM')) as sfx(suffix, label, underlying)
where s.slug like 'vb-%' and s.slug not like '%-qqq' and s.slug not like '%-iwm'
on conflict (slug) do nothing;

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd,
  underlying_stop_pct, event_policy, entry_dte, take_profit_pct, pyramid_adds, stall_minutes,
  stall_max_favor_pct, strike_offset, premium_stop_pct, muted, soloed, boosted, gap_min)
select n.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd,
  c.underlying_stop_pct, c.event_policy, c.entry_dte, c.take_profit_pct, c.pyramid_adds, c.stall_minutes,
  c.stall_max_favor_pct, c.strike_offset, c.premium_stop_pct, c.muted, c.soloed, c.boosted, c.gap_min
from strategists n
join strategists o on o.slug = left(n.slug, length(n.slug) - 4)
join strategist_config c on c.strategist_id = o.id
where n.slug like 'vb-%' and (n.slug like '%-qqq' or n.slug like '%-iwm')
  and not exists (select 1 from strategist_config x where x.strategist_id = n.id);
