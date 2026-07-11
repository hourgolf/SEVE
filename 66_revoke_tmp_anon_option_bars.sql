-- 66_revoke_tmp_anon_option_bars — drop the leftover TEMP anon write grants on option_bars.
-- These were added for a one-time historical backfill (see CLAUDE.md "revoke after") and never
-- removed, leaving the PUBLIC anon key able to INSERT/UPDATE option_bars. option_bars is research-
-- only (kept truncated in prod, off the money path) so blast radius is low, but this is an
-- unintended public write surface. Surfaced by the 2026-07-11 external-review schema pull.
-- Anon retains SELECT via the read policies; nothing on the trade path is affected.
drop policy if exists tmp_anon_ins_option_bars on public.option_bars;
drop policy if exists tmp_anon_write          on public.option_bars;
drop policy if exists tmp_anon_upd            on public.option_bars;
drop policy if exists tmp_anon_upd_option_bars on public.option_bars;
-- verify (should return zero rows):
-- select policyname from pg_policies where tablename='option_bars' and policyname like 'tmp%';
