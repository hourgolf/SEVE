// Bounded publisher for a checksum-gated dark-candidate T+1 report.
// Default is dry-run. --publish permits writes only to the three exact
// research receipt tables plus content-addressed R2 objects, then reads every
// payload back and verifies it. No trading/configuration surface is imported.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback?: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback ?? "";
};
const PUBLISH = process.argv.includes("--publish");
const R2_PUBLISH_CONCURRENCY = 8;
const reportFile = resolve(arg("report"));
const receiptFile = resolve(arg("receipt", `${reportFile}.publication-receipt.json`));
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (!reportFile || !existsSync(reportFile)) throw new Error("--report must name an exact T+1 report.json");
if (existsSync(envFile)) process.loadEnvFile(envFile);

type Payload = Record<string, unknown>;
interface ExactReport {
  schemaVersion: 1;
  candidatePayloads: Payload[];
  exactPathPayloads: Payload[];
  managerPathPayloads: Payload[];
  completeness: { state: string; counts?: Record<string, number> };
  publicationState: "complete_with_explicit_censors";
  publicationCoverage: {
    candidates: number;
    exactPaths: number;
    managerPaths: number;
    managerCensors: number;
    expectedManagerPaths: number;
  };
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
};
const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const report = JSON.parse(readFileSync(reportFile, "utf8")) as ExactReport;
if (report.schemaVersion !== 1 || report.externalWrites !== false || report.orderPathAuthorized !== false
    || report.policyChangeAuthorized !== false || !Array.isArray(report.candidatePayloads)
    || !Array.isArray(report.exactPathPayloads) || !Array.isArray(report.managerPathPayloads)) {
  throw new Error("exact report authority or schema boundary failed");
}
if (report.publicationState !== "complete_with_explicit_censors") {
  throw new Error(`exact report is not publication-complete: ${report.publicationState ?? "missing"}`);
}
if (!report.candidatePayloads.length
    || report.exactPathPayloads.length !== report.candidatePayloads.length
    || !report.managerPathPayloads.length) {
  throw new Error("exact report does not contain complete durable receipt payloads");
}
const managerCoverage = report.candidatePayloads.reduce((sum, row) => {
  const expected = Number(row.manager_paths_expected);
  const published = Number(row.manager_paths_published);
  const censors = Array.isArray(row.manager_censors) ? row.manager_censors : null;
  if (!Number.isInteger(expected) || expected <= 0 || !Number.isInteger(published) || published < 0
      || !censors || published + censors.length !== expected) {
    throw new Error(`candidate manager coverage invalid: ${String(row.id)}`);
  }
  return { expected: sum.expected + expected, published: sum.published + published, censors: sum.censors + censors.length };
}, { expected: 0, published: 0, censors: 0 });
if (managerCoverage.expected !== report.publicationCoverage.expectedManagerPaths
    || managerCoverage.published !== report.managerPathPayloads.length
    || managerCoverage.censors !== report.publicationCoverage.managerCensors
    || report.publicationCoverage.candidates !== report.candidatePayloads.length
    || report.publicationCoverage.exactPaths !== report.exactPathPayloads.length
    || report.publicationCoverage.managerPaths !== report.managerPathPayloads.length) {
  throw new Error("exact report publication coverage mismatch");
}

const unique = (rows: Payload[], key: string): boolean =>
  new Set(rows.map((row) => String(row[key] ?? ""))).size === rows.length
  && rows.every((row) => String(row[key] ?? "").length > 0);
if (!unique(report.candidatePayloads, "id") || !unique(report.exactPathPayloads, "id")
    || !unique(report.managerPathPayloads, "id")) throw new Error("duplicate or missing receipt identity");

const reportDir = dirname(reportFile);
const r2 = PUBLISH ? new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
}) : null;

async function remoteObject(key: string): Promise<Buffer | null> {
  try {
    const result = await r2!.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
    return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : null;
  } catch (error) {
    const code = error && typeof error === "object" ? String((error as { name?: unknown }).name ?? "") : "";
    if (/NoSuchKey|NotFound/i.test(code)) return null;
    throw error;
  }
}

async function publishObject(key: string, bytes: Buffer, contentType: string): Promise<"existing" | "uploaded"> {
  const existing = await remoteObject(key);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`R2 immutable object conflict: ${key}`);
    return "existing";
  }
  await r2!.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: bytes, ContentType: contentType }));
  const verified = await remoteObject(key);
  if (!verified?.equals(bytes)) throw new Error(`R2 readback mismatch: ${key}`);
  return "uploaded";
}

async function mapLimit<T, R>(rows: readonly T[], limit: number, work: (row: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= rows.length) return;
      output[index] = await work(rows[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

function canonicalRemote(remote: Record<string, unknown>, local: Payload): Payload {
  return Object.fromEntries(Object.keys(local).sort().map((key) => [key, canonicalValue(key, remote[key])]));
}

function canonicalLocal(local: Payload): Payload {
  return Object.fromEntries(Object.keys(local).sort().map((key) => [key, canonicalValue(key, local[key])]));
}

function canonicalValue(key: string, value: unknown): unknown {
  if (/_at$/.test(key) && typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return value;
}

async function upsertAndVerify(table: string, rows: Payload[]): Promise<number> {
  const sb = createServerSupabaseClient("publish-dark-exact-receipts");
  const write = await sb.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (write.error) throw new Error(`${table} upsert failed: ${write.error.message}`);
  let verified = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    const read = await sb.from(table).select("*").in("id", chunk.map((row) => String(row.id))).order("id");
    if (read.error) throw new Error(`${table} readback failed: ${read.error.message}`);
    const remote = new Map((read.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
    for (const row of chunk) {
      const found = remote.get(String(row.id));
      if (!found || stable(canonicalRemote(found, row)) !== stable(canonicalLocal(row))) {
        throw new Error(`${table} immutable readback mismatch: ${String(row.id)}`);
      }
      verified++;
    }
  }
  return verified;
}

async function main(): Promise<void> {
  let r2Uploaded = 0;
  let r2Existing = 0;
  let verifiedCandidates = 0;
  let verifiedPaths = 0;
  let verifiedManagers = 0;
  if (PUBLISH) {
    const objectResults = await mapLimit(report.exactPathPayloads, R2_PUBLISH_CONCURRENCY, async (path) => {
      const objectKey = String(path.object_key);
      const manifestKey = String(path.manifest_key);
      const objectBytes = readFileSync(resolve(reportDir, objectKey));
      const manifestBytes = readFileSync(resolve(reportDir, manifestKey));
      if (sha256(objectBytes) !== String(path.compressed_sha256)) {
        throw new Error(`local exact object hash mismatch: ${objectKey}`);
      }
      return [
        await publishObject(objectKey, objectBytes, "application/gzip"),
        await publishObject(manifestKey, manifestBytes, "application/json"),
      ] as const;
    });
    for (const result of objectResults.flat()) {
      result === "uploaded" ? r2Uploaded++ : r2Existing++;
    }
    verifiedCandidates = await upsertAndVerify("vb_candidate_receipts", report.candidatePayloads);
    verifiedPaths = await upsertAndVerify("vb_exact_path_receipts", report.exactPathPayloads);
    verifiedManagers = await upsertAndVerify("vb_exact_manager_path_receipts", report.managerPathPayloads);
  }
  const receipt = {
    schemaVersion: 1,
    mode: PUBLISH ? "published" : "dry_run",
    reportFile,
    reportSha256: sha256(readFileSync(reportFile)),
    planned: {
      candidates: report.candidatePayloads.length,
      exactPaths: report.exactPathPayloads.length,
      managerPaths: report.managerPathPayloads.length,
      r2Objects: report.exactPathPayloads.length * 2,
    },
    remote: { verifiedCandidates, verifiedPaths, verifiedManagers, r2Uploaded, r2Existing },
    allowedTables: ["vb_candidate_receipts", "vb_exact_path_receipts", "vb_exact_manager_path_receipts"],
    eventInserts: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(dirname(receiptFile), { recursive: true });
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`publish-dark-exact-receipts: PASS · ${receipt.mode}`);
  console.log(`  candidates ${verifiedCandidates}/${report.candidatePayloads.length}`);
  console.log(`  exact paths ${verifiedPaths}/${report.exactPathPayloads.length}`);
  console.log(`  manager paths ${verifiedManagers}/${report.managerPathPayloads.length}`);
  console.log(`  R2 uploaded ${r2Uploaded} · existing ${r2Existing}`);
}

main().catch((error) => {
  console.error(`publish-dark-exact-receipts failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
