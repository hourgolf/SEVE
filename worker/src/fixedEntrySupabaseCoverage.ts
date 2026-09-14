/** Fixed-only storage adapter. Construction performs no I/O. No upsert, random
 * position ID, migration or legacy position mutation is used by this adapter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import { FIXED_ENTRY_PROTOCOL, parseFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { parseFixedProtocolRecord, parseFixedStoredObservation } from "./fixedEntryLedgerPersistence.js";
import { FIXED_OBSERVATION_COLUMNS, fixedClaimStorage, applyFixedRowCas } from "./fixedEntryLedgerSupabase.js";
import { fixedPositionIdentityMatches, type FixedCoveragePorts,
  type FixedMaterializedPosition } from "./fixedEntryCoverageMaterialization.js";
import { assertFixedEntryServiceClient, readFixedAdmissionSnapshot } from "./fixedEntryServiceClient.js";
import type { FixedAdmissionHistory, FixedIntentSeed } from "./fixedEntryIntentAdmission.js";
import { fixedEntryOwnershipPresent } from "../../lib/channels/fixedEntryOwnership.js";
type Client = Pick<SupabaseClient, "from">;
export const FIXED_POSITION_COLUMNS = ["id", "status", "strategist_id", "occ_symbol", "underlying", "expiration",
  "strike", "opt_type", "qty", "avg_entry_price", "current_mark", "realized_pnl", "unrealized_pnl", "closed_at",
  "close_reason", "opened_at", "entry_reason", "entry_delta", "runner_of", "channel_spec_version_id", "release_manifest_id",
  "configuration_epoch_id", "peak_mark", "trough_mark", "peak_at", "trough_at", "entry_features"].join(",");
export async function readCompleteFixedRows<T extends { id: string }>(client: Client, table: string,
  columns: string, filters: readonly (readonly [string, string, ("gte" | "lt")?])[]): Promise<T[]> {
  assertFixedEntryServiceClient(client);
  const pageSize = 200;
  const rows: T[] = [];
  let total: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from(table).select(columns, { count: "exact" });
    for (const [key, value, operator] of filters) query = operator === "gte" ? query.gte(key, value)
      : operator === "lt" ? query.lt(key, value) : query.eq(key, value);
    const response = await query.order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (response.error || !Array.isArray(response.data) || !Number.isSafeInteger(response.count)
        || response.count! < 0 || response.count! > 100_000) throw new Error("fixed_store:inventory_unavailable_or_unbounded");
    if (total === null) total = response.count!;
    if (response.count !== total || response.data.length !== Math.min(pageSize, Math.max(0, total - offset))) {
      throw new Error("fixed_store:inventory_changed_or_truncated");
    }
    rows.push(...response.data as unknown as T[]);
    if (rows.length === total) break;
  }
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => typeof r.id !== "string" || !r.id)) {
    throw new Error("fixed_store:inventory_duplicate_or_invalid_id");
  }
  return rows;
}
const completeRows = readCompleteFixedRows;
export async function readFixedIntentRecords(client: Client, intent: FixedEntryIntent) {
  const rows = await completeRows<ExecutionObservationDraft>(client, "execution_observations", FIXED_OBSERVATION_COLUMNS,
    [["trace_id", intent.id], ["payload->>fixed_entry_protocol", FIXED_ENTRY_PROTOCOL]]);
  return rows.map(row => parseFixedStoredObservation(intent, row));
}
/** Discovery is independent of current roster mode, current session, and open
 * positions. A rollback or failed position insert must not hide an old intent. */
export async function discoverFixedEntryIntents(client: Client): Promise<FixedEntryIntent[]> {
  const rows = await completeRows<ExecutionObservationDraft>(client, "execution_observations", FIXED_OBSERVATION_COLUMNS,
    [["reason", "fixed_entry_protocol:intent"]]);
  return rows.map(row => {
    const record = parseFixedProtocolRecord(row.payload.fixed_entry_record);
    const intent = record?.kind === "intent" ? parseFixedEntryIntent(record.body.intent) : null;
    if (!intent) throw new Error("fixed_store:discovered_intent_invalid");
    parseFixedStoredObservation(intent, row);
    return intent;
  });
}
/** Admission reads the complete fixed history before it interprets session
 * quota. Legacy root positions remain conservative occupancy evidence; their
 * presence blocks entry without claiming that this read audited broker fills.
 */
export interface FixedAdmissionReadEvidence {
  startedAtMs: number; completedAtMs: number; complete: boolean;
  counts: { observations: number; strategists: number; positions: number } | null;
}
export async function readFixedAdmissionHistory(client: Client, seed: FixedIntentSeed,
  now: () => number, observe?: (read: FixedAdmissionReadEvidence) => void): Promise<FixedAdmissionHistory> {
  assertFixedEntryServiceClient(client);
  const startedAtMs = now();
  let complete = false, counts: FixedAdmissionReadEvidence["counts"] = null;
  try {
    const raw = await readFixedAdmissionSnapshot(client);
    const history = fixedAdmissionHistoryFromSnapshot(raw, seed, startedAtMs);
    counts = (raw as { counts: NonNullable<FixedAdmissionReadEvidence["counts"]> }).counts;
    complete = true;
    return history;
  } finally {
    try { observe?.({ startedAtMs, completedAtMs: now(), complete, counts }); } catch { /* telemetry only */ }
  }
}

/** One database statement supplies every inventory under the same MVCC
 * snapshot. Counts/identities remain checked; a failed or missing RPC must not
 * fall back to an empty history or freshen its clock at response completion. */
export function fixedAdmissionHistoryFromSnapshot(raw: unknown, seed: FixedIntentSeed,
  startedAtMs: number): FixedAdmissionHistory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("fixed_store:admission_snapshot_invalid");
  const value = raw as Record<string, unknown>;
  if (value.schema !== "fixed-admission-snapshot-v1" || value.complete !== true
      || !value.counts || typeof value.counts !== "object") throw new Error("fixed_store:admission_snapshot_incomplete");
  function inventory<T extends { id: string }>(key: string): T[] {
    const count = (value.counts as Record<string, unknown>)[key];
    const rows = value[key];
    if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 100_000
        || !Array.isArray(rows) || rows.length !== count
        || rows.some(row => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id)
        || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("fixed_store:admission_snapshot_inventory_invalid");
    return rows as T[];
  }
  const observations = inventory<ExecutionObservationDraft>("observations");
  const strategists = inventory<{ id: string; slug: string }>("strategists");
  const rows = inventory<FixedMaterializedPosition>("positions");
  const intents = observations.filter(row => row.reason === "fixed_entry_protocol:intent").map(row => {
    const record = parseFixedProtocolRecord(row.payload?.fixed_entry_record);
    const intent = record?.kind === "intent" ? parseFixedEntryIntent(record.body.intent) : null;
    if (!intent) throw new Error("fixed_store:discovered_intent_invalid");
    parseFixedStoredObservation(intent, row);
    return intent;
  });
  const byId = new Map(intents.map(intent => [intent.id, intent]));
  if (byId.size !== intents.length) throw new Error("fixed_store:admission_snapshot_intent_duplicate");
  const parsed = new Map<string, ReturnType<typeof parseFixedStoredObservation>[]>();
  for (const row of observations) {
    const intent = byId.get(row.trace_id);
    if (!intent) throw new Error("fixed_store:protocol_record_without_original_intent");
    const records = parsed.get(intent.id) ?? [];
    records.push(parseFixedStoredObservation(intent, row));
    parsed.set(intent.id, records);
  }
  const entries: FixedAdmissionHistory["intents"] = intents.map(intent => ({ intent, snapshot: {
    records: parsed.get(intent.id)!,
    positions: rows.filter(row => (row.entry_features?.fixed_entry_coverage as { intentId?: string } | undefined)?.intentId === intent.id),
  } }));
  const strategistIds = new Set([seed.strategistId, ...intents.map(i => i.strategistId)]);
  // Stable channel identity must include a prior legacy strategist even before
  // the first fixed intent exists. Current-seed + fixed-intent IDs alone omit
  // a replaced strategist's already-consumed session entry.
  if (strategists.some(row => typeof row.slug !== "string" || !row.slug)) throw new Error("fixed_store:strategist_inventory_invalid");
  for (const row of strategists) if (row.slug === seed.slug) strategistIds.add(row.id);
  let legacySessionEntries = 0;
  const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" });
  for (const row of rows) {
      const features = row.entry_features ?? {};
      if (fixedEntryOwnershipPresent(row)) {
        const owner = intents.find(i => i.id === (features.fixed_entry_coverage as { intentId?: string } | undefined)?.intentId);
        if (!owner || !fixedPositionIdentityMatches(owner, row)) throw new Error("fixed_store:fixed_position_without_original_intent");
        continue;
      }
      const policySlug = (features.receipt_bound_entry_policy as { configuration?: { channelSlug?: unknown } } | undefined)?.configuration?.channelSlug;
      // A preserved original policy can identify a renamed/retired strategist.
      // It is conservative quota evidence, never proof of a broker execution.
      if (!strategistIds.has(row.strategist_id) && policySlug !== seed.slug) continue;
      if (!Number.isFinite(Date.parse(row.opened_at))) throw new Error("fixed_store:legacy_session_time_unavailable");
      const parts = etDate.formatToParts(new Date(row.opened_at));
      const part = (key: string) => parts.find(p => p.type === key)?.value;
      if (`${part("year")}-${part("month")}-${part("day")}` !== seed.sessionDateEt || row.runner_of !== null) continue;
      if (!Number.isSafeInteger(row.qty) || row.qty <= 0 || !Number.isFinite(row.avg_entry_price) || row.avg_entry_price <= 0) {
        throw new Error("fixed_store:legacy_session_economics_unavailable");
      }
      legacySessionEntries++;
  }
  // Timestamp the START of the snapshot read, not its end. Slow/truncated history
  // must not look fresh merely because the final request has just completed.
  return { intents: entries, observedAtMs: startedAtMs, legacySessionEntries };
}
export async function readFixedIntentPositions(client: Client, intent: FixedEntryIntent): Promise<FixedMaterializedPosition[]> {
  const rows = await completeRows<FixedMaterializedPosition>(client, "positions", FIXED_POSITION_COLUMNS,
    [["entry_features->fixed_entry_coverage->>intentId", intent.id]]);
  if (rows.some(row => !fixedPositionIdentityMatches(intent, row))) throw new Error("fixed_store:position_identity_invalid");
  return rows;
}
export async function readFixedPosition(client: Client, intent: FixedEntryIntent, id: string): Promise<FixedMaterializedPosition | null> {
  assertFixedEntryServiceClient(client);
  const { data, error } = await client.from("positions").select(FIXED_POSITION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("fixed_store:position_read_unavailable");
  if (!data) return null;
  const row = data as unknown as FixedMaterializedPosition;
  if (!fixedPositionIdentityMatches(intent, row)) throw new Error("fixed_store:position_identity_invalid");
  return row;
}
export function makeFixedSupabaseCoveragePorts(client: Client, bootId: string, input: {
  intent: FixedEntryIntent;
  now(): number;
  /** Fresh original-account broker holdings after shared-OCC attribution. The
   * adapter must reject account/peer-row incongruence, not return aggregate
   * broker quantity as if it all belonged to this channel. */
  attributedHoldings(intent: FixedEntryIntent): Promise<{ netQty: number; observedAtMs: number }>;
}): FixedCoveragePorts {
  assertFixedEntryServiceClient(client);
  const intent = structuredClone(input.intent);
  return { storage: fixedClaimStorage(client, bootId), now: input.now,
    async snapshot(requested) {
      if (requested.contentHash !== intent.contentHash) throw new Error("fixed_store:original_intent_changed");
      const [records, positions] = await Promise.all([readFixedIntentRecords(client, intent), readFixedIntentPositions(client, intent)]);
      const broker = await input.attributedHoldings(structuredClone(intent));
      return { records, positions, brokerNetQty: broker.netQty, brokerObservedAtMs: broker.observedAtMs };
    },
    readPosition: id => readFixedPosition(client, intent, id),
    async insertPosition(row) {
      if (!fixedPositionIdentityMatches(intent, row)) throw new Error("fixed_store:insert_identity_invalid");
      try {
        const { data, error } = await client.from("positions").insert(structuredClone(row)).select("id").maybeSingle();
        if (error?.code === "23505") return "existing";
        return !error && data?.id === row.id ? "inserted" : "unknown";
      } catch { return "unknown"; }
    },
    cas: change => {
      if (!fixedPositionIdentityMatches(intent, change.expected as FixedMaterializedPosition)) {
        throw new Error("fixed_store:cas_original_identity_invalid");
      }
      return applyFixedRowCas(client, change);
    },
  };
}
