/** Operator-authorized server use only. No broker access: a manual close is a
 * durable all-out request serviced by the original worker intent. Completion
 * requires global settlement, not disappearance of the clicked position row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixedEntryOwnershipPresent } from "../channels/fixedEntryOwnership";
import { assertFixedEntryServiceClient } from "../../worker/src/fixedEntryServiceClient";
import { discoverFixedEntryIntents, FIXED_POSITION_COLUMNS, readFixedIntentRecords,
  readFixedIntentPositions } from "../../worker/src/fixedEntrySupabaseCoverage";
import { fixedPositionIdentityMatches, type FixedMaterializedPosition } from "../../worker/src/fixedEntryCoverageMaterialization";
import { readFixedRowFence } from "../../worker/src/fixedEntryRowFence";
import { verifyFixedIntentSettlement } from "../../worker/src/fixedEntryIntentSettlement";
import { requestFixedIntentExit } from "../../worker/src/fixedEntryExitRequest";
import { fixedClaimStorage } from "../../worker/src/fixedEntryLedgerSupabase";
import type { FixedEntryIntent } from "../../worker/src/fixedEntryLedgerModel";
type Client = Pick<SupabaseClient, "from">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface FixedManualCloseStatus {
  ok: true;
  pending: boolean;
  positionId: string;
  intentId: string;
  settlementId: string | null;
  /** Only present after all commands/rows reconcile and global settlement verifies. */
  realized?: number;
  canTag: boolean;
}
async function context(client: Client, positionId: string): Promise<{ intent: FixedEntryIntent; row: FixedMaterializedPosition }> {
  assertFixedEntryServiceClient(client);
  if (!UUID.test(positionId)) throw new Error("fixed_manual:invalid_position_id");
  const { data, error } = await client.from("positions").select(FIXED_POSITION_COLUMNS).eq("id", positionId).maybeSingle();
  if (error || !data) throw new Error("fixed_manual:fixed_position_unavailable");
  const row = data as unknown as FixedMaterializedPosition;
  if (!fixedEntryOwnershipPresent(row)) throw new Error("fixed_manual:fixed_position_unavailable");
  const id = readFixedRowFence(row).intentId;
  const intent = (await discoverFixedEntryIntents(client)).find(value => value.id === id);
  if (!intent || !fixedPositionIdentityMatches(intent, row)) throw new Error("fixed_manual:original_identity_unverified");
  return { intent, row };
}
async function status(client: Client, intent: FixedEntryIntent, row: FixedMaterializedPosition): Promise<FixedManualCloseStatus> {
  const [records, positions] = await Promise.all([readFixedIntentRecords(client, intent), readFixedIntentPositions(client, intent)]);
  const done = verifyFixedIntentSettlement(intent, { records, positions });
  const clicked = positions.find(p => p.id === row.id);
  if (!clicked) throw new Error("fixed_manual:position_lineage_unavailable");
  return { ok: true, pending: !done, positionId: row.id, intentId: intent.id, settlementId: done?.id ?? null,
    ...(done ? { realized: Math.round(positions.reduce((sum, p) => sum + (p.realized_pnl ?? 0), 0) * 100) / 100 } : {}),
    canTag: !!done && clicked.status === "closed" && !!clicked.close_reason?.startsWith("manual") };
}
export async function readFixedManualCloseStatus(client: Client, positionId: string): Promise<FixedManualCloseStatus> {
  const { intent, row } = await context(client, positionId);
  return status(client, intent, row);
}
export async function requestFixedManualClose(client: Client, input: {
  positionId: string; nowMs: number;
}): Promise<FixedManualCloseStatus> {
  if (!Number.isFinite(input.nowMs)) throw new Error("fixed_manual:request_identity_invalid");
  const { intent, row } = await context(client, input.positionId);
  const before = await status(client, intent, row);
  if (!before.pending) return before;
  // API requests have no worker_runs FK identity. Never invent a worker boot.
  const receipt = await requestFixedIntentExit(fixedClaimStorage(client, null), intent,
    { source: "manual", reason: "manual", requestedAt: new Date(input.nowMs).toISOString() });
  if (!receipt) throw new Error("fixed_manual:request_unconfirmed");
  return status(client, intent, row);
}
