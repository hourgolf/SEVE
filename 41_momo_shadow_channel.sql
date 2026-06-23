-- 41_momo_shadow_channel.sql — MOMO continuation, a SHADOW / paper-lab channel (2026-06-22).
--
-- The "explore new shapes" pass found MOMO: a coiled prior-8-bar range_break + strong_trend
-- candle (the FIRST generative use of the candle-shape vocab as a NEW momentum shape, vs
-- nakamoto's refuted reversals), gap-gated, ride-exited. `npm run momo-shape-probe`: faithful
-- +$7,394/219t, bracket +$4,831 (both +), 46% of trade-days are NON-V3 (real decorrelation),
-- and CHOP-MIX is NEGATIVE (breaks the rising-tide mirage fingerprint) — the cleanest new-shape
-- signature to date. BUT 3/5 OOS windows (bleeds chop like every momentum shape) → FAILS the
-- >=4/5 arming bar. So it goes to the paper-lab NURSERY as a draft channel: INERT to the live
-- trade path (status='draft' → the worker's not_armed guard blocks any entry; never executes),
-- but the benched-sim / day-report pipeline replays it over the real option_quotes tape each
-- session for forward would-be P&L (collect-forward). Graduation = arm only if a chop classifier
-- ever validates (the binding constraint that would lift MOMO + the directional roster + the fly).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Rollback: delete from strategists where slug='momo-shape'
-- (cascades to strategist_config). To graduate later: update strategists set status='armed' where slug='momo-shape'.

with ins as (
  insert into strategists (slug, name, mandate, regime, accent, sort_order, underlying, executor, account_id, is_active, status, spec_json)
  values (
    'momo-shape', 'MOMO Cont (shadow)',
    'Compiled spec — momentum-continuation (coiled range_break + strong_trend, gap-gated); SHADOW/paper-lab, 3/5 OOS, decorrelated from V3',
    'trending / momentum', 'amber', 99, 'SPY', 'stream',
    (select account_id from strategists where slug = 'breakout-alt-v3'),  -- paper-main
    true, 'draft',
    $json${
      "meta": {"name":"MOMO Continuation","regime":"trending / momentum","dteRange":[0,1],"direction":"directional","structure":"single-leg","instrument":"SPX","strategyId":"momo-shape","sessionWindow":"shadow / paper-lab"},
      "exits": [{"note":"Stop out at -50% of premium","stopPct":50},{"note":"Flatten any open position by 15:25 ET","timeET":"15:25"}],
      "sizing": {"note":"Premium-based risk","riskPctOfAccount":2},
      "entries": [
        {"all":[{"kind":"range_break","dir":"up","bars":8},{"kind":"strong_trend","dir":"up"},{"kind":"vwap_side","side":"above"},{"kind":"gap_min","pct":0.25},{"kind":"time_before","et":"14:00"}],"reason":"Coiled prior-8-bar range break up + strong-trend candle, above VWAP, gap day","direction":"call"},
        {"all":[{"kind":"range_break","dir":"down","bars":8},{"kind":"strong_trend","dir":"down"},{"kind":"vwap_side","side":"below"},{"kind":"gap_min","pct":0.25},{"kind":"time_before","et":"14:00"}],"reason":"Coiled prior-8-bar range break down + strong-trend candle, below VWAP, gap day","direction":"put"}
      ]
    }$json$::jsonb
  )
  on conflict (slug) do nothing
  returning id
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, event_policy, entry_dte, take_profit_pct, pyramid_adds)
select id, 500, 0, 6, 500, false, false, 0, 'standdown', 0, 0, 0 from ins
on conflict (strategist_id) do nothing;
