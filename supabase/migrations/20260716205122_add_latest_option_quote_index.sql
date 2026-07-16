-- Supports the live "latest snapshot for one underlying" read without sorting
-- the full underlying partition across expirations. The old index begins with
-- (underlying, expiration), so it cannot satisfy this global time order.
create index if not exists idx_oq_underlying_captured_at
  on public.option_quotes (underlying, captured_at desc);
