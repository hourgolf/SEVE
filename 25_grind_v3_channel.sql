-- ============================================================================
--  25_grind_v3_channel.sql · wire up the LIVE grind-v3 validation channel.
--  Pairs with paper-trader worker 2026-06-05b (registers grindV3Eval under the exact
--  slug `grind-v3`). Creates the channel ARMED but SMALL-SIZE so it accumulates real
--  data vs muted base grind — the backtest can't settle grind-v3 (pessimistic 3%
--  spread + ungated), so this is the live A/B. Idempotent (safe to re-run).
--
--  ORDER: deploy worker 2026-06-05b FIRST (else the old worker has no REGISTRY hit for
--  `grind-v3` → it sits idle, harmless), THEN run this.
--
--  SIZING (two-dial model): capital_pct = RISK $/trade (150 → ~1–2 contracts on a
--  ~$1.50 ATM scalp, a quarter of base grind's $500), max_contracts = 4 ceiling,
--  daily_stop_usd = $300 net-realized daily loss floor. No underlying stop (a 1-min
--  scalp barely moves the underlying in its window — the MAE study showed ~no benefit).
-- ============================================================================

-- 1) the channel (only if missing)
insert into strategists (slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying)
select 'grind-v3',
       'GRIND v3',
       'Disciplined scalper — midday momentum bursts (trend-gated), fast fixed-target exit, afternoon curfew',
       'liquid, normal-volatility intraday',
       '#34d399', 'emerald', true, 'armed', 12, 'SPY'
where not exists (select 1 from strategists where slug = 'grind-v3');

-- 2) its config (small size; only if missing)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct)
select s.id, 150, 0, 4, 300, false, false, 0
  from strategists s
 where s.slug = 'grind-v3'
   and not exists (select 1 from strategist_config c where c.strategist_id = s.id);

-- Verify:
--   select s.slug, s.status, c.capital_pct as risk_usd, c.max_contracts, c.daily_stop_usd, c.muted
--     from strategists s join strategist_config c on c.strategist_id = s.id
--    where s.slug in ('grind', 'grind-v3');
--
-- Compare live (after a few sessions): grind-v3 vs muted base grind —
--   select s.slug, count(*) n, round(sum(p.realized_pnl)) pnl,
--          round(avg(case when p.realized_pnl>0 then 1 else 0 end)*100) winpct
--     from positions p join strategists s on s.id = p.strategist_id
--    where s.slug in ('grind','grind-v3') and p.status='closed'
--    group by s.slug;
--
-- To park it:  update strategists set status='draft' where slug='grind-v3';
--   (or mute:  update strategist_config set muted=true where strategist_id=
--              (select id from strategists where slug='grind-v3');)
-- ============================================================================
