// GET-only, credential-safe inventory for the first post-release session.
import {createServerSupabaseClient} from './serverSupabase';
import {loadStoredReceiptBoundControlPlane} from '@/lib/channels/channelControlPlanePersistence';
import {resolveStoredRc54OperationalAuthority} from './ops/activeOperationalContract';
import {summarizeSessionLifecycle} from '@/lib/ops/sessionLifecycleEvidence';
const dateIndex=process.argv.indexOf('--date');
const day=dateIndex>=0?process.argv[dateIndex+1]:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(!/^\d{4}-\d{2}-\d{2}$/.test(day??''))throw Error('Expected --date YYYY-MM-DD');
const url=new URL(process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL!);
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(u.origin!==url.origin||(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase()!=='GET')throw Error('GET-only session inventory');
 return realFetch(input,init);
};
async function main(){
 const sb=createServerSupabaseClient('session-lifecycle-evidence');
 const authority=resolveStoredRc54OperationalAuthority(await loadStoredReceiptBoundControlPlane(sb as any));
 if(!authority.runtime)throw Error('No receipt-bound runtime authority');
 async function rows(table:string,columns:string,clock:string){
  const all:any[]=[];let expected:number|null=null;
  for(let from=0;;from+=500){
   // UTC dates cover all regular-session US option trading; observations outside
   // RTH remain evidence, never a reconstructed trading-clock authorization.
   const end=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString();
   const r=await sb.from(table).select(columns,{count:'exact'}).gte(clock,day+'T00:00:00Z').lt(clock,end).order('id').range(from,from+499);
   if(r.error||r.count==null||!Array.isArray(r.data)||r.count>100000)throw Error(table+' inventory unavailable');
   if(expected===null)expected=r.count;
   if(r.count!==expected||r.data.length!==Math.min(500,Math.max(0,expected-from)))throw Error(table+' changed or truncated; retry inventory');
   all.push(...r.data);if(all.length===expected)break;
  }if(new Set(all.map(r=>r.id)).size!==all.length)throw Error(table+' duplicate inventory');return all;
 }
 const [positions,observations,managers]=await Promise.all([
  rows('positions','id,strategist_id,status,runner_of,closed_at,realized_pnl,channel_spec_version_id,release_manifest_id,configuration_epoch_id','opened_at'),
  rows('execution_observations','id,channel_slug,position_id,event_kind,action,reason,trace_id,channel_spec_version_id,release_manifest_id','event_at'),
  rows('manager_shadow_runs','id,position_id,status','entry_at')]);
 const channels=authority.runtime.roots.map(r=>({slug:r.slug,strategistId:r.strategistId,posture:r.executionPosture}));
 const results=summarizeSessionLifecycle({channels,positions,observations,managers});
 console.log(JSON.stringify({observedAt:new Date().toISOString(),session:day,productionWrites:0,results},null,2));
 if(results.some(r=>r.state==='needs-review'))process.exitCode=1;
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1});
