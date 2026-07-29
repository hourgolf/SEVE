// Read-only live adapter for the pure quote-archive parity gate.
// It performs SELECT/GET/HEAD operations only and has no retention or mutation path.

import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { marketIngestSessionBounds } from "../lib/market/marketIngestWindow.ts";
import { evaluateQuoteArchiveParity } from "../worker/src/quoteArchiveParityModel.js";
import type { QuoteArchiveReceiptRow } from "../worker/src/quoteArchiveReceiptStore.js";

const sessionDateEt = process.argv[2] ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDateEt)) {
  throw new Error("usage: npm run quote-archive-parity:live -- YYYY-MM-DD");
}
const bounds = marketIngestSessionBounds(sessionDateEt);
if (!bounds) throw new Error(`${sessionDateEt} is not a supported trading session`);

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const r2AccountId = process.env.R2_ACCOUNT_ID ?? "";
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
const r2Bucket = process.env.R2_BUCKET ?? "";
for (const [name, value] of Object.entries({
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  R2_ACCOUNT_ID: r2AccountId,
  R2_ACCESS_KEY_ID: r2AccessKeyId,
  R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
  R2_BUCKET: r2Bucket,
})) {
  if (!value) throw new Error(`${name} is required for the read-only parity audit`);
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
});

async function readHotRows(): Promise<Record<string, unknown>[]> {
  const start = `${sessionDateEt}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from <= 200_000; from += 1_000) {
    const { data, error } = await sb.from("option_quotes").select("*")
      .gte("captured_at", start).lt("captured_at", end)
      .order("captured_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`hot quote read failed: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < 1_000) break;
  }
  const { count, error } = await sb.from("option_quotes")
    .select("id", { count: "exact", head: true })
    .gte("captured_at", start).lt("captured_at", end);
  if (error) throw new Error(`hot quote count failed: ${error.message}`);
  if (count !== rows.length) throw new Error(`hot quote pagination mismatch: read ${rows.length}, counted ${count ?? "unknown"}`);
  return rows;
}

async function bytes(key: string): Promise<Uint8Array> {
  const object = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
  if (!object.Body) throw new Error(`R2 object body missing: ${key}`);
  return object.Body.transformToByteArray();
}

async function main(): Promise<void> {
  const { data: receiptData, error: receiptError } = await sb.from("quote_archive_receipts")
    .select("*").eq("session_date_et", sessionDateEt).maybeSingle();
  if (receiptError) throw new Error(`quote archive receipt read failed: ${receiptError.message}`);
  const receipt = receiptData as QuoteArchiveReceiptRow | null;
  if (!receipt) {
    console.log(JSON.stringify({
      sessionDateEt,
      ok: false,
      retentionEligible: false,
      issues: ["verified quote archive receipt is missing"],
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  const [hotRows, compressedObject, manifestBody, objectHead, manifestHead] = await Promise.all([
    readHotRows(),
    bytes(receipt.object_key),
    bytes(receipt.manifest_key),
    r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: receipt.object_key })),
    r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: receipt.manifest_key })),
  ]);
  const result = evaluateQuoteArchiveParity({
    sessionDateEt,
    ...bounds,
    hotRows,
    compressedObject,
    manifestBody,
    objectHead: { contentLength: objectHead.ContentLength, metadata: objectHead.Metadata },
    manifestHead: { contentLength: manifestHead.ContentLength, metadata: manifestHead.Metadata },
    receipt,
  });
  console.log(JSON.stringify({
    sessionDateEt,
    window: bounds,
    ...result,
  }, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error((error as Error)?.message ?? String(error));
  process.exitCode = 1;
});
