-- ============================================================================
-- 42_widen_risk_knob.sql — cockpit P3 prerequisite
--
-- strategist_config.capital_pct holds RISK $/trade (the two-dial model's legacy
-- column name — it began life as a 0-100 percent, hence numeric(5,2) = max 999.99).
-- The bigger-balance cockpit accounts (4× risk = $2000/trade) overflow that. Widen
-- to numeric(12,2) to match daily_stop_usd. Safe (widening, no data loss).
-- ============================================================================
alter table public.strategist_config
  alter column capital_pct type numeric(12,2);
