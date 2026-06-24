-- 45_iwm_channels.sql — stage IWM V3/ALT as Core channels (the 2nd validated index).
--
-- WHY: MOVE 3 (commits be7574f / 669498b) proved the desk's one robust edge GENERALIZES
-- cross-index — BREAK(ALT V3) + BREAK(ALT) pass the full 5-window OOS bar on IWM, both 5/5
-- (+$6.5–6.6k each). The edge is broad-market gap-momentum, not a SPY artifact. Adding IWM
-- as a live Core channel = real diversification + faster forward at-bats, zero driver's-seat.
-- See memory/desk-doctrine.md "⭐ EDGE STATUS".
--
-- WHAT: clone the LIVE SPY specs + config verbatim (spec_json + risk/stop/dte/event are copied
-- straight from the source rows so the IWM clone tracks any future SPY tuning), overriding only:
--   underlying = 'IWM' · account_id = Core (inherited) · executor = 'stream' · status = 'draft'
--   · slug/name (-iwm suffix) · pyramid_adds (see the PYRAMID note below).
-- The worker runs these as compiled-spec channels (decide.ts:141 uses spec_json; an -iwm slug is
-- not touched by the base-slug resolver), so NO worker code change is needed beyond listing IWM
-- in the symbol set (worker/src/config.ts — done in stream-2026-06-24b).
--
-- ⚠ TWO-PHASE SHADOW GATE (the QQQ discipline — never trade a new symbol the worker hasn't proven):
--   PHASE 1 (data proof): add IWM to the worker's SYMBOLS (Railway env SYMBOLS=SPY,QQQ,IWM, or the
--     new code default), redeploy. The worker then seed[IWM]'s bars + snapshots its 0DTE chain EVERY
--     cycle with NO IWM channel trading (these stay 'draft' = blocked 'not_armed' at decide.ts:324).
--     Watch the boot log for  `seed[IWM]: N bars` + `seed[IWM]: chain M contracts`  and NO repeated
--     `chain[IWM]: snapshot failed`. That proves the data feed + chain snapshot handle IWM 0DTE.
--   PHASE 2 (arm): only after Phase 1 is clean, run the ARM block at the bottom. It hot-reloads via
--     the worker's realtime config sub — no redeploy. The channels then trade live on Core next cycle.
--
-- ⚠ PYRAMID note: SPY V3/ALT run pyramid_adds=3 (the desk's biggest lever, SPY-validated). The IWM
--   MOVE-3 result is the BASE edge (flat). To keep the forward test clean (isolate "new index" from
--   "max leverage") this stages IWM FLAT (pyramid_adds=0). To mirror SPY exactly, change the two
--   `0  -- pyramid_adds` values to `c.pyramid_adds`. Pyramiding can also be added later once IWM's
--   base edge is live-confirmed (set pyramid_adds=3 on these two slugs).
--
-- Idempotent: re-running is a no-op once the rows exist. Run in the Supabase SQL editor.

-- ── BREAK(ALT V3) → IWM ──────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-alt-v3'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-alt-v3-iwm', 'BREAK(ALT V3) · IWM',
         mandate, regime, color, accent, true, 'draft',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'IWM', account_id, 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-alt-v3-iwm')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy,
       0,  -- pyramid_adds: FLAT on the new index (clean base-edge forward test); set c.pyramid_adds to mirror SPY
       c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── BREAK(ALT) → IWM ─────────────────────────────────────────────────────────────────────────
with src as (select * from strategists where slug = 'breakout-smart-entries'),
ins as (
  insert into strategists
    (id, slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, account_id, executor, spec_json, created_at)
  select gen_random_uuid(), 'breakout-smart-entries-iwm', 'BREAK(ALT) · IWM',
         mandate, regime, color, accent, true, 'draft',
         (select coalesce(max(sort_order), 0) + 1 from strategists),
         'IWM', account_id, 'stream', spec_json, now()
  from src
  where not exists (select 1 from strategists where slug = 'breakout-smart-entries-iwm')
  returning id
)
insert into strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed,
   underlying_stop_pct, entry_dte, event_policy, pyramid_adds, take_profit_pct, stall_minutes, stall_max_favor_pct)
select ins.id, c.capital_pct, c.aggression, c.max_contracts, c.daily_stop_usd, false, false,
       c.underlying_stop_pct, c.entry_dte, c.event_policy,
       0,  -- pyramid_adds: FLAT on the new index (clean base-edge forward test); set c.pyramid_adds to mirror SPY
       c.take_profit_pct, c.stall_minutes, c.stall_max_favor_pct
from ins cross join strategist_config c
where c.strategist_id = (select id from src);

-- ── verify (both rows: status=draft, underlying=IWM, Core, executor=stream, entries cloned) ────
select s.slug, s.name, s.status, s.underlying, s.executor, a.name as account,
       jsonb_array_length(s.spec_json->'entries'->0->'all') as entry_conditions,
       c.capital_pct as risk_usd, c.max_contracts, c.daily_stop_usd, c.entry_dte,
       c.event_policy, c.pyramid_adds, c.underlying_stop_pct
from strategists s
  left join strategist_config c on c.strategist_id = s.id
  left join accounts a on a.id = s.account_id
where s.slug in ('breakout-alt-v3-iwm', 'breakout-smart-entries-iwm')
order by s.slug;

-- ── PHASE 2 — ARM (run ONLY after Phase 1 seed[IWM] is clean; hot-reloads, no redeploy) ────────
-- update strategists set status = 'armed'
--  where slug in ('breakout-alt-v3-iwm', 'breakout-smart-entries-iwm');
--
-- ROLLBACK (bench / un-arm any time): update strategists set status='draft' where slug like '%-iwm';
-- DELETE entirely (desk must be flat of IWM):
--   delete from strategist_config where strategist_id in (select id from strategists where slug like '%-iwm');
--   delete from strategists where slug like '%-iwm';
