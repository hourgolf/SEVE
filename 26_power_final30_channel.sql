-- ============================================================================
--  26_power_final30_channel.sql · wire the LIVE power-final30 channel + retire base power.
--  Pairs with paper-trader worker 2026-06-05c (registers powerFinal30Eval under the exact
--  slug `power-final30`: FINAL 30 MIN + pure momentum lean, no VWAP gate). The H1 window
--  sweep flipped power's gross −$8.4k (60m) → +$8.9k (30m) — the 15:00–15:30 half was
--  dragging it negative.
--
--  Sized to MATCH base power (RISK $500/trade, max 6, $300… see below) because this is a
--  validated REPLACEMENT, not a tiny experiment. And it MUTES base `power` so the two don't
--  both lean the same 0DTE OCC in the final half-hour (the documented shared-OCC churn).
--
--  ORDER: deploy worker 2026-06-05c FIRST (old worker has no REGISTRY hit → idle), THEN run this.
-- ============================================================================

-- 1) the channel (only if missing) — matches power's size, distinct colour
insert into strategists (slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying)
select 'power-final30',
       'Power Final 30',
       '0DTE gamma — momentum lean in the FINAL 30 MIN only, hard flatten by the bell',
       'final half-hour, directional resolution into the close',
       '#f76808', 'orange', true, 'armed', 13, 'SPY'
where not exists (select 1 from strategists where slug = 'power-final30');

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct)
select s.id, 500, 0, 6, 500, false, false, 0
  from strategists s
 where s.slug = 'power-final30'
   and not exists (select 1 from strategist_config c where c.strategist_id = s.id);

-- 2) retire base power (mute → it stops taking NEW entries; any open position still winds down)
update strategist_config set muted = true
 where strategist_id = (select id from strategists where slug = 'power');

-- Verify:
--   select s.slug, s.status, c.capital_pct risk, c.max_contracts, c.muted
--     from strategists s join strategist_config c on c.strategist_id = s.id
--    where s.slug in ('power','power-final30');
--
-- Compare live (after a few sessions): power-final30 vs the muted base power baseline —
--   select s.slug, count(*) n, round(sum(p.realized_pnl)) pnl
--     from positions p join strategists s on s.id=p.strategist_id
--    where s.slug in ('power','power-final30') and p.status='closed' and p.opened_at >= now()-interval '14 days'
--    group by s.slug;
--
-- Roll back:  update strategist_config set muted=false where strategist_id=(select id from strategists where slug='power');
--             update strategists set status='draft' where slug='power-final30';
-- ============================================================================
