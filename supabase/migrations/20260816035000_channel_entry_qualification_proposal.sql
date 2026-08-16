-- Permit one receipt-bound ORB entry qualification through the existing
-- governed re-entry proposal seam. This does not activate a proposal, mutate
-- an active manifest, grant client access, or touch broker/order state.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $entry_qualification$
declare
  function_identity regprocedure :=
    'public.create_channel_reentry_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure;
  definition text;
  updated text;
  old_comparison text := $old$      or (p_proposed_spec -> 'entryParameters') - 'maxEntriesPerSession'
        is distinct from base_row.entry_parameters - 'maxEntriesPerSession' then$old$;
  new_comparison text := $new$      or (p_proposed_spec -> 'entryParameters') - array[
          'maxEntriesPerSession', 'entryQualificationVersion',
          'entryStartEtMinute', 'standDownDayTags'
        ]
        is distinct from base_row.entry_parameters - array[
          'maxEntriesPerSession', 'entryQualificationVersion',
          'entryStartEtMinute', 'standDownDayTags'
        ] then$new$;
  validation_anchor text := $anchor$  if jsonb_typeof(p_proposed_spec) <> 'object'$anchor$;
  validation_block text := $block$  if p_proposed_patch -> 'entryParameters' ?| array[
      'entryQualificationVersion', 'entryStartEtMinute', 'standDownDayTags'
    ] then
    if base_row.channel_slug <> 'orb-ustop-ctl'
        or p_proposed_patch -> 'entryParameters' ->> 'entryQualificationVersion'
          <> 'orb-entry-qualification-v1'
        or jsonb_typeof(p_proposed_patch -> 'entryParameters' -> 'entryStartEtMinute')
          <> 'number'
        or (p_proposed_patch -> 'entryParameters' ->> 'entryStartEtMinute')::numeric
          <> trunc((p_proposed_patch -> 'entryParameters' ->> 'entryStartEtMinute')::numeric)
        or (p_proposed_patch -> 'entryParameters' ->> 'entryStartEtMinute')::integer
          not between 570 and 925
        or jsonb_typeof(p_proposed_patch -> 'entryParameters' -> 'standDownDayTags')
          <> 'array'
        or jsonb_array_length(p_proposed_patch -> 'entryParameters' -> 'standDownDayTags')
          not between 1 and 2
        or exists (
          select 1
          from jsonb_array_elements_text(
            p_proposed_patch -> 'entryParameters' -> 'standDownDayTags'
          ) tag
          where tag not in ('cpi', 'opex')
        )
        or (
          select count(*) <> count(distinct tag)
          from jsonb_array_elements_text(
            p_proposed_patch -> 'entryParameters' -> 'standDownDayTags'
          ) tag
        ) then
      raise exception 'governed entry qualification is malformed or outside orb-ustop-ctl';
    end if;
  elsif base_row.entry_parameters ?| array[
      'entryQualificationVersion', 'entryStartEtMinute', 'standDownDayTags'
    ] then
    raise exception 'governed entry qualification cannot be removed implicitly';
  end if;

  if jsonb_typeof(p_proposed_spec) <> 'object'$block$;
begin
  select pg_catalog.pg_get_functiondef(function_identity) into definition;

  updated := pg_catalog.replace(definition, old_comparison, new_comparison);
  if updated = definition then
    raise exception 'entry qualification comparison patch did not match current function';
  end if;

  definition := updated;
  updated := pg_catalog.replace(definition, validation_anchor, validation_block);
  if updated = definition then
    raise exception 'entry qualification validation patch did not match current function';
  end if;

  execute updated;
end;
$entry_qualification$;

revoke all on function public.create_channel_reentry_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_channel_reentry_proposal_draft(
  uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text,
  jsonb, jsonb, jsonb, timestamptz
) to service_role;

commit;
