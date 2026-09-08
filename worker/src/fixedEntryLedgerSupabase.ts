/** Runtime adapter for the fixed-only protocol. Constructing this adapter does
 * not read or write. Callers must have passed receipt-bound execution authority. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import type { ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { fixedRowCasMatches, readFixedRowFence, FIXED_ROW_IDENTITY_KEYS,
  type FixedFencedRow, type FixedRowCas } from "./fixedEntryRowFence.js";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { parseReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";

type Client = Pick<SupabaseClient, "from">;
export const FIXED_OBSERVATION_COLUMNS = ["id", "trace_id", "schema_version", "event_kind", "event_at", "source_bar_at",
  "strategist_id", "account_id", "channel_slug", "opportunity_id", "position_id", "action", "reason", "blocked_reason",
  "underlying", "occ_symbol", "option_side", "quote_source", "quote_age_ms", "bid", "ask", "mid", "delta",
  "underlying_price", "requested_qty", "client_order_id", "broker_order_id", "broker_status", "filled_qty", "fill_price",
  "channel_spec_version_id", "release_manifest_id", "configuration_epoch_id", "payload"].join(",");

export function fixedClaimStorage(client: Client, bootId: string | null): ImmutableClaimStorage {
  return {
    async insert(row) {
      // Never use ignoreDuplicates/upsert: an existing row is not a new win.
      try {
        const { data, error } = await client.from("execution_observations")
          .insert({ ...row, source_boot_id: bootId }).select("id").maybeSingle();
        if (error?.code === "23505") return "existing";
        if (error || data?.id !== row.id) return "unknown";
        return "inserted";
      } catch { return "unknown"; }
    },
    async read(id) {
      const { data, error } = await client.from("execution_observations")
        .select(FIXED_OBSERVATION_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error("fixed_entry:claim_read_unavailable");
      return data as unknown as ExecutionObservationDraft | null;
    },
  };
}

export async function applyFixedRowCas(client: Client, change: FixedRowCas): Promise<{
  state: "applied" | "lost-race" | "unknown";
  row: FixedFencedRow | null;
}> {
  const before = change.expected;
  if (!fixedRowCasMatches(before, before)) throw new Error("fixed_entry:invalid_cas_expected");
  const beforeFence = readFixedRowFence(before);
  const beforeFields = before as unknown as Record<string, unknown>;
  const policy = parseReceiptBoundEntryPolicy(before.entry_features.receipt_bound_entry_policy);
  if (!policy?.fixedContractAdmission || policy.policyVersion !== "receipt-bound-entry-policy-v3") throw new Error("fixed_entry:cas_requires_fixed_policy");
  for (const key of FIXED_ROW_IDENTITY_KEYS) {
    const value = beforeFields[key];
    if (key === "runner_of" ? value !== null : key === "strike" ? typeof value !== "number" || !Number.isFinite(value)
      : typeof value !== "string" || !value) throw new Error("fixed_entry:cas_identity_missing");
  }
  const after = { ...before, ...change.update } as FixedFencedRow;
  const afterFence = readFixedRowFence(after);
  const allowed = after.status === "closed"
    ? ["status", "qty", "current_mark", "realized_pnl", "unrealized_pnl", "closed_at", "close_reason", "entry_features"]
    : ["qty", "avg_entry_price", "entry_features"];
  if (Object.keys(change.update).some(key => !allowed.includes(key)) || !change.update.entry_features
      || afterFence.intentId !== beforeFence.intentId || afterFence.generation !== beforeFence.generation
      || afterFence.revision !== beforeFence.revision + 1
      || canonicalJson(after.entry_features.receipt_bound_entry_policy) !== canonicalJson(before.entry_features.receipt_bound_entry_policy)
      || canonicalJson(after.entry_features.configuration_identity) !== canonicalJson(before.entry_features.configuration_identity)
      || !Number.isSafeInteger(after.qty) || after.qty < 1 || after.qty > 4
      || !Number.isFinite(after.avg_entry_price) || after.avg_entry_price <= 0
      || Number(after.avg_entry_price.toFixed(4)) !== after.avg_entry_price
      || (after.status === "closed" ? beforeFence.activeSellCommandId === null || after.qty > before.qty
        || after.avg_entry_price !== before.avg_entry_price || afterFence.activeSellCommandId !== beforeFence.activeSellCommandId
        : after.status !== "open" || after.qty < before.qty || (after.qty === before.qty && after.avg_entry_price < before.avg_entry_price))) {
    throw new Error("fixed_entry:cas_update_outside_protocol");
  }
  if (after.status === "closed") {
    const u = change.update;
    if (canonicalJson(Object.keys(u).sort()) !== canonicalJson([...allowed].sort())
        || typeof u.realized_pnl !== "number" || !Number.isFinite(u.realized_pnl)
        || Number(u.realized_pnl.toFixed(2)) !== u.realized_pnl
        || typeof u.current_mark !== "number" || !Number.isFinite(u.current_mark) || u.current_mark <= 0
        || Number(u.current_mark.toFixed(4)) !== u.current_mark || u.unrealized_pnl !== 0
        || typeof u.closed_at !== "string" || !Number.isFinite(Date.parse(u.closed_at))
        || typeof u.close_reason !== "string" || !u.close_reason.trim()) throw new Error("fixed_entry:cas_incomplete_close");
  } else {
    const oldOwner = beforeFence.activeSellCommandId, newOwner = afterFence.activeSellCommandId;
    const resizing = after.qty !== before.qty || after.avg_entry_price !== before.avg_entry_price;
    // Coverage grows only an unreserved row. Reservation and terminal-zero
    // release freeze economics; a command owner cannot be replaced in place.
    if (oldOwner !== null ? newOwner !== null || resizing : newOwner !== null && resizing) {
      throw new Error("fixed_entry:cas_invalid_open_transition");
    }
  }
  // A complete JSONB equality predicate protects the original policy and sell
  // reservation together. Quote/MFE display updates need not own this fence.
  try {
    let query = client.from("positions").update(change.update)
      .eq("id", before.id).eq("status", "open").eq("qty", before.qty)
      .eq("avg_entry_price", before.avg_entry_price)
      .eq("entry_features", canonicalJson(before.entry_features));
    for (const key of FIXED_ROW_IDENTITY_KEYS) {
      query = beforeFields[key] === null ? query.is(key, null) : query.eq(key, beforeFields[key]);
    }
    const columns = ["id", "status", "qty", "avg_entry_price", "entry_features", "current_mark", "realized_pnl",
      "unrealized_pnl", "closed_at", "close_reason", ...FIXED_ROW_IDENTITY_KEYS].join(",");
    const { data, error } = await query.select(columns).maybeSingle();
    if (error) return { state: "unknown", row: null };
    if (!data) return { state: "lost-race", row: null };
    const row = data as unknown as FixedFencedRow;
    const expectedAfter = { ...before, ...change.update };
    for (const key of ["id", "status", "qty", "avg_entry_price", "entry_features"] as const) {
      if (canonicalJson(row[key]) !== canonicalJson(expectedAfter[key])) return { state: "unknown", row };
    }
    for (const [key, expected] of Object.entries(change.update)) {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (key === "closed_at" && actual != null && expected != null) {
        if (new Date(String(actual)).toISOString() !== new Date(String(expected)).toISOString()) return { state: "unknown", row };
      } else if (canonicalJson(actual) !== canonicalJson(expected)) return { state: "unknown", row };
    }
    for (const key of FIXED_ROW_IDENTITY_KEYS) {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (key === "opened_at") {
        if (new Date(String(value)).toISOString() !== new Date(String(beforeFields[key])).toISOString()) return { state: "unknown", row };
      } else if (canonicalJson(value) !== canonicalJson(beforeFields[key])) return { state: "unknown", row };
    }
    return { state: "applied", row };
  } catch { return { state: "unknown", row: null }; }
}
