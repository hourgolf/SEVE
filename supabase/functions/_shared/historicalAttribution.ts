/** Runtime-neutral reporting evidence. No writes, broker calls, or trading authority. */
export const HISTORICAL_SCHEMA = 'seve-historical-attribution-v1' as const;
export const SOURCE_FIELDS = ['id','strategist_id','occ_symbol','qty','avg_entry_price','current_mark','realized_pnl','status','opened_at','closed_at','runner_of','close_reason','configuration_epoch_id','channel_spec_version_id','release_manifest_id'] as const;
export type SourceRow = { id: string; [key: string]: unknown };
export interface HistoricalTrade {
  rootPositionId: string; positionIds: string[]; slug: string; occ: string;
  openedAt: string; closedAt: string; qty: number; brokerAccountId: string | null;
  state: string; reasons: string[]; ledgerGross: number; reconstructedGross: number | null;
  buyOrderIds: string[]; sellOrderIds: string[]; policyIdentityComplete: boolean;
  entryPrice: number | null; identitySources: string[];
}
export interface BrokerOnlyTrade {
  slug: string; accountId: string; occ: string; openedAt: string; closedAt: string;
  gross: number; orderIds: string[]; buyQuantity: number; sellQuantity: number;
}
export interface HistoricalManifest {
  schema: typeof HISTORICAL_SCHEMA; version: string; from: string; through: string;
  positions: SourceRow[]; records: HistoricalTrade[]; brokerOnly: BrokerOnlyTrade[];
  strategistIds: Record<string,string>;
}
export interface HistoricalSnapshot extends HistoricalManifest {
  checkedAt: string; issues: string[]; brokerOnlyConflicts: BrokerOnlyTrade[];
  inventoryGaps: Array<{id:string;occ:string;closedAt:string;slug:string|null}>;
}
const numeric = new Set(['qty','avg_entry_price','current_mark','realized_pnl']);
const equivalent = (key: string, a: unknown, b: unknown) => {
  if (a == null || b == null) return a == null && b == null;
  if (numeric.has(key)) return Number.isFinite(Number(a)) && Number(a) === Number(b);
  if (key.endsWith('_at')) return Date.parse(String(a)) === Date.parse(String(b));
  return a === b;
};
export const closeSession = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(iso));
const cents = (v: number) => Math.round(v * 100) / 100;

/** Fail closed on changed or missing source rows, new children, conflicting routes, or reused fills. */
export function validateHistoricalManifest(manifest: HistoricalManifest, current: readonly SourceRow[], routes: readonly {position_id: string | null; account_id: string | null}[], checkedAt: string): HistoricalSnapshot {
  const now = new Map(current.map(p=>[p.id,p])), prior = new Map(manifest.positions.map(p=>[p.id,p]));
  if (now.size !== current.length || prior.size !== manifest.positions.length) throw Error('Duplicate historical source identity');
  if (new Set(manifest.records.map(t=>t.rootPositionId)).size !== manifest.records.length) throw Error('Duplicate historical trade identity');
  const usedPositions = new Set<string>(), usedOrders = new Set<string>();
  const unknown=current.filter(p=>!prior.has(p.id)&&p.status==='closed'&&p.closed_at&&closeSession(String(p.closed_at))>=manifest.from&&closeSession(String(p.closed_at))<=manifest.through);
  const touchedContracts=new Set(unknown.map(p=>String(p.occ_symbol)));
  const records = manifest.records.map(t=> {
    const reasons = [...t.reasons];
    for (const id of t.positionIds) {
      if (usedPositions.has(id)) throw Error('Historical position reused');
      usedPositions.add(id);
      const expected = prior.get(id), live = now.get(id);
      if (!expected || !live || SOURCE_FIELDS.some(k=>!equivalent(k,expected[k],live[k]))) reasons.push('source_changed_or_missing');
      const accounts = new Set(routes.filter(r=>r.position_id===id&&r.account_id).map(r=>r.account_id));
      if (t.brokerAccountId && [...accounts].some(a=>a!==t.brokerAccountId)) reasons.push('account_route_conflict');
    }
    if (current.some(p=>t.positionIds.includes(String(p.runner_of))&&!t.positionIds.includes(p.id))) reasons.push('new_lineage_member');
    if (touchedContracts.has(t.occ)) reasons.push('historical_contract_inventory_changed');
    if (t.state==='broker_reconstructed') {
      if (!t.brokerAccountId || !Number.isFinite(t.reconstructedGross) || !t.buyOrderIds.length || !t.sellOrderIds.length) throw Error('Invalid reconstructed evidence');
      for(const id of [...t.buyOrderIds,...t.sellOrderIds]) {
        const key=t.brokerAccountId+'|'+id;
        if(usedOrders.has(key)) throw Error('Historical fill reused');
        usedOrders.add(key);
      }
    }
    const state=reasons.length?'unresolved':t.state;
    return {...t,reasons:[...new Set(reasons)],state,reconstructedGross:state==='broker_reconstructed'?t.reconstructedGross:null};
  });
  // Source additions are explicit gaps. Only trades on the touched contract lose
  // their certified result; unrelated order-linked results remain usable.
  const issues=unknown.length?[`${unknown.length} closed source rows in the audited period are absent from this evidence version; affected contracts are withheld.`]:[];
  const idBySlug=manifest.strategistIds, slugById=new Map(Object.entries(idBySlug).map(([slug,id])=>[id,slug]));
  const inventoryGaps=unknown.map(p=>({id:p.id,occ:String(p.occ_symbol),closedAt:String(p.closed_at),slug:slugById.get(String(p.strategist_id))??null}));
  const brokerOnlyConflicts: BrokerOnlyTrade[]=[],brokerOnly: BrokerOnlyTrade[]=[];
  for(const b of manifest.brokerOnly){
    const conflict=current.some(p=>p.strategist_id===manifest.strategistIds[b.slug]&&p.occ_symbol===b.occ);
    for(const id of b.orderIds){const key=b.accountId+'|'+id;if(usedOrders.has(key))throw Error('Broker-only fill reused');usedOrders.add(key);}
    (conflict||touchedContracts.has(b.occ)?brokerOnlyConflicts:brokerOnly).push(b);
  }
  const drifted=records.filter(t=>t.reasons.some(r=>['source_changed_or_missing','account_route_conflict','new_lineage_member'].includes(r))).length;
  if(drifted) issues.push(`${drifted} trade reconstructions withheld because source evidence changed.`);
  return {...manifest,records,brokerOnly,checkedAt,issues,brokerOnlyConflicts,inventoryGaps};
}

/** A reader's narrower projection must still agree with the freshly validated source. */
export function historicalTradeForRows(snapshot: HistoricalSnapshot, rows: readonly SourceRow[]): HistoricalTrade | null {
  const ids=new Set(rows.map(p=>p.id));
  const found=snapshot.records.filter(t=>t.positionIds.some(id=>ids.has(id)));
  if(!found.length)return null;
  const t=found[0];
  const source=new Map(snapshot.positions.map(p=>[p.id,p]));
  const mismatch=found.length!==1||ids.size!==t.positionIds.length||t.positionIds.some(id=>!ids.has(id))||rows.some(p=>SOURCE_FIELDS.some(k=>k in p&&!equivalent(k,p[k],source.get(p.id)?.[k])));
  return mismatch?{...t,state:'unresolved',reconstructedGross:null,reasons:['reader_source_or_lineage_changed']}:t;
}
export interface HistoricalSelection {
  version: string; from: string; through: string; recordedTrades: number; reconstructedTrades: number;
  unresolvedTrades: number; originalGrossMatched: number | null; reconstructedGross: number | null;
  positiveTrades: number; winRate: number | null; records: HistoricalTrade[];
  brokerOnly: BrokerOnlyTrade[]; brokerOnlyGross: number | null; brokerOnlyConflicts: number;
  unknownAccountTrades: number; inventoryGapRows: number; issues: string[];
}
export function selectHistorical(snapshot: HistoricalSnapshot, filter: {from?:string;through?:string;slug?:string;accountId?:string}={}): HistoricalSelection {
  const from=filter.from??snapshot.from,through=filter.through??snapshot.through;
  const inWindow=(t:{closedAt:string;slug:string})=>closeSession(t.closedAt)>=from&&closeSession(t.closedAt)<=through&&(!filter.slug||t.slug===filter.slug);
  const windowed=snapshot.records.filter(inWindow);
  const records=windowed.filter(t=>!filter.accountId||t.brokerAccountId===filter.accountId);
  const matched=records.filter(t=>t.state==='broker_reconstructed');
  const brokerOnly=snapshot.brokerOnly.filter(t=>inWindow(t)&&(!filter.accountId||t.accountId===filter.accountId));
  const inventoryGapRows=snapshot.inventoryGaps.filter(p=>closeSession(p.closedAt)>=from&&closeSession(p.closedAt)<=through&&(!filter.slug||p.slug===filter.slug)).length;
  const positiveTrades=matched.filter(t=>t.reconstructedGross!>0).length;
  return {version:snapshot.version,from,through,recordedTrades:records.length,reconstructedTrades:matched.length,unresolvedTrades:records.length-matched.length,
    originalGrossMatched:matched.length?cents(matched.reduce((s,t)=>s+t.ledgerGross,0)):null,
    reconstructedGross:matched.length?cents(matched.reduce((s,t)=>s+t.reconstructedGross!,0)):null,
    positiveTrades,winRate:matched.length?positiveTrades/matched.length:null,records,brokerOnly,
    brokerOnlyGross:brokerOnly.length?cents(brokerOnly.reduce((s,t)=>s+t.gross,0)):null,
    brokerOnlyConflicts:snapshot.brokerOnlyConflicts.filter(inWindow).length,
    unknownAccountTrades:filter.accountId?windowed.filter(t=>!t.brokerAccountId).length:0,inventoryGapRows,issues:snapshot.issues};
}
export function historicalCoverageText(s:HistoricalSelection):string {
  return `Paper-broker reconstruction · ${s.reconstructedTrades}/${s.recordedTrades} recorded logical trades · ${s.unresolvedTrades} unresolved · ${s.inventoryGapRows} newer source rows outside this audit · ${s.brokerOnly.length} additional broker-only round trips shown separately${s.unknownAccountTrades?` · ${s.unknownAccountTrades} historical trades have unknown account routing`:''}. Gross before fees; policy/path eligibility is separate. Evidence ${s.version}.`;
}
