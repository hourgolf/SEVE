"use client";
import "@/app/perform.css";
import "@/app/console.css";
import { useState } from 'react';
import positions from '@/lib/reporting/fixtures/september16.json';
import { heldTradePeakObservation, summarizePeakDiagnostics } from '@/supabase/functions/_shared/reportingEvidence';
import { collapseDailyLogicalTrades } from '@/supabase/functions/daily-autopsy/logicalTradeDigest';
import { ReviewSessionScorecard } from '@/components/perform/ReviewSessionScorecard';
import { DailyAutopsyBody } from '@/components/console/DailyAutopsyPanel';
import type { DailyReport } from '@/hooks/useDailyReports';
const accountFor=(slug:string)=>/macd|vwap/.test(slug)?'PAPER 2':/pb-ride|orb-trend/.test(slug)?'PAPER 3':'PAPER 1';
export function DashboardTruthFixture(){
  const [scope,setScope]=useState('ALL PAPER');const [legacy,setLegacy]=useState(false);
  const selected=positions.filter(p=>scope==='ALL PAPER'||accountFor(p.slug)===scope);
  const logical=collapseDailyLogicalTrades({rows:selected,routes:selected.map((p,i)=>({id:'route'+i,position_id:p.id,account_id:accountFor(p.slug),event_at:p.closed_at})),session:'2026-09-16',sessionOf:()=> '2026-09-16'});
  const observations=logical.groups.map(g=>heldTradePeakObservation(g.rootPositionId,g.rows));
  const diagnostic=summarizePeakDiagnostics(observations);
  const channels=[...new Set(selected.map(p=>p.slug))].map(slug=>{
    const groups=logical.groups.filter(g=>g.root.slug===slug);const peakDiagnostic=summarizePeakDiagnostics(groups.map(g=>heldTradePeakObservation(g.rootPositionId,g.rows)));
    return {slug,name:slug,metrics:{nTrades:groups.length,winRate:groups.filter(g=>g.realizedPnl>0).length/groups.length,realizedPnl:groups.reduce((s,g)=>s+g.realizedPnl,0),medianHoldMin:0,avgR:0,nPeaked:peakDiagnostic.valid,avgPeakPct:peakDiagnostic.averagePeakPct,peakCapturePct:legacy?100:peakDiagnostic.retainedPct,peakDiagnostic:legacy?undefined:peakDiagnostic},exitReasons:Object.fromEntries(groups.map(g=>[String(g.root.close_reason),1])),flaws:[]};
  });
  const report:DailyReport={report_date:'2026-09-16',mode:'paper',digest:{date:'2026-09-16',mode:'paper',fund:{dayRealized:logical.groups.reduce((s,g)=>s+g.realizedPnl,0),trades:logical.groups.length,winRate:logical.groups.filter(g=>g.realizedPnl>0).length/logical.groups.length,channelsTraded:channels.length},channels,peakDiagnostic:legacy?undefined:diagnostic,evidence:{schemaVersion:3,unit:'logical_trade',layer:'executed',scope,reconciliation:'immutable_execution_routes',positionRows:selected.length,runnerRowsCollapsed:selected.length-logical.groups.length,configuration:'fixture',managerVersion:null,limitations:[]}},narrative:null};
  const evidence={reports:[report],loading:false,error:null};
  return <section className="shell-root ws909" style={{display:"block",padding:20,maxWidth:1100,margin:'auto'}} aria-label="Dashboard reporting regression">
    <h2>Reporting parity · offline September 16 fixture</h2><p>Real recorded economics with synthetic identifiers. No network, orders or production writes.</p>
    <nav aria-label="Fixture account">{['ALL PAPER','PAPER 1','PAPER 2','PAPER 3'].map(a=><button type="button" key={a} aria-pressed={scope===a} onClick={()=>setScope(a)} style={{padding:12}}>{a}</button>)}</nav>
    <label><input type="checkbox" checked={legacy} onChange={e=>setLegacy(e.target.checked)}/> Simulate legacy peak metrics without a coherent evidence stamp</label>
    <ReviewSessionScorecard evidence={evidence}/><DailyAutopsyBody strategists={[]} evidence={evidence}/>
  </section>;
}
