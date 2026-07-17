// Narrow append-only persistence seam for Phase 1K-G. Raw OPRA samples remain
// in R2; Supabase receives compact verification and missing-evidence receipts.
// This adapter deliberately imports no broad trading store or execution code.

import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { warn } from "./log.js";

export interface HeldContractCaptureReceiptRow {
  id: string;
  schema_version: 1;
  capture_version: "held-contract-opra-snapshot-v1";
  object_key: string;
  manifest_key: string;
  content_sha256: string;
  compressed_sha256: string;
  compressed_bytes: number;
  position_id: string;
  strategist_id: string;
  account_id: string;
  source_boot_id: string;
  source_version: string;
  source_feed: "opra";
  channel_slug: string;
  underlying: string;
  occ_symbol: string;
  session_date_et: string;
  hour_et: number;
  sample_count: number;
  successful_quote_count: number;
  request_failure_count: number;
  missing_quote_count: number;
  invalid_quote_count: number;
  eligible_count: number;
  stale_snapshot_count: number;
  stale_quote_event_count: number;
  first_fetch_at: string;
  last_fetch_at: string;
  provider_min_at: string | null;
  provider_max_at: string | null;
  gap_count: number;
  max_observation_gap_ms: number | null;
  provider_age_p50_ms: number | null;
  provider_age_p95_ms: number | null;
  provider_age_max_ms: number | null;
  dropped_samples: number;
  rejected_oversize: number;
  completed_at: string;
}

export interface HeldContractCaptureHealthRow {
  id: string;
  source_boot_id: string;
  observed_at: string;
  severity: "warning" | "high";
  code: "queue_drop" | "r2_flush_failed" | "receipt_write_failed" | "schema_unavailable";
  position_id: string | null;
  occ_symbol: string | null;
  affected_samples: number;
  facts: Record<string, unknown>;
}

const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const duplicate = (error: { code?: string } | null): boolean => error?.code === "23505";

export async function heldContractCaptureSchemaReady(): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("held_contract_capture_receipts").select("id").limit(1);
    if (error) { warn(`held-contract-capture: schema probe failed — ${error.message}`); return false; }
    return true;
  } catch (error) {
    warn(`held-contract-capture: schema probe rejected — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function insertHeldContractCaptureReceipt(row: HeldContractCaptureReceiptRow): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("held_contract_capture_receipts").insert(row);
    if (!error || duplicate(error)) return true;
    warn(`held-contract-capture: receipt insert failed — ${error.message}`);
  } catch (error) {
    warn(`held-contract-capture: receipt insert rejected — ${error instanceof Error ? error.message : String(error)}`);
  }
  return false;
}

export async function insertHeldContractCaptureHealth(row: HeldContractCaptureHealthRow): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("held_contract_capture_health").insert(row);
    if (!error || duplicate(error)) return true;
    warn(`held-contract-capture: health insert failed — ${error.message}`);
  } catch (error) {
    warn(`held-contract-capture: health insert rejected — ${error instanceof Error ? error.message : String(error)}`);
  }
  return false;
}
