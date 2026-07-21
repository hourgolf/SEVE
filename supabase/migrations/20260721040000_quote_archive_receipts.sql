-- Review-only until explicitly authorized. Compact verification receipts for
-- immutable, content-addressed complete-session option_quotes archives in R2.
-- These rows are research provenance only and never an execution source.

create table if not exists public.quote_archive_receipts (
  session_date_et date primary key,
  schema_version integer not null check (schema_version = 1),
  archive_version text not null check (archive_version = 'r2-option-quotes-v1'),
  object_key text not null unique,
  manifest_key text not null unique,
  row_count bigint not null check (row_count > 0),
  underlyings text[] not null,
  rows_by_underlying jsonb not null,
  first_captured_at timestamptz not null,
  last_captured_at timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_sha256 text not null check (compressed_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  compressed_bytes bigint not null check (compressed_bytes > 0),
  source text not null check (source = 'supabase.option_quotes'),
  completed_at timestamptz not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (first_captured_at <= last_captured_at)
);

alter table public.quote_archive_receipts enable row level security;
revoke all on public.quote_archive_receipts from anon, authenticated;
grant select, insert on public.quote_archive_receipts to service_role;

comment on table public.quote_archive_receipts is
  'Private compact verification receipts for immutable R2 option quote archives; never an execution instruction.';

-- Supports bounded complete-day traversal by configured underlying. This
-- migration remains review-only because index construction consumes IO.
create index if not exists idx_option_quotes_archive_keyset
  on public.option_quotes (underlying, captured_at, id);
