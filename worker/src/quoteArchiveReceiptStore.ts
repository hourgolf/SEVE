// Compact private receipt adapter for immutable R2 quote archives. It contains
// no broker, order, execution, or strategy imports.

import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export interface QuoteArchiveReceiptRow {
  session_date_et: string;
  schema_version: 1;
  archive_version: "r2-option-quotes-v1";
  object_key: string;
  manifest_key: string;
  row_count: number;
  underlyings: string[];
  rows_by_underlying: Record<string, number>;
  first_captured_at: string;
  last_captured_at: string;
  content_sha256: string;
  compressed_sha256: string;
  manifest_sha256: string;
  compressed_bytes: number;
  source: "supabase.option_quotes";
  completed_at: string;
  verified_at: string;
}

const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function listVerifiedQuoteArchiveDays(): Promise<{ days: Set<string>; error: string | null }> {
  const { data, error } = await sb.from("quote_archive_receipts")
    .select("session_date_et").eq("archive_version", "r2-option-quotes-v1").limit(2000);
  return {
    days: new Set((data ?? []).map((row) => String(row.session_date_et))),
    error: error?.message ?? null,
  };
}

export async function insertQuoteArchiveReceipt(row: QuoteArchiveReceiptRow): Promise<boolean> {
  const { error } = await sb.from("quote_archive_receipts").insert(row);
  if (!error) return true;
  if (error.code !== "23505") return false;
  const { data, error: readError } = await sb.from("quote_archive_receipts")
    .select("row_count,content_sha256,compressed_sha256,manifest_sha256,object_key,manifest_key")
    .eq("session_date_et", row.session_date_et).maybeSingle();
  if (readError || !data) return false;
  return Number(data.row_count) === row.row_count
    && data.content_sha256 === row.content_sha256
    && data.compressed_sha256 === row.compressed_sha256
    && data.manifest_sha256 === row.manifest_sha256
    && data.object_key === row.object_key
    && data.manifest_key === row.manifest_key;
}
