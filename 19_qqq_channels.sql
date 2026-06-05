-- ============================================================================
--  19_qqq_channels.sql · clone the 4 SPY code channels onto QQQ (QQQ rollout)
--
--  Stands up a parallel QQQ desk: breakout-qqq / fade-qqq / power-qqq / grind-qqq,
--  each running the SAME code strategy as its SPY twin (the worker's base-slug
--  resolver maps `<base>-qqq` → `<base>`, v2026-06-04d) but on QQQ bars/chain (it
--  reads strategists.underlying, v2026-06-04c). Created as DRAFT so NOTHING trades
--  QQQ until you arm them (see the arm statement at the bottom — run it tomorrow).
--
--  Idempotent: re-running inserts nothing new (slug is unique; on conflict do nothing).
--  PREREQ: 17_strategist_underlying.sql (the `underlying` column) — already run.
--  Worker must be on 2026-06-04d (the base-slug resolver) or the clones won't trade.
--
--  Run once in the Supabase SQL editor.
-- ============================================================================

-- 1) Clone the strategist rows. Inherits name/mandate/regime/color/accent from the
--    SPY twin (so the QQQ pair shares its accent — the ticker chip tells them apart),
--    appends " · QQQ" to the name, flips underlying, starts DRAFT, sorts just after.
insert into strategists (slug, underlying, name, mandate, regime, color, accent, status, sort_order)
select
  s.slug || '-qqq',
  'QQQ',
  s.name || ' · QQQ',
  s.mandate,
  s.regime,
  s.color,
  s.accent,
  'draft',
  coalesce(s.sort_order, 100) + 10
from strategists s
where s.slug in ('breakout', 'fade', 'power', 'grind')
on conflict (slug) do nothing;

-- 2) Clone each one's mixer config (RISK / aggression / max_contracts / STOP) from the
--    SPY twin, so the QQQ channel sizes identically out of the gate. Mute/solo reset off.
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed)
select q.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false
from strategists q
join strategists s        on s.slug = replace(q.slug, '-qqq', '')
join strategist_config c  on c.strategist_id = s.id
where q.slug in ('breakout-qqq', 'fade-qqq', 'power-qqq', 'grind-qqq')
on conflict (strategist_id) do nothing;

-- verify — 4 QQQ rows, draft, each with a config:
-- select q.slug, q.underlying, q.status, c.capital_pct as risk, c.max_contracts, c.daily_stop_usd as stop
-- from strategists q join strategist_config c on c.strategist_id = q.id
-- where q.slug like '%-qqq' order by q.sort_order;

-- ----------------------------------------------------------------------------
--  ARM (run TOMORROW when you're ready to trade QQQ live on paper). Flip all four,
--  or list only the slugs you want. Disarm = set status back to 'draft'.
-- ----------------------------------------------------------------------------
-- update strategists set status = 'armed' where slug in ('breakout-qqq','fade-qqq','power-qqq','grind-qqq');
