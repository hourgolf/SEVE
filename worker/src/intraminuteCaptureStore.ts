// Narrow append-only persistence seam for Phase 1H-B. This adapter deliberately
// does not import the worker's broad store (which also owns position mutations).

import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { warn } from "./log.js";

export interface IntraminuteCaptureReceiptRow {
  object_key: string;
  manifest_key: string;
  schema_version: 1;
  observer_version: string;
  source_boot_id: string;
  source_feed: "sip";
  symbol: string;
  session_date_et: string;
  hour_et: number;
  row_count: number;
  trade_count: number;
  quote_count: number;
  gap_count: number;
  provider_min_at: string;
  provider_max_at: string;
  checksum_sha256: string;
  compressed_bytes: number;
  dropped_events: number;
  rejected_oversize: number;
  completed_at: string;
}

export interface IntraminuteCaptureHealthRow {
  id: string;
  source_boot_id: string;
  observed_at: string;
  severity: "warning" | "high";
  code: "r2_flush_failed" | "receipt_write_failed";
  affected_events: number;
  facts: Record<string, unknown>;
}

const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function intraminuteCaptureSchemaReady(): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("intraminute_capture_receipts").select("object_key").limit(1);
    if (error) { warn(`intraminute-capture: schema probe failed — ${error.message}`); return false; }
    return true;
  } catch (error) {
    warn(`intraminute-capture: schema probe rejected — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function insertIntraminuteCaptureReceipt(row: IntraminuteCaptureReceiptRow): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("intraminute_capture_receipts").insert(row);
    if (error) { warn(`intraminute-capture: receipt insert failed — ${error.message}`); return false; }
    return true;
  } catch (error) {
    warn(`intraminute-capture: receipt insert rejected — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function insertIntraminuteCaptureHealth(row: IntraminuteCaptureHealthRow): Promise<boolean> {
  if (!config.hasServiceRole) return false;
  try {
    const { error } = await sb.from("intraminute_capture_health").insert(row);
    if (error) { warn(`intraminute-capture: health insert failed — ${error.message}`); return false; }
    return true;
  } catch (error) {
    warn(`intraminute-capture: health insert rejected — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
