import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'seve-publisher-fixture-'));
const preload=join(dir,'transport.mjs');
writeFileSync(preload,`
import fs from 'node:fs';
const RealDate=Date;const ms=RealDate.parse(process.env.FIXTURE_TIME);
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[ms]));} static now(){return ms;}};
const runId='remote-morning-publisher-v1:2026-09-14:2026-09-15';
let rows=JSON.parse(process.env.FIXTURE_ROWS||'[]');
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url);const method=init?.method??'GET';
 if(u.origin!=='https://publisher-fixture.invalid')throw Error('External network prohibited');
 if(method==='POST'){
  const body=JSON.parse(init.body);rows.push({...body,created_at:new RealDate(ms).toISOString()});
  fs.appendFileSync(process.env.FIXTURE_RECORD,JSON.stringify(body)+'\\n');
  return new Response(null,{status:201});
 }
 if(method!=='GET')throw Error('Unexpected method');
 const data=u.pathname.endsWith('/forensics_reports')
  ? [{report_date:'2026-09-14',generated_at:'2026-09-14T20:30:00Z',payload:{generatedAt:'2026-09-14T20:30:00Z'}}]
  : u.searchParams.has('meta') ? rows : rows.filter(r=>r.message.startsWith('sentinel:'));
 return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','content-range':data.length?'0-'+(data.length-1)+'/'+data.length:'*/0'}});
};
`);
const baseMeta={publisherRunId:'remote-morning-publisher-v1:2026-09-14:2026-09-15',targetSession:'2026-09-15',evidenceSession:'2026-09-14'};
const start={message:'morning-publisher: start',created_at:'2026-09-15T12:00:00Z',meta:baseMeta};
const sentinel={message:'sentinel: 2026-09-14',created_at:'2026-09-15T12:00:01Z',meta:{...baseMeta,publisherVersion:'remote-morning-publisher-v1',session:'2026-09-14',forDate:'2026-09-15'}};
const finish={message:'morning-publisher: finish',created_at:'2026-09-15T12:00:02Z',meta:baseMeta};
function run(name:string,time:string,rows:unknown[]=[],args:string[]=[]){
 const record=join(dir,name+'.jsonl');writeFileSync(record,'');
 const r=spawnSync(process.execPath,['--import',preload,'--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('./remote-morning-publisher.ts',import.meta.url)),...args],{
  env:{PATH:process.env.PATH??'',SUPABASE_URL:'https://publisher-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',FIXTURE_TIME:time,FIXTURE_RECORD:record,FIXTURE_ROWS:JSON.stringify(rows)},encoding:'utf8',timeout:15000});
 if(r.error)throw r.error;
 return {status:r.status,output:r.stdout+r.stderr,writes:readFileSync(record,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s))};
}
const early=run('early','2026-09-15T10:59:00Z');assert.equal(early.status,0,early.output);assert.equal(early.writes.length,0);assert.match(early.output,/not-yet-due/);
const late=run('late','2026-09-15T16:48:00Z');assert.equal(late.status,1,late.output);assert.match(late.output,/missed-window/);assert.ok(late.writes.every(r=>r.message==='morning-publisher: error'));
const good=run('good','2026-09-15T12:15:00Z');assert.equal(good.status,0,good.output);assert.deepEqual(good.writes.map(r=>r.message),['morning-publisher: start','sentinel: 2026-09-14','morning-publisher: finish']);
const again=run('again','2026-09-15T16:48:00Z',[start,sentinel,finish]);assert.equal(again.status,0,again.output);assert.equal(again.writes.length,0);assert.match(again.output,/already-published/);
const broken=run('broken','2026-09-15T12:15:00Z',[finish]);assert.equal(broken.status,1,broken.output);assert.ok(broken.writes.every(r=>r.message==='morning-publisher: error'));
const forced=run('forced','2026-09-15T16:48:00Z',[],['--force-window']);assert.equal(forced.status,1);assert.equal(forced.writes.length,0);
console.log('publisher CLI: early, missed deadline, full publication, retry, incomplete finish and forbidden clock bypass passed with in-memory transport');
