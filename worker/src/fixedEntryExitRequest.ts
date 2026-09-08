/** One durable all-out exit latch for the original intent. The first valid
 * trigger owns the cause; late buy fills inherit it across restart/roster change.
 * A request is not a broker close or a completed trade.
 */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerId, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolRecord, fixedProtocolObservation, readFixedProtocolRecord, claimFixedProtocolRecord,
  type FixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
export interface FixedIntentExitRequest {
  protocol: "fixed-intent-exit-request-v1";
  intentId: string;
  source: "native-manager" | "manual" | "eod" | "halt";
  reason: string;
  requestedAt: string;
}
export function validFixedExitRequest(record: FixedProtocolRecord, intent: FixedEntryIntent): boolean {
  const r = record.body.exitRequest as FixedIntentExitRequest | undefined;
  return record.kind === "exit-required" && record.intentId === intent.id
    && record.id === fixedLedgerId("exit-required", [intent.id]) && !!r
    && canonicalJson(Object.keys(record.body)) === canonicalJson(["exitRequest"])
    && canonicalJson(Object.keys(r).sort()) === canonicalJson(["protocol", "intentId", "source", "reason", "requestedAt"].sort())
    && r.protocol === "fixed-intent-exit-request-v1" && r.intentId === intent.id
    && ["native-manager", "manual", "eod", "halt"].includes(r.source)
    && typeof r.reason === "string" && r.reason.trim().length > 0 && r.reason.length <= 120
    && Number.isFinite(Date.parse(r.requestedAt)) && Date.parse(r.requestedAt) >= Date.parse(intent.createdAt)
    && Date.parse(record.recordedAt) >= Date.parse(r.requestedAt);
}
export async function requestFixedIntentExit(storage: ImmutableClaimStorage, intent: FixedEntryIntent,
  request: Omit<FixedIntentExitRequest, "protocol" | "intentId">): Promise<FixedProtocolRecord | null> {
  const original = await readFixedProtocolRecord(storage, intent, intent.id);
  if (original?.kind !== "intent" || canonicalJson(original.body.intent) !== canonicalJson(intent)) {
    throw new Error("fixed_exit:original_intent_not_durable");
  }
  const id = fixedLedgerId("exit-required", [intent.id]);
  const record = fixedProtocolRecord({ id, intentId: intent.id, kind: "exit-required", recordedAt: request.requestedAt,
    body: { exitRequest: { protocol: "fixed-intent-exit-request-v1", intentId: intent.id, ...request } } });
  if (!validFixedExitRequest(record, intent)) throw new Error("fixed_exit:invalid_request");
  const existing = await readFixedProtocolRecord(storage, intent, id);
  if (existing) return validFixedExitRequest(existing, intent) ? existing : null;
  await claimFixedProtocolRecord(storage, fixedProtocolObservation(intent, record));
  const stored = await readFixedProtocolRecord(storage, intent, id);
  // A concurrent native/manual request can win the same latch. Return its
  // actual source/reason; do not overwrite it or claim the manual click won.
  return stored && validFixedExitRequest(stored, intent) ? stored : null;
}
