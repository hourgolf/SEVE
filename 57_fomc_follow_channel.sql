-- ============================================================================
-- 57_fomc_follow_channel.sql — FOMC-resolution follow, paper-lab DRAFT (phase-4 B1, 2026-07-01).
--
-- THESIS (structural, not data-mined): a scheduled binary pins price into the 14:00 statement;
-- once resolved, dealer re-hedging + pre-event hedge unwinds produce short-horizon CONTINUATION
-- of the statement move. Probe (fomc-resolution-probe): follow@14:30 positive on n=5 with ONE
-- day = 71% of P&L (anecdote-grade BY CONSTRUCTION); fade is dead; the edge decays with delay.
-- Paper only — NO profitability claim.
--
-- ⚠ NOT AUTO-EVENT-GATED: the spec vocab has no "fomc_day" condition, so this spec would fire
-- on ANY day inside 14:30–14:45 with momentum. It therefore stays DRAFT permanently between
-- events; the operating procedure is MANUAL: arm it on an FOMC morning, it stands itself down
-- to the 15:25 flatten, disarm after the close. event_policy='ignore' exempts it from the
-- FOMC stand-down flatten (it IS the event-native thesis; 33_event_policy.sql).
--
-- PRE-REGISTERED GRADUATION (docs/pre-registered-tests-2026-07.md): arm-per-event only; earns a
-- standing arm only at pooled n≥10 with the largest single day ≤50% of total P&L.
-- KILL: expectancy ≤0 at n=10, or concentration never dissolves by n=12 → delete.
-- Next event: 2026-07-29. Sizing = paper-lab rule (A1): RISK $350 · 6 contracts.
-- ============================================================================

insert into strategists (slug, name, mandate, regime, underlying, executor, account_id, status, is_active, spec_json)
select 'fomc-follow', 'FOMC Follow (lab)',
  'Event-native: follow the resolved FOMC statement move 14:30→15:25. DRAFT between events — arm manually on FOMC days only. Paper only.',
  'event / post-announcement drift', 'SPY', 'stream', a.id, 'draft', true,
  '{"meta":{"strategyId":"fomc-follow","name":"FOMC Follow","instrument":"SPY","structure":"single-leg","direction":"directional","dteRange":[0,0],"sessionWindow":"14:30-14:45 ET (FOMC days, manual arm)"},
    "entries":[
      {"direction":"call","reason":"fomc_follow","all":[{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":">=","value":0.4,"lookback":5}]},
      {"direction":"put","reason":"fomc_follow","all":[{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":"<=","value":-0.4,"lookback":5}]}],
    "exits":[{"timeET":"15:25"}]}'::jsonb
from accounts a where a.name = 'Resurrected'
  and not exists (select 1 from strategists s where s.slug = 'fomc-follow');

insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd,
  muted, soloed, underlying_stop_pct, premium_stop_pct, take_profit_pct, event_policy, entry_dte)
select s.id, 350, 0, 6, 350, false, false, 0, null, 0, 'ignore', 0
from strategists s
where s.slug = 'fomc-follow'
  and not exists (select 1 from strategist_config c where c.strategist_id = s.id);
