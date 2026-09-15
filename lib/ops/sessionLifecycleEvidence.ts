/** Read-only evidence inventory. Presence is never promoted to verified fills. */
export interface LifecyclePosition {id:string;strategist_id:string;status:string;runner_of:string|null;closed_at:string|null;realized_pnl:number|null;channel_spec_version_id:string|null;release_manifest_id:string|null;configuration_epoch_id:string|null}
export interface LifecycleObservation {id:string;channel_slug:string;position_id:string|null;event_kind:string;action:string;reason:string;trace_id:string;channel_spec_version_id:string|null;release_manifest_id:string|null}
export function summarizeSessionLifecycle(input:{channels:readonly {slug:string;strategistId:string;posture:string}[];positions:readonly LifecyclePosition[];observations:readonly LifecycleObservation[];managers:readonly {position_id:string;status:string}[]}) {
 return input.channels.map(channel=>{
  const positions=input.positions.filter(p=>p.strategist_id===channel.strategistId),roots=positions.filter(p=>!p.runner_of);
  const observations=input.observations.filter(o=>o.channel_slug===channel.slug);
  const count=(kind:string,action?:string)=>observations.filter(o=>o.event_kind===kind&&(!action||o.action===action)).length;
  const attempts=observations.filter(o=>o.reason==='fixed_entry_admission:admission_attempted');
  const outcomes=new Set(observations.filter(o=>o.reason==='fixed_entry_admission:admission_result').map(o=>o.trace_id));
  const issues:string[]=[];
  if(positions.some(p=>!p.channel_spec_version_id||!p.release_manifest_id||!p.configuration_epoch_id))issues.push('position-attribution-missing');
  if(positions.some(p=>p.status==='closed'&&(!p.closed_at||p.realized_pnl===null)))issues.push('closed-position-incomplete');
  if(roots.some(p=>!input.managers.some(m=>m.position_id===p.id)))issues.push('manager-cohort-missing-or-pending');
  if(attempts.some(o=>!outcomes.has(o.trace_id)))issues.push('admission-outcome-missing-or-pending');
  return {slug:channel.slug,posture:channel.posture,state:issues.length?'needs-review':observations.length||positions.length?'evidence-present':'unexercised',
   issues,entryDecisions:count('decision','enter'),admissionAttempts:attempts.length,admissionOutcomes:outcomes.size,
   brokerEntryReceipts:count('broker_result','enter'),brokerExitReceipts:count('broker_result','exit'),
   rootTrades:roots.length,runnerRows:positions.length-roots.length,openRows:positions.filter(p=>p.status==='open').length,
   rootsWithManagerCohort:roots.filter(p=>input.managers.some(m=>m.position_id===p.id)).length,
   verification:'Broker quantities, fills, native exit semantics and final publication still require reconciliation; counts are not an end-to-end pass.'};
 });
}
