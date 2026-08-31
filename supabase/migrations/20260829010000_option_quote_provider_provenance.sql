-- Additive evidence provenance for prospective option-chain research.
-- Existing rows intentionally remain NULL: collector receipt time must not be
-- represented as an option-provider timestamp after the fact.

alter table public.option_quotes
  add column if not exists provider text,
  add column if not exists option_feed text,
  add column if not exists request_started_at timestamptz,
  add column if not exists request_completed_at timestamptz,
  add column if not exists observed_at timestamptz,
  add column if not exists provider_quote_at timestamptz,
  add column if not exists provider_trade_at timestamptz,
  add column if not exists quote_conditions jsonb,
  add column if not exists trade_conditions jsonb,
  add column if not exists underlying_feed text,
  add column if not exists underlying_source text,
  add column if not exists underlying_provider_at timestamptz,
  add column if not exists underlying_observed_at timestamptz,
  add column if not exists greeks_provider_at timestamptz,
  add column if not exists greeks_observed_at timestamptz,
  add column if not exists greeks_provenance text,
  add column if not exists contract_multiplier numeric,
  add column if not exists contract_metadata_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'option_quotes_provenance_nonempty'
      and conrelid = 'public.option_quotes'::regclass
  ) then
    alter table public.option_quotes
      add constraint option_quotes_provenance_nonempty check (
        (provider is null or btrim(provider) <> '')
        and (option_feed is null or btrim(option_feed) <> '')
        and (underlying_feed is null or btrim(underlying_feed) <> '')
        and (underlying_source is null or btrim(underlying_source) <> '')
        and (greeks_provenance is null or btrim(greeks_provenance) <> '')
        and (contract_metadata_source is null or btrim(contract_metadata_source) <> '')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'option_quotes_request_order'
      and conrelid = 'public.option_quotes'::regclass
  ) then
    alter table public.option_quotes
      add constraint option_quotes_request_order check (
        request_started_at is null
        or request_completed_at is null
        or request_completed_at >= request_started_at
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'option_quotes_contract_multiplier_positive'
      and conrelid = 'public.option_quotes'::regclass
  ) then
    alter table public.option_quotes
      add constraint option_quotes_contract_multiplier_positive check (
        contract_multiplier is null or contract_multiplier > 0
      );
  end if;
end $$;

comment on column public.option_quotes.provider is
  'Market-data provider for this snapshot row. NULL means provenance was not retained.';
comment on column public.option_quotes.option_feed is
  'Provider option feed requested by the collector (for example opra or indicative).';
comment on column public.option_quotes.provider_quote_at is
  'Provider timestamp attached to latestQuote. Never synthesized from captured_at.';
comment on column public.option_quotes.provider_trade_at is
  'Provider timestamp attached to latestTrade. Never synthesized from captured_at.';
comment on column public.option_quotes.greeks_provider_at is
  'Provider timestamp for Greeks when explicitly supplied; NULL means unknown.';
comment on column public.option_quotes.greeks_observed_at is
  'Collector completion time when the unstamped provider snapshot Greeks were observed.';
comment on column public.option_quotes.greeks_provenance is
  'Explicit statement of how Greeks timing/provenance is known or remains unknown.';
comment on column public.option_quotes.contract_multiplier is
  'Authoritative contract multiplier only when paired with contract_metadata_source; not inferred.';
