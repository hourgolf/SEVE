-- Opt-in manager support only. No roster, trade, quote or historical row is
-- changed. Activation remains a separately receipt-bound after-close action.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.positions
  add column if not exists profit_protection_armed_at timestamptz,
  add column if not exists profit_protection_exit_required_at timestamptz;

do $protection$
declare
  definition text;
  before_fields text := $needle$'retainGainPct', 'fixedTargetPct', 'postBankFloor'$needle$;
  after_fields text := $needle$'retainGainPct', 'fixedTargetPct', 'postBankFloor', 'profitProtection'$needle$;
  anchor text := $needle$  if jsonb_typeof(p_evidence_refs) <> 'array'$needle$;
  guard text := $guard$  -- momo-profit-protection-v1: a single exact additive manager payload.
  if p_proposed_patch -> 'ratchetParameters' ? 'profitProtection' then
    if p_proposed_spec ->> 'slug' is distinct from 'momo-shape-2'
        or p_proposed_spec -> 'quantity' is distinct from '2'::jsonb
        or p_proposed_patch ->> 'managerProfileId' is distinct from 'MOMO-B30-R50-K67-P15-F5'
        or p_proposed_patch -> 'takeProfit' is distinct from '{"kind":"bank","fraction":0.5,"targetPct":30}'::jsonb
        or p_proposed_patch -> 'stopLoss' is distinct from '{"catastrophePct":30,"priceBasis":"executable-option-bid"}'::jsonb
        or p_proposed_patch -> 'ratchetParameters' is distinct from '{"kind":"a13","engageReturnPct":50,"givebackPct":33,"retainGainPct":67,"fixedTargetPct":null,"profitProtection":{"version":"profit-protection-v1","armReturnPct":15,"floorReturnPct":5}}'::jsonb then
      raise exception 'unsupported Momo profit-protection policy';
    end if;
  end if;
$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.create_channel_manager_policy_proposal_draft(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
  ) into definition;
  if strpos(definition, 'momo-profit-protection-v1:') = 0 then
    if strpos(definition, before_fields) = 0 or strpos(definition, anchor) = 0 then
      raise exception 'profit protection migration: proposal validator anchors differ';
    end if;
    definition := replace(definition, before_fields, after_fields);
    definition := replace(definition, anchor, guard || anchor);
    execute definition;
  end if;
end;
$protection$;

comment on column public.positions.profit_protection_armed_at is
  'Durable first qualifying +15% executable-bid observation for the opt-in receipt-bound Momo manager. Null for historical managers.';
comment on column public.positions.profit_protection_exit_required_at is
  'Durable +5% retreat exit latch; retained across retries and partial-fill remainders until broker-confirmed closure.';
commit;
