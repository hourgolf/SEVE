-- Version the durable observer without rewriting v1 evidence. Admission is now
-- independent of quote eligibility; first-quote clocks are filled only when a
-- qualifying executable bid actually advances the manager.
alter table public.manager_shadow_runs
  drop constraint if exists manager_shadow_runs_schema_version_check,
  drop constraint if exists manager_shadow_runs_minimum_modeled_qty_check;

alter table public.manager_shadow_runs
  add constraint manager_shadow_runs_schema_version_check
    check (schema_version in (1, 2)),
  add constraint manager_shadow_runs_minimum_modeled_qty_check
    check (minimum_modeled_qty in (2, 4)),
  add column admission_source text,
  add column admitted_at timestamptz,
  add column admission_delay_ms integer,
  add column first_quote_at timestamptz,
  add column first_quote_event_age_ms integer,
  add column first_snapshot_fetch_age_ms integer,
  add column evidence_state text;

alter table public.manager_shadow_runs
  add constraint manager_shadow_runs_v2_admission_check check (
    shadow_book_version <> 'manager-shadow-book-v2'
    or (
      schema_version = 2
      and admission_source in ('fill_hook', 'recovery_open', 'recovery_closed', 'hydration')
      and admitted_at is not null
      and admitted_at >= entry_at
      and admission_delay_ms = round(extract(epoch from (admitted_at - entry_at)) * 1000)::integer
      and admission_delay_ms >= 0
      and evidence_state in ('pending_quote', 'observing', 'no_eligible_quote_before_actual_close')
      and (
        (first_quote_at is null and first_quote_event_age_ms is null and first_snapshot_fetch_age_ms is null)
        or
        (first_quote_at is not null and first_quote_event_age_ms >= 0 and first_snapshot_fetch_age_ms >= 0)
      )
      and (evidence_state <> 'pending_quote' or first_quote_at is null)
      and (evidence_state <> 'observing' or first_quote_at is not null)
      and (
        evidence_state <> 'no_eligible_quote_before_actual_close'
        or (actual_close_at is not null and first_quote_at is null)
      )
    )
  ) not valid;

alter table public.manager_shadow_runs
  validate constraint manager_shadow_runs_v2_admission_check;

comment on column public.manager_shadow_runs.admission_source is
  'v2 observer admission provenance; never an execution instruction.';
comment on column public.manager_shadow_runs.first_quote_event_age_ms is
  'Provider quote-event age at first eligible advancement.';
comment on column public.manager_shadow_runs.first_snapshot_fetch_age_ms is
  'Age of the completed targeted snapshot at first eligible advancement.';
