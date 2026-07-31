-- Admit an explicit all-out premium target in the immutable manager-policy
-- proposal path. A bank policy with fraction 0 means close the whole lot at
-- target; fraction 0.5 retains the existing half-bank/half-runner behavior.
-- This migration changes no proposal, manifest, runtime, route, or order.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $manager_all_out$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_channel_manager_policy_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
  ) into function_definition;

  corrected_definition := pg_catalog.replace(
    function_definition,
    '(p_proposed_patch -> ''takeProfit'' ->> ''fraction'')::numeric <> 0.5',
    '(p_proposed_patch -> ''takeProfit'' ->> ''fraction'')::numeric not in (0, 0.5)'
  );

  if corrected_definition = function_definition
      and pg_catalog.strpos(
        function_definition,
        '(p_proposed_patch -> ''takeProfit'' ->> ''fraction'')::numeric not in (0, 0.5)'
      ) = 0 then
    raise exception 'manager all-out policy correction did not match';
  end if;

  execute corrected_definition;
end;
$manager_all_out$;

commit;
