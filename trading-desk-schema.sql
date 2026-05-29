-- ============================================================================
--  TRADING DESK  ·  Supabase / Postgres schema
--  SPY 0DTE / 1DTE multi-strategy options desk — paper-trading backbone
-- ----------------------------------------------------------------------------
--  Run this in a DEDICATED Supabase project. Do NOT add it to an existing
--  production database (e.g. the Hour Golf project) — keep the trading book
--  fully isolated so a bad migration or a runaway loop can't touch live data.
--
--  Data lineage:  signal → order → fill → position, every row tagged with a
--  strategist_id, so per-strategist P&L and the fund roll-up both fall out for
--  free. The console writes strategist_config + fund_state; the agents read
--  them at the top of every loop. `events` is the append-only system journal.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- enums -----------------------------------------------------------
create type trading_mode    as enum ('paper','live');
create type option_type     as enum ('call','put');
create type order_side      as enum ('buy_to_open','sell_to_open','buy_to_close','sell_to_close');
create type order_kind      as enum ('market','limit','stop','stop_limit');
create type order_status    as enum ('pending','working','partially_filled','filled','rejected','canceled','expired');
create type position_status as enum ('open','closed');
create type event_level     as enum ('OK','INFO','WARN','RISK','EXEC');

-- ---------- updated_at helper ----------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;


-- ============================================================================
--  DESK ROSTER + LIVE CONTROLS  (what the console writes)
-- ============================================================================

-- The strategists themselves — one row per "PM" on the desk.
create table strategists (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  mandate     text not null,           -- what it does, in plain English
  regime      text,                    -- the market tape it wants
  color       text,                    -- UI accent (matches the mixer)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Live mixer state — exactly the fader/knob/mute/solo positions.
-- One row per strategist. The console UPDATEs this; the bots SELECT it.
create table strategist_config (
  strategist_id   uuid primary key references strategists(id) on delete cascade,
  capital_pct     numeric(5,2)  not null default 0,    -- % of fund this PM may deploy
  aggression      numeric(5,2)  not null default 50,   -- 0–100 size lean per trade
  max_contracts   int           not null default 2,    -- hard per-trade cap
  daily_stop_usd  numeric(12,2) not null default 200,  -- per-PM loss budget (positive $)
  muted           boolean       not null default false,
  soloed          boolean       not null default false,
  updated_at      timestamptz   not null default now()
);
create trigger trg_cfg_updated before update on strategist_config
  for each row execute function set_updated_at();

-- Fund-level state — singleton row. The master strip on the console.
-- These limits OVERRIDE anything a strategist tries to do.
create table fund_state (
  id                     int primary key default 1,
  total_capital_usd      numeric(14,2) not null default 10000,
  master_daily_stop_usd  numeric(14,2) not null default 300,   -- fund-wide kill threshold
  mode                   trading_mode  not null default 'paper',
  is_halted              boolean       not null default false,  -- the kill switch
  halted_reason          text,
  updated_at             timestamptz   not null default now(),
  constraint fund_singleton check (id = 1)
);
create trigger trg_fund_updated before update on fund_state
  for each row execute function set_updated_at();


-- ============================================================================
--  TRADE LIFECYCLE  (what the bots write)
-- ============================================================================

-- A strategist's intent BEFORE it becomes an order. Logging this lets you see
-- what the risk layer vetoed, not just what got through — critical for tuning.
create table signals (
  id                uuid primary key default gen_random_uuid(),
  strategist_id     uuid not null references strategists(id),
  signal_type       text not null,            -- e.g. 'MR-FADE','ORB-L','GAMMA-LEAN'
  underlying_price  numeric(10,4),
  direction         option_type,              -- call = bullish, put = bearish
  rationale         jsonb,                    -- the features that fired it
  acted_on          boolean not null default false,
  blocked_reason    text,                     -- set if the governor rejected it
  created_at        timestamptz not null default now()
);
create index idx_signals_strategist on signals(strategist_id, created_at desc);

-- Orders submitted to the broker.
create table orders (
  id              uuid primary key default gen_random_uuid(),
  strategist_id   uuid not null references strategists(id),
  signal_id       uuid references signals(id),
  broker_order_id text,                       -- Alpaca's order id
  occ_symbol      text not null,              -- e.g. SPY260529C00756000
  underlying      text not null default 'SPY',
  expiration      date not null,
  strike          numeric(10,2) not null,
  opt_type        option_type not null,
  side            order_side not null,
  kind            order_kind not null,
  qty             int not null,
  limit_price     numeric(10,4),
  status          order_status not null default 'pending',
  rejected_reason text,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_orders_strategist on orders(strategist_id, submitted_at desc);
create index idx_orders_status on orders(status);
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

-- Executions. cash_delta is signed (− on buys, + on sells) so summing this
-- column per strategist or per day IS your realized cash P&L.
create table fills (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  strategist_id uuid not null references strategists(id),
  qty           int not null,
  fill_price    numeric(10,4) not null,
  fees          numeric(10,4) not null default 0,
  cash_delta    numeric(14,2) not null,
  filled_at     timestamptz not null default now()
);
create index idx_fills_strategist on fills(strategist_id, filled_at desc);
create index idx_fills_order on fills(order_id);

-- Current + historical positions. qty is signed (+ long / − short).
-- A closed position is a completed round-trip; realized_pnl is the result.
create table positions (
  id               uuid primary key default gen_random_uuid(),
  strategist_id    uuid not null references strategists(id),
  occ_symbol       text not null,
  underlying       text not null default 'SPY',
  expiration       date not null,
  strike           numeric(10,2) not null,
  opt_type         option_type not null,
  qty              int not null,
  avg_entry_price  numeric(10,4) not null,
  current_mark     numeric(10,4),
  unrealized_pnl   numeric(14,2) default 0,
  realized_pnl     numeric(14,2) default 0,
  status           position_status not null default 'open',
  delta numeric(8,4), gamma numeric(8,4), theta numeric(8,4), vega numeric(8,4), iv numeric(8,4),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  updated_at       timestamptz not null default now()
);
create index idx_positions_strategist on positions(strategist_id, status);
create trigger trg_positions_updated before update on positions
  for each row execute function set_updated_at();


-- ============================================================================
--  TELEMETRY  (what the dashboard reads)
-- ============================================================================

-- Periodic account-value snapshots → the intraday equity curve.
-- strategist_id NULL = the whole fund; non-null = that PM's book.
create table equity_snapshots (
  id               uuid primary key default gen_random_uuid(),
  strategist_id    uuid references strategists(id),
  net_liquidation  numeric(14,2) not null,
  cash             numeric(14,2),
  realized_pnl_day numeric(14,2) default 0,
  unrealized_pnl   numeric(14,2) default 0,
  captured_at      timestamptz not null default now()
);
create index idx_equity_time on equity_snapshots(strategist_id, captured_at desc);

-- The append-only system journal → the event log panel.
create table events (
  id            uuid primary key default gen_random_uuid(),
  level         event_level not null default 'INFO',
  strategist_id uuid references strategists(id),
  message       text not null,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index idx_events_time on events(created_at desc);


-- ============================================================================
--  ROW-LEVEL SECURITY
--  The bot connects with the service-role key, which bypasses RLS. We enable
--  RLS everywhere so nothing is exposed by default; add SELECT policies for an
--  authenticated dashboard user when you wire the front end to Supabase.
-- ============================================================================
alter table strategists       enable row level security;
alter table strategist_config enable row level security;
alter table fund_state        enable row level security;
alter table signals           enable row level security;
alter table orders            enable row level security;
alter table fills             enable row level security;
alter table positions         enable row level security;
alter table equity_snapshots  enable row level security;
alter table events            enable row level security;


-- ============================================================================
--  SEED — THE DESK
-- ============================================================================
insert into fund_state (id) values (1);   -- $10k paper, −$300 master stop

with s as (
  insert into strategists (slug, name, mandate, regime, color) values
    ('fade',    'The Fade',     'Mean reversion — fades range extremes back to VWAP',                       'range-bound / high-IV chop',        '#2fd573'),
    ('breakout','The Breakout', 'Momentum — rides opening-range expansion in the direction of the break',   'trending / expansion / news days',  '#3b9eff'),
    ('power',   'Power Hour',   '0DTE gamma — directional lean in the final hour only, hard flatten by bell','any tape, but 15:00–16:00 ET only', '#ffb224'),
    ('grind',   'The Grinder',  'Scalper — many small microstructure edges, quick in and out',              'liquid, normal-volatility intraday','#45c4d6')
  returning id, slug
)
insert into strategist_config (strategist_id, capital_pct, aggression, max_contracts, daily_stop_usd)
select id,
  (case slug when 'fade' then 30 when 'breakout' then 25 when 'power' then 20 when 'grind' then 15 end),
  (case slug when 'fade' then 40 when 'breakout' then 62 when 'power' then 75 when 'grind' then 30 end),
  (case slug when 'fade' then  6 when 'breakout' then  4 when 'power' then  3 when 'grind' then  8 end),
  (case slug when 'fade' then 90 when 'breakout' then 80 when 'power' then 70 when 'grind' then 60 end)
from s;
-- capital_pct sums to 90% → 10% held in cash reserve, matching the console defaults.


-- ============================================================================
--  STRATEGIST SIGNAL HYPOTHESES  (reference — this logic lives in the agent
--  code, not the DB, but documenting it here keeps the desk coherent. These
--  are STARTING HYPOTHESES to paper-test and falsify, not proven edges.)
-- ----------------------------------------------------------------------------
--  THE FADE      Build the opening 30-min range + VWAP. When price stretches
--                ~1.5+ ATR beyond the band on weak momentum, buy the reverting
--                side (puts into an upside stretch, calls into a downside one),
--                target VWAP, tight time-stop. Wants quiet, rangey, high-IV days.
--
--  THE BREAKOUT  Same opening range. On a decisive break-and-hold of the high
--                (or low) with expanding volume, buy in the break's direction
--                and ride with a trailing stop. Fewer trades, bigger swings.
--                Wants trend/expansion days — the exact opposite of The Fade,
--                which is why you'd solo one and mute the other by regime.
--
--  POWER HOUR    Idle until 15:00 ET. Then take a single directional 0DTE lean
--                off the day's structure (where's VWAP, who won the day). High
--                aggression, tiny position count, gamma cuts both ways fast.
--                Force-flatten everything before 15:58 ET — no overnight on 0DTE.
--
--  THE GRINDER   High-frequency small edges in liquid mid-day tape. Smallest
--                size-per-trade, widest contract allowance, tightest stops.
--                Death by spread is the risk here — limit orders only, and it
--                should mute itself when quote latency or spreads blow out.
-- ============================================================================
