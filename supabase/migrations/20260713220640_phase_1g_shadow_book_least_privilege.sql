-- Phase 1G follow-up: older/default public-schema privileges can leave the
-- service role with TRUNCATE, REFERENCES, and TRIGGER in addition to the CRUD
-- operations the observation worker actually uses. Reduce the table grant to
-- the explicit minimum; service_role still bypasses RLS for these operations.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all on public.manager_shadow_runs from service_role;
grant select, insert, update, delete on public.manager_shadow_runs to service_role;

commit;
