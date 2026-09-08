/** Complete original-ledger prerequisite for configuration activation/rollback.
 * Flat current positions alone cannot extinguish an unsubmitted claim, pending
 * buy, late fill or unfinished sell chain. This is read evidence, not a lease;
 * operational cutover must independently quiesce every order-capable process.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentHash } from "../../lib/channels/channelControlPlane.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { discoverFixedEntryIntents,readFixedIntentRecords,readFixedIntentPositions } from "./fixedEntrySupabaseCoverage.js";
import { verifyFixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import type { FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import type { FixedProtocolRecord } from "./fixedEntryLedgerPersistence.js";
import type { FixedMaterializedPosition } from "./fixedEntryCoverageMaterialization.js";
type History={intent:FixedEntryIntent;records:readonly FixedProtocolRecord[];positions:readonly FixedMaterializedPosition[]};
export function fixedCustodyBoundaryFromCompleteHistory(histories:readonly History[]){
  if(new Set(histories.map(h=>h.intent.id)).size!==histories.length)throw new Error("fixed_boundary:duplicate_original");
  const originals=histories.map(h=>({intentId:h.intent.id,intentHash:h.intent.contentHash,
    settlementHash:verifyFixedIntentSettlement(h.intent,h)?.contentHash??null})).sort((a,b)=>a.intentId.localeCompare(b.intentId));
  return {version:"fixed-custody-boundary-v1" as const,allSettled:originals.every(r=>r.settlementHash!==null),
    originals,contentHash:contentHash(originals)};
}
export async function readFixedCustodyBoundary(client:Pick<SupabaseClient,"from">){
  assertFixedEntryServiceClient(client);
  const histories:History[]=[];
  for(const intent of await discoverFixedEntryIntents(client)){
    const [records,positions]=await Promise.all([readFixedIntentRecords(client,intent),readFixedIntentPositions(client,intent)]);
    histories.push({intent,records,positions});
  }
  return {...fixedCustodyBoundaryFromCompleteHistory(histories),observedAt:new Date().toISOString()};
}
