/** Negative ownership proof for the legacy order paths. A missing desk row is
 * never proof that a fixed-intent fill is an orphan. All reads use service access.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { discoverFixedEntryIntents, readFixedIntentRecords, readFixedIntentPositions,
  readCompleteFixedRows, FIXED_POSITION_COLUMNS } from "./fixedEntrySupabaseCoverage.js";
import { verifyFixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { fixedEntryOwnershipPresent } from "../../lib/channels/fixedEntryOwnership.js";
import { fixedPositionIdentityMatches, type FixedMaterializedPosition } from "./fixedEntryCoverageMaterialization.js";
import { loadStoredReceiptBoundControlPlane } from "../../lib/channels/channelControlPlanePersistence.js";
export const FIXED_ORIGINAL_ACCOUNT_ID = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
export function fixedLegacyProtectionScope(accountId: string, occ: string): boolean {
  return accountId === FIXED_ORIGINAL_ACCOUNT_ID && occ.startsWith("SPY");
}
export class FixedEntryOwnershipError extends Error {
  constructor() { super("fixed_ownership:legacy_order_not_authorized"); this.name = "FixedEntryOwnershipError"; }
}
export function makeFixedEntryLegacyOwnershipGuard(client: Pick<SupabaseClient, "from">, now = Date.now,
  readMode?:()=>Promise<"legacy"|"fixed"|"unknown">) {
  assertFixedEntryServiceClient(client);
  let fixedSeen=false;
  const mode=readMode??(async()=>{
    const stored=await loadStoredReceiptBoundControlPlane(client as Parameters<typeof loadStoredReceiptBoundControlPlane>[0]);
    if(!stored.compiled || !["receipt-bound","baseline-active"].includes(stored.state))return "unknown";
    return stored.compiled.workerProjection.roots.some(root=>root.slug==="vb-macd-state"
      && Object.prototype.hasOwnProperty.call(root,"fixedContractAdmission"))?"fixed":"legacy";
  });
  return async (accountId: string, occ: string): Promise<void> => {
    if (!fixedLegacyProtectionScope(accountId, occ)) return;
    const started = now();
    try {
      if (!/^SPY\d{6}[CP]\d{8}$/.test(occ) || !Number.isFinite(started)) throw new FixedEntryOwnershipError();
      if(fixedSeen)throw new FixedEntryOwnershipError();
      const current=await mode();
      if(current==="fixed")fixedSeen=true;
      // Once fixed authority is observed, this process never resumes legacy
      // SPY submission, including after rollback. Cutover must separately
      // extinguish old processes/in-flight requests that predate this guard.
      if(current!=="legacy")throw new FixedEntryOwnershipError();
      const all = await discoverFixedEntryIntents(client);
      for (const intent of all.filter(i => i.accountId === accountId && i.underlying === "SPY")) {
        const [records, positions] = await Promise.all([readFixedIntentRecords(client, intent), readFixedIntentPositions(client, intent)]);
        if (!verifyFixedIntentSettlement(intent, { records, positions })) throw new FixedEntryOwnershipError();
      }
      // Also catch malformed/missing-intent fixed rows rather than interpreting
      // an empty valid-intent query as permission to sell an unattributed lot.
      const rows = await readCompleteFixedRows<FixedMaterializedPosition>(client, "positions", FIXED_POSITION_COLUMNS,
        [["status", "open"]]);
      for (const row of rows.filter(fixedEntryOwnershipPresent)) {
        const owner = all.find(i => fixedPositionIdentityMatches(i, row));
        if (!owner || owner.accountId === accountId) throw new FixedEntryOwnershipError();
      }
      const age = now() - started;
      if (!Number.isFinite(age) || age < 0 || age >= 2_000) throw new FixedEntryOwnershipError();
    } catch { throw new FixedEntryOwnershipError(); }
  };
}
