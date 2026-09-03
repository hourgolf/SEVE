-- Split the legacy `fomc-follow` collector into two explicitly different,
-- observe-only research roots. Installing this migration does not add either
-- root to a release manifest and therefore grants no paper-entry authority.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.strategists
  (id, slug, name, mandate, regime, underlying, executor, account_id, status, is_active, spec_json)
values
  (
    '6f0c4c26-8c96-4b2f-9e1d-8bd9020cfe1a',
    'pm-momentum-follow',
    'PM Momentum Follow (observe only)',
    'Generic afternoon momentum continuation, explicitly excluding FOMC statement days. Observe-only until prospective executable-shadow evidence passes promotion gates.',
    'afternoon momentum / non-FOMC',
    'SPY',
    'stream',
    '56daa293-e6bc-447d-83ac-2bfafb4d0ac1',
    'draft',
    true,
    '{"meta":{"strategyId":"pm-momentum-follow","name":"PM Momentum Follow","instrument":"SPY","structure":"single-leg","direction":"directional","dteRange":[0,0],"sessionWindow":"14:30-14:45 ET, excluding FOMC statement days"},"entries":[{"direction":"call","reason":"pm_momentum_follow","all":[{"kind":"event_day","event":"fomc","present":false},{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":">=","value":0.4,"lookback":5}]},{"direction":"put","reason":"pm_momentum_follow","all":[{"kind":"event_day","event":"fomc","present":false},{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":"<=","value":-0.4,"lookback":5}]}],"exits":[{"timeET":"15:25"}]}'::jsonb
  ),
  (
    '22af21e4-cb61-4d95-8af4-c8f662a8e5b2',
    'fomc-event-follow',
    'FOMC Event Follow (observe only)',
    'Post-statement momentum continuation only on an explicit FOMC statement date. Observe-only until event-specific executable-shadow evidence passes promotion gates.',
    'event / FOMC post-announcement',
    'SPY',
    'stream',
    '56daa293-e6bc-447d-83ac-2bfafb4d0ac1',
    'draft',
    true,
    '{"meta":{"strategyId":"fomc-event-follow","name":"FOMC Event Follow","instrument":"SPY","structure":"single-leg","direction":"directional","dteRange":[0,0],"sessionWindow":"14:30-14:45 ET on FOMC statement days"},"entries":[{"direction":"call","reason":"fomc_event_follow","all":[{"kind":"event_day","event":"fomc","present":true},{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":">=","value":0.4,"lookback":5}]},{"direction":"put","reason":"fomc_event_follow","all":[{"kind":"event_day","event":"fomc","present":true},{"kind":"time_between","startET":"14:30","endET":"14:45"},{"kind":"momentum_atr","op":"<=","value":-0.4,"lookback":5}]}],"exits":[{"timeET":"15:25"}]}'::jsonb
  )
on conflict (slug) do nothing;

insert into public.strategist_config
  (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd,
   muted, soloed, underlying_stop_pct, premium_stop_pct, take_profit_pct,
   event_policy, entry_dte)
values
  ('6f0c4c26-8c96-4b2f-9e1d-8bd9020cfe1a', 105, 0, 2, 105, false, false, 0, 30, 0, 'standdown', 0),
  ('22af21e4-cb61-4d95-8af4-c8f662a8e5b2', 105, 0, 1, 105, false, false, 0, 30, 0, 'ignore', 0)
on conflict (strategist_id) do nothing;

commit;
