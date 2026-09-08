/** Fixed-cohort persistence protocol. Successful readback proves storage, not
 * ownership of a broker submission. Only this call's acknowledged fresh INSERT
 * can win a command claim. No retry or restart can convert an existing row to a
 * fresh winner. Runtime integration must retain that distinction. */
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { fixedLedgerHash, validFixedCommandSlot, FIXED_ENTRY_PROTOCOL, parseFixedEntryIntent,
  type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";

export interface FixedProtocolRecord {
  version: "fixed-entry-record-v1";
  id: string;
  intentId: string;
  kind: "intent" | "command" | "settlement" | "exit-required";
  recordedAt: string;
  body: Record<string, unknown>;
  contentHash: string;
}
export function fixedProtocolRecord(input: Omit<FixedProtocolRecord, "version" | "contentHash">): FixedProtocolRecord {
  if (!Number.isFinite(Date.parse(input.recordedAt))) throw new Error("fixed_entry:record_timestamp");
  const value = { version: "fixed-entry-record-v1" as const, id: input.id,
    intentId: input.intentId, kind: input.kind, recordedAt: input.recordedAt,
    body: JSON.parse(JSON.stringify(input.body)) as Record<string, unknown> };
  return { ...value, contentHash: fixedLedgerHash(value) };
}
export function parseFixedProtocolRecord(value: unknown): FixedProtocolRecord | null {
  try {
    const record = value as FixedProtocolRecord;
    if (!["intent", "command", "settlement", "exit-required"].includes(record.kind)) return null;
    if (record.kind === "command") {
      const command = record.body.command;
      if (!validFixedCommandSlot(command) || command.intentId !== record.intentId || command.id !== record.id) return null;
    }
    if (record.kind === "intent") {
      const intent = parseFixedEntryIntent(record.body.intent);
      if (!intent || record.intentId !== intent.id || record.id !== intent.id) return null;
    }
    const { version: _version, contentHash: _hash, ...input } = record;
    const rebuilt = fixedProtocolRecord(input);
    return canonicalJson(rebuilt) === canonicalJson(record) ? rebuilt : null;
  } catch { return null; }
}
export function fixedProtocolObservation(intent: FixedEntryIntent,
  record: FixedProtocolRecord): ExecutionObservationDraft {
  if (!parseFixedEntryIntent(intent) || !parseFixedProtocolRecord(record)
      || record.intentId !== intent.id
      || Date.parse(record.recordedAt) < Date.parse(intent.createdAt)) throw new Error("fixed_entry:protocol_identity");
  return {
    id: record.id, trace_id: intent.id, schema_version: 1, event_kind: "decision",
    event_at: record.recordedAt, source_bar_at: intent.sourceBarAt,
    strategist_id: intent.strategistId, account_id: intent.accountId,
    channel_slug: intent.slug, opportunity_id: intent.opportunityId, position_id: null,
    // Protocol rows are not a second entry decision or an observed broker fill.
    action: "reconcile", reason: `fixed_entry_protocol:${record.kind}`,
    blocked_reason: "protocol_record", underlying: intent.underlying,
    occ_symbol: intent.occ, option_side: intent.optionSide,
    quote_source: null, quote_age_ms: null, bid: null, ask: null, mid: null,
    delta: null, underlying_price: null, requested_qty: null,
    client_order_id: null, broker_order_id: null, broker_status: null,
    filled_qty: null, fill_price: null,
    channel_spec_version_id: intent.writeStamp.channel_spec_version_id,
    release_manifest_id: intent.writeStamp.release_manifest_id,
    configuration_epoch_id: intent.writeStamp.configuration_epoch_id,
    payload: { fixed_entry_protocol: FIXED_ENTRY_PROTOCOL, fixed_entry_record: record },
  };
}

export interface ImmutableClaimStorage {
  /** Plain INSERT with primary-key uniqueness, never an upsert. A timeout or
   * ambiguous response MUST return unknown, even if later readback succeeds. */
  insert(row: ExecutionObservationDraft): Promise<"inserted" | "existing" | "unknown">;
  read(id: string): Promise<ExecutionObservationDraft | null>;
}
export type ImmutableClaimResult = {
  state: "fresh-winner" | "existing-match" | "existing-conflict" | "uncertain";
  record: ExecutionObservationDraft | null;
  submissionAuthority: boolean;
};
function canonicalStoredObservation(row: ExecutionObservationDraft): string {
  // PostgreSQL serializes timestamptz offsets differently from JavaScript.
  return canonicalJson({ ...row, event_at: new Date(row.event_at).toISOString(),
    source_bar_at: new Date(row.source_bar_at).toISOString() });
}
/** Exact original-identity read, including relational provenance columns. A
 * valid payload transplanted to another account/spec/intent is not evidence. */
export async function readFixedProtocolRecord(storage: ImmutableClaimStorage,
  intent: FixedEntryIntent, id: string): Promise<FixedProtocolRecord | null> {
  const row = await storage.read(id);
  if (!row) return null;
  return parseFixedStoredObservation(intent, row, id);
}
export function parseFixedStoredObservation(intent: FixedEntryIntent,
  row: ExecutionObservationDraft, id = row.id): FixedProtocolRecord {
  const record = parseFixedProtocolRecord(row.payload.fixed_entry_record);
  if (!record || record.id !== id || record.intentId !== intent.id
      || canonicalStoredObservation(row) !== canonicalStoredObservation(fixedProtocolObservation(intent, record))) {
    throw new Error("fixed_entry:stored_identity_invalid");
  }
  return record;
}
export async function claimFixedProtocolRecord(storage: ImmutableClaimStorage,
  expected: ExecutionObservationDraft): Promise<ImmutableClaimResult> {
  const payload = parseFixedProtocolRecord(expected.payload.fixed_entry_record);
  if (!payload || expected.payload.fixed_entry_protocol !== FIXED_ENTRY_PROTOCOL
      || payload.id !== expected.id || expected.trace_id !== payload.intentId) throw new Error("fixed_entry:claim_payload");
  let inserted: "inserted" | "existing" | "unknown" = "unknown";
  try { inserted = await storage.insert(expected); } catch { /* Outcome unknown. */ }
  let observed: ExecutionObservationDraft | null = null;
  try { observed = await storage.read(expected.id); } catch { /* Outcome unknown. */ }
  if (!observed) return { state: "uncertain", record: null, submissionAuthority: false };
  let matches = false;
  try { matches = canonicalStoredObservation(expected) === canonicalStoredObservation(observed); }
  catch { /* Malformed storage does not authorize a command. */ }
  if (!matches) return { state: "existing-conflict", record: observed, submissionAuthority: false };
  if (inserted === "inserted") return { state: "fresh-winner", record: observed,
    submissionAuthority: payload.kind === "command" && validFixedCommandSlot(payload.body.command)
      && payload.body.command.kind === "submit" };
  return { state: inserted === "existing" ? "existing-match" : "uncertain",
    record: observed, submissionAuthority: false };
}

export { isFixedEntryProtocolObservation } from "../../lib/research/fixedEntryProtocolEvidence.js";
