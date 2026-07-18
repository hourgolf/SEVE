// SELECT-only July 17 batching projection. Reads compact receipt metadata only;
// it performs no Supabase/R2 writes and never touches execution or policy.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!url || !key) throw new Error("Supabase read credentials missing");
const sb = createClient(url, key, { auth: { persistSession: false } });

interface ReceiptRow {
  position_id: string;
  occ_symbol: string;
  source_boot_id: string;
  source_version: string;
  session_date_et: string;
  hour_et: number;
  sample_count: number;
  first_fetch_at: string;
  last_fetch_at: string;
}

async function rows(): Promise<ReceiptRow[]> {
  const out: ReceiptRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await sb.from("held_contract_capture_receipts")
      .select("position_id,occ_symbol,source_boot_id,source_version,session_date_et,hour_et,sample_count,first_fetch_at,last_fetch_at")
      .eq("session_date_et", "2026-07-17")
      .order("first_fetch_at").order("id").range(from, from + 999);
    if (error) throw new Error(`receipt SELECT failed: ${error.message}`);
    const batch = (data ?? []) as ReceiptRow[];
    out.push(...batch);
    if (batch.length < 1_000) return out;
  }
}

function project(input: readonly ReceiptRow[], targetSamples: number, maxAgeMs: number): number {
  const groups = new Map<string, ReceiptRow[]>();
  for (const row of input) {
    const key = [row.session_date_et, row.hour_et, row.position_id, row.occ_symbol, row.source_boot_id, row.source_version].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let receipts = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.first_fetch_at.localeCompare(b.first_fetch_at));
    let samples = 0;
    let firstAt = 0;
    for (const row of group) {
      if (samples === 0) firstAt = Date.parse(row.first_fetch_at);
      samples += Number(row.sample_count);
      if (samples >= targetSamples || Date.parse(row.last_fetch_at) - firstAt >= maxAgeMs) {
        receipts++;
        samples = 0;
      }
    }
    if (samples > 0) receipts++;
  }
  return receipts;
}

async function main(): Promise<void> {
  const input = await rows();
  const sourceReceipts = input.length;
  const samples = input.reduce((sum, row) => sum + Number(row.sample_count), 0);
  for (const option of [
    { name: "current", targetSamples: 24, maxAgeMs: 120_000, flushMs: 30_000 },
    { name: "lower-latency", targetSamples: 12, maxAgeMs: 60_000, flushMs: 30_000 },
  ]) {
    const receipts = project(input, option.targetSamples, option.maxAgeMs);
    console.log(JSON.stringify({
      option: option.name,
      sourceReceipts,
      samples,
      targetSamples: option.targetSamples,
      maxAgeMs: option.maxAgeMs,
      projectedReceipts: receipts,
      receiptReductionPct: Number((100 * (1 - receipts / sourceReceipts)).toFixed(2)),
      openWindowMs: option.maxAgeMs + option.flushMs,
      retryScheduleMs: [0, 30_000, 90_000, 210_000, 450_000],
      maximumRetainedLossWindowMs: option.maxAgeMs + option.flushMs + 450_000,
      externalWrites: false,
    }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
