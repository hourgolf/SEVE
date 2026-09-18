import { historicalCoverageText, type HistoricalSelection } from '@/supabase/functions/_shared/historicalAttribution';
export function HistoricalAttributionNote({evidence}:{evidence?:HistoricalSelection}){
  if(!evidence)return null;
  return <div className="wk-ee-note" role="note"><p>{historicalCoverageText(evidence)}</p>
    {evidence.brokerOnly.length>0&&<p>Additional broker-only gross: {evidence.brokerOnlyGross?.toLocaleString('en-US',{style:'currency',currency:'USD'})}. Excluded from the matched-record totals above.</p>}
    {evidence.brokerOnlyConflicts>0&&<p>{evidence.brokerOnlyConflicts} broker-only cases withheld after source changes.</p>}
    {evidence.issues.map(issue=><p key={issue}>{issue}</p>)}
  </div>;
}
