-- 40_forward_data_bucket.sql — durable forward-data backstop (data-capture-automation, 2026-06-19).
--
-- A private Supabase Storage bucket the always-on Railway worker writes to post-close: each COMPLETE
-- day's option_quotes (gz, format-identical to the local export-quotes archive) → quotes/<date>.json.gz.
-- This is the Mac-INDEPENDENT half of the data backstop — the local launchd capture only covers Mac
-- death IF the Mac was running to capture; this covers the Mac being off/dead past the 7d DB prune.
--
-- Private (public=false): no anon read. The worker writes with the service-role key, which BYPASSES
-- Storage RLS, so no storage.objects policies are needed; the operator downloads via dashboard auth.
-- See worker/src/archive.ts + docs/data-capture.md. APPLIED via MCP 2026-06-19.

insert into storage.buckets (id, name, public)
values ('forward-data', 'forward-data', false)
on conflict (id) do nothing;