-- Closed rows express realized history only. Keep display-only mark writers from
-- leaking stale unrealized P&L into desk/account reconciliation.
update public.positions
set unrealized_pnl = 0
where status = 'closed'
  and coalesce(unrealized_pnl, 0) <> 0;

alter table public.positions
  add constraint positions_closed_unrealized_zero
  check (status <> 'closed' or coalesce(unrealized_pnl, 1) = 0)
  not valid;

alter table public.positions
  validate constraint positions_closed_unrealized_zero;
