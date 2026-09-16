-- Canceled/unfilled broker observations have no fill price. Retain every
-- existing accepted shape; never invent a zero-dollar fill for an unfilled order.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table public.execution_observations
  drop constraint execution_observations_check1,
  add constraint execution_observations_check1 check (
    (event_kind = 'decision'
      and client_order_id is null and broker_order_id is null
      and broker_status is null and filled_qty is null and fill_price is null)
    or
    (event_kind = 'broker_result'
      and client_order_id is not null and broker_status is not null
      and filled_qty is not null
      and (fill_price is not null or filled_qty = 0))
  ) not valid;
commit;

begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
alter table public.execution_observations
  validate constraint execution_observations_check1;
commit;
