-- ============================================================================
--  24_underlying_stop.sql · the per-channel UNDERLYING INITIAL STOP knob.
--  Pairs with paper-trader worker 2026-06-05a. Adds one config column and turns the
--  stop ON (0.20% of the underlying) for the four channels the MAE study flagged —
--  the long-hold / pricier-option channels whose premium −50% stop let the underlying
--  run 0.12–0.46% against them before cutting. The worker also SHADOW-logs the tighter
--  0.15% (events `stream-shadow: US0.15…`) so we A/B it live without a colliding channel.
--
--  ORDER OF OPERATIONS (safe — the change is inert until step 2):
--    1) deploy worker 2026-06-05a   (column absent → undefined → 0 → no-op everywhere)
--    2) run THIS file               (adds the column @ default 0, then arms the 4 channels)
--  `strategist_config(*)` is select-* so the worker tolerates the column before/after.
--  underlying_stop_pct = 0 means OFF, so every other channel is unaffected.
-- ============================================================================

alter table strategist_config
  add column if not exists underlying_stop_pct numeric not null default 0;   -- % of underlying; 0 = off

-- Arm 0.20% on the four benefited channels (the live leg; 0.15% runs as the shadow).
update strategist_config
   set underlying_stop_pct = 0.20
 where strategist_id in (
   select id from strategists
    where slug in ('orb-trend-rider','breakout-qqq','qqq-thrust-trail','breakout-smart-entries')
 );

-- Verify:
--   select s.slug, c.underlying_stop_pct
--     from strategist_config c join strategists s on s.id = c.strategist_id
--    order by c.underlying_stop_pct desc, s.slug;
--
-- Watch it work (after the next session):
--   select created_at, message from events
--    where message like '%underlying_stop%' or message like 'stream-shadow: US0.15%'
--    order by created_at desc limit 50;
--
-- To turn a channel back off:  update strategist_config set underlying_stop_pct = 0
--   where strategist_id = (select id from strategists where slug = '<slug>');
-- ============================================================================
