-- ============================================================================
--  28_manual_exit_twins.sql — MAN vs MACHINE A/B (manual-exit experiment)
--
--  Clones 3 channels as `<base>-manual` twins, ARMED. The twin takes the SAME
--  programmed ENTRIES as its base (the worker's base-slug resolver strips `-manual`;
--  the compiled qqq-thrust-trail twin runs its CLONED spec_json), but the worker
--  (>= 2026-06-08b) DROPS every programmed exit so the HUMAN owns the exits — except
--  a hard bell backstop (~15:57 ET) so a 0DTE/1DTE can't expire/assign.
--
--  ⚠ RUN ORDER: paste worker 2026-06-08b into the Supabase Edge Function editor FIRST,
--  THEN run this. (If armed before the worker update, the twins just trade like normal
--  channels until the paste lands — not harmful, just not-yet-manual.)
--
--  Twins: power → power-manual · breakout → breakout-manual ·
--         qqq-thrust-trail → qqq-thrust-trail-manual
--  Colour: each twin inherits its base's colour (pairs the A/B visually); the UI adds a
--  ✋ MANUAL badge by slug so you know which of the pair is yours to close. To instead
--  make all three ONE colour, set `color` to a fixed hex in the INSERT below.
--  Safe to re-run (skips any twin that already exists).
-- ============================================================================

with base as (
  select * from strategists s
  where s.slug in ('power', 'breakout', 'qqq-thrust-trail')
    and not exists (select 1 from strategists t where t.slug = s.slug || '-manual')
),
ins as (
  insert into strategists
    (slug, name, mandate, regime, color, is_active, spec_json, thesis_md, status, accent, sort_order, underlying)
  select s.slug || '-manual', s.name || ' ✋', s.mandate, s.regime, s.color, true,
         s.spec_json, s.thesis_md, 'armed', s.accent, s.sort_order + 1, s.underlying
  from base s
  returning id, slug
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false, c.underlying_stop_pct
from ins
join base b on b.slug || '-manual' = ins.slug
join strategist_config c on c.strategist_id = b.id;

-- verify
select s.slug, s.name, s.status, s.underlying, c.capital_pct as risk_usd, c.max_contracts
from strategists s join strategist_config c on c.strategist_id = s.id
where s.slug like '%-manual' order by s.slug;

-- ----------------------------------------------------------------------------
-- CUMULATIVE scorecard view — man (you) vs machine (the programmed base), all-time
-- realized P&L per pair. `select * from man_vs_machine;` anytime to see how you did.
-- (The dashboard panel shows TODAY live; this view is the running tally.)
-- ----------------------------------------------------------------------------
create or replace view man_vs_machine as
select
  regexp_replace(t.slug, '-manual$', '') as channel,
  round(coalesce((select sum(realized_pnl) from positions where strategist_id = b.id and status = 'closed'), 0)::numeric, 0) as machine_pnl,
  round(coalesce((select sum(realized_pnl) from positions where strategist_id = t.id and status = 'closed'), 0)::numeric, 0) as you_pnl,
  (select count(*) from positions where strategist_id = b.id and status = 'closed') as machine_trades,
  (select count(*) from positions where strategist_id = t.id and status = 'closed') as you_trades
from strategists t
join strategists b on b.slug = regexp_replace(t.slug, '-manual$', '')
where t.slug like '%-manual'
order by channel;
