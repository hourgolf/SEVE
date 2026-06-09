-- ============================================================================
--  29_push_subscriptions.sql — web-push subscriptions for manual-exit alerts.
--  Stores each installed-PWA browser's PushSubscription so /api/push-send can
--  notify the operator when a `-manual` twin opens a position. Written by
--  /api/push-subscribe (service-role); read by /api/push-send (service-role).
-- ============================================================================

create table if not exists push_subscriptions (
  endpoint   text primary key,        -- the push service endpoint (unique per browser)
  sub        jsonb not null,          -- the full PushSubscription JSON (keys: p256dh, auth)
  created_at timestamptz not null default now()
);

-- Service-role only (the API routes use the service key); no anon access.
alter table push_subscriptions enable row level security;
