/** Offline integration test: production report source bundled against SELECT-only fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import positions from '../lib/reporting/fixtures/september16.json';
import { validatedNarrative } from '../supabase/functions/_shared/reportingEvidence';
import { HISTORICAL_SCHEMA, validateHistoricalManifest, type HistoricalManifest } from '../supabase/functions/_shared/historicalAttribution';
import { historicalDigest } from '../supabase/functions/_shared/historicalReporting';

type Row = Record<string, any>;
const accountFor = (slug: string) => /macd|vwap/.test(slug) ? 'paper2' : /pb-ride|orb-trend/.test(slug) ? 'paper3' : 'paper1';
const tables: Record<string, Row[]> = {
  positions,
  execution_observations: positions.map((p,i)=>({id:'route-'+i,position_id:p.id,account_id:accountFor(p.slug),event_at:p.closed_at})),
  strategists: [...new Map(positions.map(p=>[p.slug,{id:p.slug,slug:p.slug,name:p.slug,status:'draft',mandate:'Historical fixture',strategist_config:{}}])).values()],
  accounts: ['paper1','paper2','paper3'].map(id=>({id,mode:'paper'})),
  fund_state:[{id:1,mode:'paper'}], signals:[],events:[],underlying_bars:[],daily_reports:[], equity_snapshots:[],
};
function from(table: string) {
  assert.ok(table in tables,'Unexpected table '+table);
  let rows=[...tables[table]], cols='*';
  const chain: any = {
    select(c:string){cols=c;return chain},
    gte(k:string,v:string){rows=rows.filter(r=>r[k]!=null&&String(r[k])>=v);return chain},
    lte(k:string,v:string){rows=rows.filter(r=>r[k]!=null&&String(r[k])<=v);return chain},
    lt(k:string,v:string){rows=rows.filter(r=>r[k]!=null&&String(r[k])<v);return chain},
    eq(k:string,v:any){rows=rows.filter(r=>r[k]===v);return chain},
    is(k:string,v:any){rows=rows.filter(r=>(r[k]??null)===v);return chain},
    in(k:string,v:any[]){rows=rows.filter(r=>v.includes(r[k]));return chain},
    not(k:string,_op:string,v:any){rows=rows.filter(r=>r[k]!==v);return chain},
    order(k:string,o:{ascending?:boolean}={}){rows.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(o.ascending===false?-1:1));return chain},
    range(a:number,b:number){rows=rows.slice(a,b+1);return chain},limit(n:number){rows=rows.slice(0,n);return chain},
    maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null})},
    then(resolve:any,reject:any){const data=rows.map(row=>cols==='*'?row:Object.fromEntries(cols.split(/,(?![^()]*\))/).map(k=>{const key=k.split('(')[0];return[key,row[key]]})));return Promise.resolve({data,error:null}).then(resolve,reject)},
  };
  return chain;
}
async function loadProducer(kind:'daily'|'weekly') {
  const dir=path.resolve('supabase/functions/'+kind+'-autopsy');
  const source=fs.readFileSync(path.join(dir,'index.ts'),'utf8')
    .replace(`async function ${kind==='daily'?'buildDigest':'buildWeekly'}(`,`export async function ${kind==='daily'?'buildDigest':'buildWeekly'}(`)
    .replace('function renderSkeleton(', 'export function renderSkeleton(');
  const bundle=await build({stdin:{contents:source,resolveDir:dir,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'read-only-fixture',setup(b){b.onResolve({filter:/^jsr:/},()=>({path:'supabase',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const createClient=()=>globalThis.testDatabase;',loader:'js'}))}}]});
  const context={module:{exports:{} as any},exports:{},console,Response,Intl,Date,Deno:{env:{get:()=>undefined},serve:()=>{}},testDatabase:{from}};
  vm.createContext(context);vm.runInContext(bundle.outputFiles[0].text,context);
  return context.module.exports;
}
async function main(){
  // SQL clocks in the source fixture are normalized to ISO for the mock's lexical filters.
  for(const p of tables.positions)for(const k of ['opened_at','closed_at'])p[k]=new Date(p[k]).toISOString();
  const daily=await loadProducer('daily');
  const digest=await daily.buildDigest('2026-09-16');
  assert.equal(digest.fund.trades,8);assert.equal(digest.fund.dayRealized,518);assert.equal(digest.fund.winRate,.75);
  assert.equal(digest.evidence.positionRows,9);assert.equal(digest.evidence.runnerRowsCollapsed,1);
  assert.equal(digest.peakDiagnostic.valid,5);assert.equal(digest.peakDiagnostic.excluded,3);
  assert.ok(Math.abs(digest.peakDiagnostic.retainedPct-21.78571428571428)<1e-8);
  const trades=digest.channels.flatMap((c:Row)=>c.trades);
  assert.equal(trades.flatMap((t:Row)=>t.exitProvenance).filter((p:Row)=>p.source==='positions.close_reason').length,9);
  tables.daily_reports=[{report_date:'2026-09-16',mode:'paper',digest}];
  tables.equity_snapshots=tables.accounts.flatMap((a,i)=>[0,1].map(j=>({account_id:a.id,net_liquidation:10000+i*100+j*10,captured_at:`2026-09-16T${j?'20:05':'13:30'}:00.000Z`})));
  const weekly=await loadProducer('weekly');
  // Public synthetic fixture exercises historical null handling without exposing
  // the private broker audit in the public Git repository.
  const historicalManifest:HistoricalManifest={schema:HISTORICAL_SCHEMA,version:'synthetic-report-fixture',from:'2026-06-01',through:'2026-09-16',
    positions:[{id:'matched'},{id:'unresolved'}],strategistIds:{fixture:'fixture-id'},brokerOnly:[],records:[
      {rootPositionId:'matched',positionIds:['matched'],slug:'fixture',occ:'SYNTHETIC',openedAt:'2026-06-08T13:35:00Z',closedAt:'2026-06-08T14:00:00Z',qty:1,brokerAccountId:'paper1',state:'broker_reconstructed',reasons:[],ledgerGross:50,reconstructedGross:40,buyOrderIds:['buy-1'],sellOrderIds:['sell-1'],policyIdentityComplete:false,entryPrice:1,identitySources:[]},
      {rootPositionId:'unresolved',positionIds:['unresolved'],slug:'fixture',occ:'SYNTHETIC',openedAt:'2026-06-08T14:05:00Z',closedAt:'2026-06-08T14:10:00Z',qty:1,brokerAccountId:null,state:'unresolved',reasons:['missing_broker_economics'],ledgerGross:10,reconstructedGross:null,buyOrderIds:[],sellOrderIds:[],policyIdentityComplete:false,entryPrice:1,identitySources:[]},
    ]};
  const audited=validateHistoricalManifest(historicalManifest,historicalManifest.positions,[],new Date().toISOString());
  const juneDaily=historicalDigest(audited,'2026-06-08','2026-06-08','daily');
  const juneWeekly=historicalDigest(audited,'2026-06-08','2026-06-12','weekly');
  assert.equal(juneDaily.evidence.historicalAttribution.unresolvedTrades>0,true);
  assert.match(daily.renderSkeleton(juneDaily),/broker|realized attribution/i);
  assert.match(weekly.renderSkeleton(juneWeekly),/unavailable/);
  assert.doesNotMatch(weekly.renderSkeleton(juneWeekly),/\$NaN|undefined/);
  const week=await weekly.buildWeekly('2026-09-18');
  assert.equal(week.fund.trades,8);assert.equal(week.fund.realized,518);assert.equal(week.fund.winRate,.75);
  assert.equal(week.exitEfficiency.totalUpsideLeft,null);assert.equal(week.fund.wins,6);
  for(const c of week.channels){const results=trades.filter((t:Row)=>digest.channels.find((d:Row)=>d.slug===c.slug)?.trades.includes(t)).map((t:Row)=>t.pnl);if(results.length){assert.equal(c.metrics.bestTrade,Math.round(Math.max(...results)));assert.equal(c.metrics.worstTrade,Math.round(Math.min(...results)));}}
  for(const c of week.channels)if(c.exitEfficiency.peakDiagnostic.valid===0)assert.equal(c.exitEfficiency.captureRatio,null);
  tables.equity_snapshots=[];
  const noNav=await weekly.buildWeekly('2026-09-18');
  assert.equal(noNav.fund.realized,518);assert.equal(noNav.fund.navDelta,null);assert.equal(noNav.fund.maxDrawdown,null);
  assert.match(noNav.evidence.navIssue,/account-complete equity snapshots missing/);
  tables.daily_reports[0].digest={...digest,evidence:{...digest.evidence,producerVersion:'legacy'}};
  await assert.rejects(()=>weekly.buildWeekly('2026-09-18'),/require regeneration/);
  assert.equal(validatedNarrative({weekSummary:'broken </parameter>',channels:[]},'weekly'),null);
  assert.ok(validatedNarrative({weekSummary:'Valid limited study.',channels:[],keyLearnings:[]},'weekly'));
  console.log('dashboard-reporting-regression: PASS (8 roots, 9 rows, 6 wins, +518 gross, 3 peak exclusions; daily/weekly parity; legacy refusal; no network or writes)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
