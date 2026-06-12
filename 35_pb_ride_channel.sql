-- ============================================================================
--  35_pb_ride_channel.sql · the PB-ride paper-lab DRAFT (2026-06-12)
--  ALREADY APPLIED via the Supabase MCP — repo record. Idempotent.
--
--  Pullback-continuation @ 1DTE — the first generative-inventory candidate to
--  survive a bar. Lineage: born from the EMA-stretch refutation's residue,
--  KILLED at 0DTE (67% premium-stop rate — gamma was the murder weapon),
--  RESURRECTED by the operator's 1DTE walk-thought: +$4,632, +18.5/t, 42% win,
--  POSITIVE 4/5 regime windows (one-dte-probe; pb-selftest proves the registry
--  builtin trade-identical to the probe, 250t/$4,632).
--
--  DRAFT = visible on the desk, trades NOTHING. Arming is a separate operator
--  action and the arm bar is unchanged. Small-validation knobs (the grind-v3 B1
--  pattern): RISK $150/trade, STOP $300/day, 4-contract ceiling. entry_dte=1 is
--  LOAD-BEARING — the 0DTE variant is refuted; never arm this with entry_dte=0.
--
--  To arm (operator's word):  update strategists set status='armed' where slug='pb-ride';
--  To remove:                 update strategists set status='disabled' where slug='pb-ride';
-- ============================================================================

insert into strategists (slug, name, mandate, regime, color, accent, is_active, status, sort_order, underlying, executor)
select 'pb-ride',
       'PB RIDER',
       'Trend pullback-continuation — ribbon-stacked trend, band-tag retrace, with-trend bounce on 1DTE time value; ride with the catastrophic stop',
       'trending intraday with orderly retraces',
       '#a78bfa', 'violet', true, 'draft', 18, 'SPY', 'stream'
where not exists (select 1 from strategists where slug = 'pb-ride');

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd, muted, soloed, underlying_stop_pct, entry_dte)
select s.id, 150, 0, 4, 300, false, false, 0, 1
  from strategists s
 where s.slug = 'pb-ride'
   and not exists (select 1 from strategist_config c where c.strategist_id = s.id);

-- Verify:
--   select s.slug, s.status, s.executor, c.capital_pct risk, c.daily_stop_usd stop, c.entry_dte
--     from strategists s join strategist_config c on c.strategist_id = s.id where s.slug='pb-ride';
-- ============================================================================
