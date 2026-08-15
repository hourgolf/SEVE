-- Keep immutable raw block reasons while allowing receipt-bound release
-- prefixes to evolve. Eligibility is classified by the versioned research
-- adapter; the database protects shape, not a stale enum snapshot.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.vb_candidate_receipts
  drop constraint if exists vb_candidate_receipts_blocked_reason_check;

alter table public.vb_candidate_receipts
  add constraint vb_candidate_receipts_blocked_reason_check
  check (length(blocked_reason) between 1 and 160);

comment on column public.vb_candidate_receipts.blocked_reason is
  'Immutable source reason. Versioned research code classifies stable semantics; this table does not authorize execution.';

commit;
