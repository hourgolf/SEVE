import { closeSession, historicalCoverageText, selectHistorical, type HistoricalSnapshot } from './historicalAttribution.ts';
import { REPORTING_SCHEMA, summarizePeakDiagnostics } from './reportingEvidence.ts';
// Stored narratives and behavioral findings cannot be carried onto revised economics.
export function historicalDigest(snapshot:HistoricalSnapshot,from:string,through:string,kind:'daily'|'weekly',original:Record<string,any>={}) {
  const selection=selectHistorical(snapshot,{from,through});
  const covered=selection.records.filter(t=>t.state==='broker_reconstructed');
  const observedDates=[...new Set([...selection.records,...selection.brokerOnly].map(t=>closeSession(t.closedAt)))].sort();
  const slugs=[...new Set([...selection.records,...selection.brokerOnly].map(t=>t.slug))].sort();
  const channels=slugs.map(slug=>{
    const selected=selectHistorical(snapshot,{from,through,slug});
    const records=selected.records.filter(t=>t.state==='broker_reconstructed');
    const old=original.channels?.find((c:any)=>c.slug===slug);
    const trades=records.map(t=>({id:t.rootPositionId,occ:t.occ,qty:t.qty,entryPrice:t.entryPrice,pnl:t.reconstructedGross!,originalLedgerPnl:t.ledgerGross,
      holdMin:Math.max(0,(Date.parse(t.closedAt)-Date.parse(t.openedAt))/60000),closedAt:t.closedAt,
      R:null,exitReason:'unverified',signalType:null,conviction:null,peakPct:null,capturePct:null,
      peakObservation:{id:t.rootPositionId,realizedUsd:t.reconstructedGross!,peakGainUsd:null,peakPct:null,issue:'historical_path_not_revalidated'},
      exitProvenance:[],accountId:t.brokerAccountId,configurationEpochId:null,channelSpecVersionId:null}));
    const peakDiagnostic=summarizePeakDiagnostics(trades.map(t=>t.peakObservation));
    const byDay=observedDates.map(date=>{const d=records.filter(t=>closeSession(t.closedAt)===date);return {date,pnl:d.length?Math.round(d.reduce((s,t)=>s+t.reconstructedGross!,0)*100)/100:null,trades:d.length};});
    const holds=trades.map(t=>t.holdMin).sort((a,b)=>a-b),median=holds.length?(holds.length%2?holds[Math.floor(holds.length/2)]:(holds[holds.length/2-1]+holds[holds.length/2])/2):null;
    return {slug,name:old?.name??slug,mandate:old?.mandate??'',status:'historical',metrics:{nTrades:trades.length,wins:selected.positiveTrades,winRate:selected.winRate,
      realizedPnl:selected.reconstructedGross,avgR:null,medianR:null,medianHoldMin:median,avgPeakPct:null,peakCapturePct:null,nPeaked:0,peakDiagnostic,
      bestTrade:trades.length?Math.max(...trades.map(t=>t.pnl)):null,worstTrade:trades.length?Math.min(...trades.map(t=>t.pnl)):null},
      historicalAttribution:selected,exitReasons:{},flaws:[],recurringFlaws:[],activity:{signals:null,acted:null,blocked:{}},convictionAvg:{},configurationEpochId:null,configurationEpochs:[],
      trades,byDay,exitEfficiency:{unit:'logical_trade',mfeUpside:null,captured:null,captureRatio:null,biggestRunner:null,peakDiagnostic}};
  });
  const peakDiagnostic=summarizePeakDiagnostics(channels.flatMap(c=>c.trades.map(t=>t.peakObservation)));
  const evidence={schemaVersion:4,producerVersion:REPORTING_SCHEMA,unit:'logical_trade',layer:'historical_executed',scope:'audited_paper_accounts',
    reconciliation:'broker_reconstruction_with_explicit_gaps',moneyUnit:'whole_position_usd_gross',sessionTimezone:'America/New_York',
    positionRows:selection.records.reduce((s,t)=>s+t.positionIds.length,0),runnerRowsCollapsed:selection.records.reduce((s,t)=>s+t.positionIds.length-1,0),
    configuration:'historical_identity_separate_from_economics',managerVersion:null,exitEfficiencyUnit:'logical_trade',sourceDailyReports:[],
    historicalAttribution:selection,limitations:[historicalCoverageText(selection),'Observed executions only; no claim of complete signal/session collection. Historical policy, paths, fees and live attainability are not certified.',...selection.issues]};
  const fund={trades:covered.length,wins:selection.positiveTrades,winRate:selection.winRate,channelsTraded:channels.filter(c=>c.metrics.nTrades>0).length};
  if(kind==='daily') return {date:from,mode:'paper',market:original.market??null,marketQQQ:original.marketQQQ??null,fund:{...fund,dayRealized:selection.reconstructedGross},channels,peakDiagnostic,evidence};
  const days=observedDates.map(date=>{const d=selectHistorical(snapshot,{from:date,through:date});return {date,pnl:d.reconstructedGross};}).filter((x):x is {date:string;pnl:number}=>x.pnl!=null);
  return {weekStart:from,weekEnd:through,mode:'paper',days:observedDates,fund:{...fund,realized:selection.reconstructedGross,navDelta:null,maxDrawdown:null,equityCurve:[],bestDay:[...days].sort((a,b)=>b.pnl-a.pnl)[0]??null,worstDay:[...days].sort((a,b)=>a.pnl-b.pnl)[0]??null},
    channels,regimeLedger:[],exitEfficiency:{totalUpsideLeft:null,worstCaptureChannels:[],redThatRanGreen:[]},evidence};
}
export function projectStoredHistoricalReport<T extends Record<string,any>>(row:T,snapshot:HistoricalSnapshot,kind:'daily'|'weekly'):T {
  const from=kind==='daily'?row.report_date:row.week_start,through=kind==='daily'?row.report_date:row.week_end;
  if(through<snapshot.from||from>snapshot.through)return row;
  // A week straddling the frozen boundary cannot be partially replaced and silently lose later trades.
  if(from<snapshot.from||through>snapshot.through){
    const historicalBoundaryWarning=`This report crosses the broker-audit boundary (${snapshot.from} through ${snapshot.through}). Its stored gross and channel values are not a broker-reconstructed total for the full report period. Compare audited dates separately before using this report for a channel decision.`;
    return {...row,narrative:null,digest:{...row.digest,evidence:{...row.digest?.evidence,historicalBoundaryWarning,limitations:[...(row.digest?.evidence?.limitations??[]),historicalBoundaryWarning]}}};
  }
  const selection=selectHistorical(snapshot,{from,through});
  // Keep modern held-mark diagnostics only when every original trade result/identity agrees.
  const originalTrades=(row.digest?.channels??[]).flatMap((c:any)=>c.trades??[]);
  const same=kind==='daily'&&row.digest?.evidence?.producerVersion===REPORTING_SCHEMA&&selection.unresolvedTrades===0&&!selection.brokerOnly.length
    &&originalTrades.length===selection.records.length&&selection.records.every(t=>originalTrades.some((o:any)=>o.id===t.rootPositionId&&o.pnl===t.reconstructedGross));
  if(same)return {...row,narrative:null,digest:{...row.digest,evidence:{...row.digest.evidence,historicalAttribution:selection,limitations:[...row.digest.evidence.limitations,historicalCoverageText(selection)]}}};
  return {...row,narrative:null,digest:historicalDigest(snapshot,from,through,kind,row.digest??{})};
}
