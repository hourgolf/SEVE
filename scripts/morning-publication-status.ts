/** Independent GET-only deadline check; never publishes or repairs receipts. */
import {createServerSupabaseClient} from './serverSupabase';
import {isTradingDay,previousTradingDay} from '@/engine/market-calendar';
import {remoteMorningClock,remoteMorningRunId,REMOTE_MORNING_WINDOW_START_MIN,REMOTE_MORNING_WINDOW_END_MIN} from '@/lib/sentinel/remoteMorningPublisher';
import {auditMorningPublisherReceipt} from '@/lib/sentinel/morningPublisherReceipt';
async function main(){
 const now=Date.now(),clock=remoteMorningClock(now),evidence=previousTradingDay(clock.date);
 const runId=remoteMorningRunId(evidence,clock.date);
 const sb=createServerSupabaseClient('morning-publication-status');
 const r=await sb.from('events').select('message,created_at,meta',{count:'exact'}).contains('meta',{publisherRunId:runId}).order('created_at').limit(100);
 if(r.error||r.count==null||r.count!==r.data?.length)throw Error('Receipt inventory unavailable, changed or truncated');
 const audit=auditMorningPublisherReceipt({events:r.data,evidenceSession:evidence,targetSession:clock.date});
 const completed=audit.state==='complete'||audit.state==='recovered';
 const state=completed?'published':!isTradingDay(clock.date)?'closed-session':clock.minute<REMOTE_MORNING_WINDOW_START_MIN?'not-yet-due':clock.minute<=REMOTE_MORNING_WINDOW_END_MIN?'pending':'missed-deadline';
 console.log(JSON.stringify({observedAt:new Date(now).toISOString(),targetSession:clock.date,evidenceSession:evidence,state,audit,productionWrites:0}));
 if(state==='missed-deadline'||audit.state==='conflict')process.exitCode=1;
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1});
