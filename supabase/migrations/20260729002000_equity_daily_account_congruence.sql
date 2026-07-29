-- A desk-wide daily NAV must never select whichever account happened to write
-- last. Aggregate one latest strategist-null snapshot per configured paper
-- account, and publish a date only when every configured paper account is
-- represented. Legacy account-null rows remain immutable but are not aggregate
-- authority once account-scoped evidence exists.
create or replace view public.equity_daily
with (security_invoker = true)
as
with paper_accounts as (
  select id
  from public.accounts
  where mode = 'paper'
),
expected as (
  select count(*)::bigint as account_count
  from paper_accounts
),
latest_by_account as (
  select distinct on (
    (s.captured_at at time zone 'America/New_York')::date,
    s.account_id
  )
    (s.captured_at at time zone 'America/New_York')::date as et_date,
    s.account_id,
    s.net_liquidation as nav
  from public.equity_snapshots s
  join paper_accounts a on a.id = s.account_id
  where s.strategist_id is null
  order by
    (s.captured_at at time zone 'America/New_York')::date,
    s.account_id,
    s.captured_at desc,
    s.id desc
),
account_complete as (
  select l.et_date, sum(l.nav)::numeric(14,2) as nav
  from latest_by_account l
  cross join expected e
  group by l.et_date, e.account_count
  having e.account_count > 0
     and count(*) = e.account_count
)
select et_date, nav
from account_complete
order by et_date;

comment on view public.equity_daily is
  'Account-complete paper desk NAV: latest strategist-null snapshot per configured paper account per ET date; incomplete dates fail closed.';
