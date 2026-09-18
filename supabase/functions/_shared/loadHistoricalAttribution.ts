// Server/edge/script only. The frozen evidence remains in a private Storage object;
// public source and browser bundles contain only its path and checksum.
import { HISTORICAL_DATA_BUCKET, HISTORICAL_DATA_PATH, HISTORICAL_DATA_SHA256 } from './historicalAttributionData.ts';
import { SOURCE_FIELDS, validateHistoricalManifest, HISTORICAL_SCHEMA, type HistoricalManifest, type SourceRow, type HistoricalSnapshot } from './historicalAttribution.ts';
async function complete<T>(make:()=>any,label:string):Promise<T[]> {
  const result:T[]=[];let count:number|null=null;
  for(let n=0;n<200000;n+=500){
    const r=await make().range(n,n+499);
    if(r.error)throw Error(`${label}: ${r.error.message}`);
    if(!Number.isInteger(r.count)||r.count<0||r.count>200000||(count!=null&&count!==r.count))throw Error(`${label}: incomplete or changing evidence`);
    count=r.count;result.push(...(r.data??[]));
    if(result.length>=count!){if(result.length!==count)throw Error(`${label}: count mismatch`);return result;}
    if((r.data??[]).length<500)throw Error(`${label}: truncated evidence`);
  }
  throw Error(`${label}: read bound exceeded`);
}
let privateManifest:Promise<HistoricalManifest>|null=null;
async function loadPrivateManifest(sb:any):Promise<HistoricalManifest>{
  privateManifest??=(async()=>{
    const {data,error}=await sb.storage.from(HISTORICAL_DATA_BUCKET).download(HISTORICAL_DATA_PATH);
    if(error||!data)throw Error(`Private historical evidence unavailable: ${error?.message??'empty object'}`);
    const json=await data.text();
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json));
    const hex=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hex!==HISTORICAL_DATA_SHA256)throw Error('Private historical evidence hash mismatch');
    const parsed=JSON.parse(json) as HistoricalManifest;
    if(parsed.schema!==HISTORICAL_SCHEMA||parsed.version!=='20260916-broker-v1'||!Array.isArray(parsed.positions)||!Array.isArray(parsed.records)||!Array.isArray(parsed.brokerOnly))throw Error('Private historical evidence schema mismatch');
    return parsed;
  })();
  try{return await privateManifest;}catch(e){privateManifest=null;throw e;}
}
export async function loadHistoricalAttribution(sb:any):Promise<HistoricalSnapshot>{
  const historicalManifest=await loadPrivateManifest(sb);
  const positions=await complete<SourceRow>(()=>sb.from('positions').select(SOURCE_FIELDS.join(','),{count:'exact'}).order('id'),'historical source positions');
  const routes:{position_id:string|null;account_id:string|null}[]=[];
  for(let n=0;n<historicalManifest.positions.length;n+=100){
    const ids=historicalManifest.positions.slice(n,n+100).map(p=>p.id);
    routes.push(...await complete<{position_id:string|null;account_id:string|null}>(()=>sb.from('execution_observations').select('id,position_id,account_id',{count:'exact'}).in('position_id',ids).not('account_id','is',null).order('id'),'historical source routes'));
  }
  return validateHistoricalManifest(historicalManifest,positions,routes,new Date().toISOString());
}
