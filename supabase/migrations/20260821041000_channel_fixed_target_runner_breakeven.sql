-- Admit an optional receipt-bound post-bank breakeven floor for split runners.
-- The floor is valid only for a half-bank policy whose runner is governed by
-- A13 or an explicit fixed target. This migration changes no proposal,
-- manifest, runtime, route, historical evidence, position, or order.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $fixed_target_runner_breakeven$
declare
  function_definition text;
  corrected_definition text;
  allowed_fields_before text := $needle$where field not in (
          'kind', 'engageReturnPct', 'givebackPct',
          'retainGainPct', 'fixedTargetPct'
        )$needle$;
  allowed_fields_after text := $replacement$where field not in (
          'kind', 'engageReturnPct', 'givebackPct',
          'retainGainPct', 'fixedTargetPct', 'postBankFloor'
        )$replacement$;
  validation_anchor text := $needle$or (
        p_proposed_patch -> 'ratchetParameters' ->> 'kind'
          in ('none', 'native-atr')$needle$;
  validation_replacement text := $replacement$or (
        p_proposed_patch -> 'ratchetParameters' ? 'postBankFloor'
        and (
          p_proposed_patch -> 'ratchetParameters' ->> 'postBankFloor'
            not in ('none', 'breakeven')
          or (
            p_proposed_patch -> 'ratchetParameters' ->> 'postBankFloor'
              = 'breakeven'
            and (
              p_proposed_patch -> 'takeProfit' ->> 'kind' <> 'bank'
              or (p_proposed_patch -> 'takeProfit' ->> 'fraction')::numeric
                <> 0.5
              or p_proposed_patch -> 'ratchetParameters' ->> 'kind'
                not in ('a13', 'fixed-target')
            )
          )
        )
      )
      or (
        p_proposed_patch -> 'ratchetParameters' ->> 'kind'
          in ('none', 'native-atr')$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_channel_manager_policy_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
  ) into function_definition;

  if pg_catalog.strpos(function_definition, allowed_fields_before) = 0
      and pg_catalog.strpos(function_definition, allowed_fields_after) = 0 then
    raise exception 'fixed-target runner migration could not find the ratchet field allowlist';
  end if;
  if pg_catalog.strpos(function_definition, validation_anchor) = 0
      and pg_catalog.strpos(function_definition, validation_replacement) = 0 then
    raise exception 'fixed-target runner migration could not find the validation anchor';
  end if;

  corrected_definition := pg_catalog.replace(
    function_definition,
    allowed_fields_before,
    allowed_fields_after
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    validation_anchor,
    validation_replacement
  );

  if pg_catalog.strpos(corrected_definition, allowed_fields_after) = 0
      or pg_catalog.strpos(corrected_definition, validation_replacement) = 0 then
    raise exception 'fixed-target runner migration did not install both validation guards';
  end if;

  execute corrected_definition;
end;
$fixed_target_runner_breakeven$;

commit;
