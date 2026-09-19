'use client';
import { useEffect, useMemo, useState } from 'react';
import { readHistoricalAttribution } from '@/lib/reporting/readHistoricalAttribution';
import { selectHistorical, historicalCoverageText, type HistoricalSnapshot } from '@/supabase/functions/_shared/historicalAttribution';
const dollar=(v:number|null)=>v==null?'unavailable':v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
/** One historical comparison for tape, performance, and roster review. */
export function HistoricalChannelEvidence({channel,accountId}:{channel?:string|null;accountId?:string|null}){
  const [snapshot,setSnapshot]=useState<HistoricalSnapshot|null>(null),[error,setError]=useState('');
  const [month,setMonth]=useState('all');
  useEffect(()=>{let alive=true;void readHistoricalAttribution().then(s=>{if(alive){setSnapshot(s);setError('');}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Historical evidence unavailable');});return()=>{alive=false;};},[]);
  const selection=useMemo(()=>snapshot?selectHistorical(snapshot,{from:month==='all'?undefined:month+'-01',through:month==='all'?undefined:month+'-31',accountId:accountId??undefined}):null,[snapshot,month,accountId]);
  const channels=useMemo(()=>snapshot?Object.keys(snapshot.strategistIds).sort().map(slug=>{
    const s=selectHistorical(snapshot,{from:month==='all'?undefined:month+'-01',through:month==='all'?undefined:month+'-31',slug,accountId:accountId??undefined});
    return {slug,s};
  }).filter(({slug})=>!channel||slug===channel):[],[snapshot,month,accountId,channel]);
  const shown=channel?[...channels].sort((a,b)=>Number(b.slug===channel)-Number(a.slug===channel)):channels;
  return <section className="rvw-history" aria-label="Audited historical channel results">
    <h3>Historical channel evidence</h3>
    {error&&<p role="alert">Audited comparison unavailable: {error}</p>}
    {!snapshot&&!error&&<p>Checking audited broker results…</p>}
    {selection&&<>
      <p>Scope: {accountId ? 'selected paper account' : 'all three audited paper accounts'}. {historicalCoverageText(selection)} {selection.unknownAccountTrades>0?'Some earlier trades could not be assigned to this account.':''}</p>
      <label>Period <select value={month} onChange={e=>setMonth(e.target.value)}>
        <option value="all">June–September 16</option>{['2026-06','2026-07','2026-08','2026-09'].map(m=><option key={m} value={m}>{m}</option>)}
      </select></label>
      <p>Original and reconstructed amounts compare the same matched trades. Unresolved trades and extra broker executions are shown separately. These paper results are before fees; entry and manager comparisons need separate evidence.</p>
      <div style={{overflowX:'auto'}}><table><thead><tr><th>Channel</th><th>Matched / recorded</th><th>Unresolved</th><th>Original, matched</th><th>Broker, matched</th><th>Positive</th><th>Extra broker trades</th></tr></thead><tbody>
        {shown.map(({slug,s})=><tr key={slug} style={slug===channel?{fontWeight:700}:{}}><td>{slug}</td><td>{s.reconstructedTrades} / {s.recordedTrades}</td><td>{s.unresolvedTrades}</td><td>{dollar(s.originalGrossMatched)}</td><td>{dollar(s.reconstructedGross)}</td><td>{s.reconstructedTrades?s.positiveTrades+'/'+s.reconstructedTrades:'unavailable'}</td><td>{s.brokerOnly.length?s.brokerOnly.length+' / '+dollar(s.brokerOnlyGross):'0 identified'}</td></tr>)}
      </tbody></table></div>
      {selection.issues.map(issue=><p key={issue} role="alert">{issue}</p>)}
    </>}
  </section>;
}
