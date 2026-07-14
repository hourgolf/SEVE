-- Phase 1H capture v2: preserve SIP tape/exchange/sale-condition provenance
-- required to reconstruct Alpaca-compatible forming bars. Existing v1 receipts
-- remain valid and immutable; only the compact version check widens.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.intraminute_capture_receipts
  drop constraint intraminute_capture_receipts_schema_version_check,
  add constraint intraminute_capture_receipts_schema_version_check
    check (schema_version in (1, 2));

comment on column public.intraminute_capture_receipts.schema_version is
  'Raw R2 envelope version: v1 omitted SIP sale-condition provenance; v2 retains exchange, tape, and conditions.';

commit;
