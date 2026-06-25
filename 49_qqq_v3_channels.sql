-- 49_qqq_v3_channels.sql — QQQ V3/ALT paper-lab clones + PYRAMID SHADOW (cross-index pyramiding test).
--
-- WHY: the cross-index at-bats finding (xindex-atbats-probe, 2026-06-25) showed the V3/ALT gap-momentum
-- edge is STRONGER on QQQ (+$111/t, thin/2-window) than SPY (+$4.7/t); pyramid-xindex showed pyramiding
-- HELPS QQQ (+$5.5k→+$11k) [[cross-index-atbats]]. SPY base V3/ALT pyramid LIVE (pyramid_adds=3); QQQ had
-- no V3/ALT channels. These clones run the IDENTICAL V3/ALT spec on QQQ at ATM (the validated QQQ strike;
-- ITM is SPY-specific [[strike-moneyness-finding]]) so (a) QQQ V3/ALT trades live forward, and (b)
-- pyramiding accrues in SHADOW (pyramid_adds=0 → the worker logs 'would-add' events, places NO add orders)
-- to validate before arming, per the shadow-first doctrine. Paper-lab bucket = Resurrected.
--
-- WHAT (overrides vs the SPY source): slug/name (-qqq) · underlying = QQQ · account = Resurrected · status =
-- armed (the base channel trades paper) · strike_offset = 0 (ATM) · pyramid_adds = 0 (SHADOW). spec_json
-- (entries + exit bracket + 15:25 flatten) copied verbatim → the clone = the tested V3/ALT config on QQQ.
-- The worker's PYRAMID_SLUGS rail (decide.ts) is extended to these two slugs in the same deploy
-- (worker stream-2026-06-25b). Idempotent. Resurrected creds (ALPACA_KEY_3) are live.

-- ── BREAK(ALT V3) → QQQ ─────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-alt-v3'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-alt-v3-qqq', 'BREAK(ALT V3) · QQQ',
         mandate, regime, color, accent, true, 'armed',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'QQQ', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-alt-v3-qqq')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── BREAK(ALT) → QQQ ────────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-smart-entries'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-smart-entries-qqq', 'BREAK(ALT) · QQQ',
         mandate, regime, color, accent, true, 'armed',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'QQQ', (select id from accounts where name = 'Resurrected'), 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-smart-entries-qqq')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct, strike_offset)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy, 0, c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct, 0
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── verify ───────────────────────────────────────────────────────────────────────────────────
select s.slug, s.name, s.status, s.underlying, a.name as account, c.strike_offset, c.pyramid_adds,
       c.capital_pct as risk_usd, c.max_contracts, c.entry_dte, c.event_policy
from strategists s left join strategist_config c on c.strategist_id = s.id left join accounts a on a.id = s.account_id
where s.slug in ('breakout-alt-v3-qqq', 'breakout-smart-entries-qqq') order by s.slug;

-- ROLLBACK: delete from strategist_config where strategist_id in (select id from strategists where slug in ('breakout-alt-v3-qqq','breakout-smart-entries-qqq'));
--           delete from strategists where slug in ('breakout-alt-v3-qqq','breakout-smart-entries-qqq');
