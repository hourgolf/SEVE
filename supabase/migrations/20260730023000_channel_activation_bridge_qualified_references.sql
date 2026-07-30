-- Qualify activation-bridge column references that collide with RETURNS TABLE
-- output-variable names in PL/pgSQL. This correction is idempotent and changes
-- no tables, data, permissions, authority, or runtime configuration.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $correction$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.prepare_channel_change_proposal_preview(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    E'from public.channel_activation_previews\n  where proposal_id = p_proposal_id;',
    E'from public.channel_activation_previews as preview_by_proposal\n  where preview_by_proposal.proposal_id = p_proposal_id;'
  );
  if corrected_definition = function_definition
      and pg_catalog.strpos(
        function_definition,
        'preview_by_proposal.proposal_id = p_proposal_id'
      ) = 0 then
    raise exception 'prepare preview ambiguity correction did not match';
  end if;
  execute corrected_definition;

  select pg_catalog.pg_get_functiondef(
    'public.acknowledge_channel_change_proposal_preview(uuid,uuid,uuid,text,timestamp with time zone,text,jsonb)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    E'from public.channel_activation_worker_acknowledgements\n  where proposal_id = preview.proposal_id\n    and source_boot_id = p_source_boot_id;',
    E'from public.channel_activation_worker_acknowledgements as acknowledgement_by_worker\n  where acknowledgement_by_worker.proposal_id = preview.proposal_id\n    and acknowledgement_by_worker.source_boot_id = p_source_boot_id;'
  );
  if corrected_definition = function_definition
      and pg_catalog.strpos(
        function_definition,
        'acknowledgement_by_worker.proposal_id = preview.proposal_id'
      ) = 0 then
    raise exception 'worker acknowledgement ambiguity correction did not match';
  end if;
  execute corrected_definition;

  select pg_catalog.pg_get_functiondef(
    'public.activate_channel_change_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    E'from public.activation_receipts\n  where proposal_id = p_proposal_id;',
    E'from public.activation_receipts as receipt_by_proposal\n  where receipt_by_proposal.proposal_id = p_proposal_id;'
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    E'from public.channel_activation_approvals\n    where proposal_id = p_proposal_id;',
    E'from public.channel_activation_approvals as approval_by_proposal\n    where approval_by_proposal.proposal_id = p_proposal_id;'
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    E'from public.channel_activation_previews\n  where id = p_preview_id\n    and proposal_id = p_proposal_id;',
    E'from public.channel_activation_previews as preview_by_id\n  where preview_by_id.id = p_preview_id\n    and preview_by_id.proposal_id = p_proposal_id;'
  );
  if pg_catalog.strpos(
      corrected_definition,
      'receipt_by_proposal.proposal_id = p_proposal_id'
    ) = 0
      or pg_catalog.strpos(
        corrected_definition,
        'approval_by_proposal.proposal_id = p_proposal_id'
      ) = 0
      or pg_catalog.strpos(
        corrected_definition,
        'preview_by_id.proposal_id = p_proposal_id'
      ) = 0 then
    raise exception 'atomic activation ambiguity correction did not match';
  end if;
  execute corrected_definition;
end;
$correction$;

commit;
