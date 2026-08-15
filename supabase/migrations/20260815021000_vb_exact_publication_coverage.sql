-- Make exact research receipts match the canonical opportunity identity and
-- retain every unscored manager arm as explicit censor evidence. This is
-- research-only metadata; no execution surface reads these columns.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.vb_candidate_receipts
  drop constraint if exists vb_candidate_receipts_opportunity_id_check;
alter table public.vb_candidate_receipts
  add constraint vb_candidate_receipts_opportunity_id_check
  check (opportunity_id ~ '^opp:[0-9a-f-]{36}$');

alter table public.vb_exact_path_receipts
  drop constraint if exists vb_exact_path_receipts_opportunity_id_check;
alter table public.vb_exact_path_receipts
  add constraint vb_exact_path_receipts_opportunity_id_check
  check (opportunity_id ~ '^opp:[0-9a-f-]{36}$');

alter table public.vb_candidate_receipts
  add column manager_paths_expected integer not null default 0 check (manager_paths_expected >= 0),
  add column manager_paths_published integer not null default 0 check (
    manager_paths_published >= 0 and manager_paths_published <= manager_paths_expected
  ),
  add column manager_censors jsonb not null default '[]'::jsonb check (jsonb_typeof(manager_censors) = 'array');

comment on column public.vb_candidate_receipts.manager_censors is
  'Explicit exact manager-arm censors, including no executable terminal bid and overlapping re-entry; never an inferred zero.';

commit;
