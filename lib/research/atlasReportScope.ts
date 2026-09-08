import { createHash } from "node:crypto";
import type { DecisionAtlasSourceSnapshot, AtlasVirtualTradeRow } from "./decisionAtlasAdapter";
import type { GateShadowCatchupManifest } from "./gateShadowCatchupAuthorization";
import type { IndependentShadowVerification } from "./evidenceReconciliation";
import { atlasEvidenceEligibility, evidenceJsonHash } from "./atlasEvidenceEligibility";
import { etDateOf } from "../profitability/profitabilityLedger";
import { REVIEWED_ATLAS_SCOPE_EXCLUSIONS } from "./reviewedAtlasScopeExclusions";
import { assertReviewedVirtualTradeRepairs } from "./reviewedVirtualTradeRepairGuard";

const stable=(v:unknown):string=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)
  ?`[${v.map(stable).join(",")}]`:`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+":"+stable(x)).join(",")}}`;
export const atlasScopeRowHash=(row:unknown):string=>"sha256:"+createHash("sha256").update(stable(row)).digest("hex");
export interface ReviewedAtlasScopeExclusion { session:string; signalId:string; rowHash:string; evidenceRef:string }

/** Separate verified alternative scenarios before any scoring or derivation.
 * All raw rows remain in the local snapshot/receipt; no database write occurs.
 * Reviewed historical identities persist across session rollover, while new
 * same-session rows outside the independent verifier remain publication blockers. */
export function prepareAtlasReportScope(input:{snapshot:DecisionAtlasSourceSnapshot;throughSession:string;
  manifest?:GateShadowCatchupManifest;verification?:IndependentShadowVerification;
  historical?:readonly ReviewedAtlasScopeExclusion[]}) {
  const {snapshot,throughSession,manifest,verification}=input;
  if(Boolean(manifest)!==Boolean(verification))throw new Error("Report scope requires manifest and verification together");
  const prior=(snapshot as unknown as {reportScopeExclusions?:{excludedRows?:AtlasVirtualTradeRow[]}}).reportScopeExclusions;
  const rows=[...snapshot.virtualTrades,...(prior?.excludedRows??[])].sort((a,b)=>
    Date.parse(a.signal_at)-Date.parse(b.signal_at)||a.signal_id.localeCompare(b.signal_id));
  if(new Set(rows.map(r=>r.signal_id)).size!==rows.length)throw new Error("Duplicate raw/report-exclusion signal identity");
  assertReviewedVirtualTradeRepairs({...snapshot,virtualTrades:rows});
  const historical=input.historical??REVIEWED_ATLAS_SCOPE_EXCLUSIONS;
  const history=new Map(historical.map(r=>[r.signalId,r]));
  if(history.size!==historical.length)throw new Error("Duplicate reviewed historical scope identity");
  const current=new Set(verification?.unscopedRemoteIds??verification?.extraRemoteIds??[]);
  if(current.size!==(verification?.unscopedRemoteIds??verification?.extraRemoteIds??[]).length)throw new Error("Duplicate current excluded identity");
  for(const id of current)if(!history.has(id))throw new Error("New alternative requires reviewed durable scope policy before publication: "+id);
  const expected=new Set(manifest?.expectedSignalIds??[]);
  for(const id of current)if(expected.has(id))throw new Error("Scoped and excluded cohorts overlap");
  const excluded:AtlasVirtualTradeRow[]=[],kept:AtlasVirtualTradeRow[]=[];
  for(const row of rows){
    const known=history.get(row.signal_id);
    if(known&&(etDateOf(row.signal_at)!==known.session||atlasScopeRowHash(row)!==known.rowHash))throw new Error("Reviewed historical alternative changed: "+row.signal_id);
    if(current.has(row.signal_id)&&etDateOf(row.signal_at)!==throughSession)throw new Error("Current verifier exclusion crossed session boundary");
    if(known||current.has(row.signal_id))excluded.push(row);else kept.push(row);
  }
  if([...current].some(id=>!excluded.some(r=>r.signal_id===id)))throw new Error("Verified alternative missing from raw snapshot");
  const priorExcluded=new Set((prior?.excludedRows??[]).map(r=>r.signal_id));
  if([...priorExcluded].some(id=>!history.has(id)&&!current.has(id)))throw new Error("Prior scope exclusion lacks reviewed historical or current verification authority");
  const raw={...snapshot,virtualTrades:rows};delete (raw as any).reportScopeExclusions;
  const reportScopeExclusions={version:"atlas-report-scope-v1",throughSession,rawSnapshotSha256:evidenceJsonHash(raw),
    manifestSha256:manifest?evidenceJsonHash(manifest):null,verificationSha256:verification?evidenceJsonHash(verification):null,
    excludedSignalIds:excluded.map(r=>r.signal_id).sort(),excludedRows:excluded,
    reviewedHistoricalEvidenceRefs:[...new Set(excluded.map(r=>history.get(r.signal_id)?.evidenceRef).filter(Boolean))],
    reason:"Preserved alternative scenarios outside the verified sequential cohort; excluded only from this report's scoring input.",productionWrites:0};
  const scoped={...snapshot,virtualTrades:kept,reportScopeExclusions};
  const eligibility=atlasEvidenceEligibility({throughSession,snapshot:scoped,manifest,verification});
  if(manifest&&eligibility.state!=="eligible")throw new Error("Report scope failed verification: "+eligibility.blockers.join("; "));
  return {snapshot:scoped,rawSnapshot:raw,receipt:{...reportScopeExclusions,excludedRows:undefined,
    rawVirtualRows:rows.length,scoredVirtualRows:kept.length,excludedVirtualRows:excluded.length,
    channels:snapshot.strategists.length,eligibility}};
}
