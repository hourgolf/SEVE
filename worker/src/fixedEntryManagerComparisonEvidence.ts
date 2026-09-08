/** Complete read-only derivation, independent of current roster/date/status.
 * An immutable terminal summary alone cannot establish eligibility or final PnL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixedManagerComparisonIndex } from "../../lib/research/fixedManagerComparison.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { discoverFixedEntryIntents, readFixedIntentRecords, readFixedIntentPositions } from "./fixedEntrySupabaseCoverage.js";
import { buildFixedEntryReporting } from "./fixedEntryReporting.js";
import { verifyFixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import type { FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import type { FixedCoverageSnapshot } from "./fixedEntryCoverageMaterialization.js";
import type { FixedIntentExitRequest } from "./fixedEntryExitRequest.js";
export function buildFixedManagerComparisonEvidence(intent: FixedEntryIntent,
  {records,positions}: Pick<FixedCoverageSnapshot,"records"|"positions">): FixedManagerComparisonIndex {
  const index: FixedManagerComparisonIndex = {};
  const plan = buildFixedEntryReporting(intent,{records,positions});
  const settlement = verifyFixedIntentSettlement(intent,{records,positions});
  const booked = positions.filter(r => r.status === "closed");
  const bookedToDateUsd = booked.reduce((n,r) => n + r.realized_pnl!,0);
  const finalDebitUsd = settlement ? booked.reduce((n,r) => n + r.avg_entry_price*r.qty*100,0) : null;
  const generationIds = plan.cohorts.map(c => c.position.id);
  const exit = records.find(r => r.kind === "exit-required")?.body.exitRequest as FixedIntentExitRequest | undefined;
  for (const cohort of plan.cohorts) {
    const row = cohort.position;
    const current = positions.find(p => p.id === row.id)!;
    index[row.id] = { intentId:intent.id,positionId:row.id,rootPositionId:generationIds[0],generationIds,
      accountId:intent.accountId,strategistId:intent.strategistId,configurationEpochId:intent.writeStamp.configuration_epoch_id,
      entryAt:row.opened_at,entryPrice:row.avg_entry_price,quantity:row.qty,
      eligible:cohort.censorCode === null,censorCode:cohort.censorCode,evidenceAt:cohort.evidenceAt,
      receiptHashes:records.map(r => r.contentHash).sort(),settlementId:settlement?.id ?? null,
      finalPnlUsd:settlement ? bookedToDateUsd : null,finalDebitUsd,bookedToDateUsd,
      currentQuantity:current.qty,currentBasis:current.avg_entry_price,currentStatus:current.status,
      currentRealizedPnl:current.realized_pnl,currentClosedAt:current.closed_at,firstExitRequestedAt:exit?.requestedAt ?? null };
  }
  return index;
}
export async function readFixedManagerComparisonEvidence(client: Pick<SupabaseClient,"from">): Promise<FixedManagerComparisonIndex> {
  assertFixedEntryServiceClient(client);
  const index: FixedManagerComparisonIndex = {};
  for (const intent of await discoverFixedEntryIntents(client)) {
    const [records,positions] = await Promise.all([readFixedIntentRecords(client,intent),readFixedIntentPositions(client,intent)]);
    Object.assign(index,buildFixedManagerComparisonEvidence(intent,{records,positions}));
  }
  return index;
}
