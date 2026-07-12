import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

function loadLocalEnv(): void {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

loadLocalEnv();
const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name} in .env.local`);

const ACCOUNT = process.env.R2_ACCOUNT_ID!;
const BUCKET = process.env.R2_BUCKET!;
const PREFIX = (process.env.R2_PREFIX || "seve/databento-v2").replace(/^\/+|\/+$/g, "");
const ROOT = "data/databento-v2";
const RECEIPT = `${ROOT}/manifests/download-2022-01-03_2026-07-10-w10-dte2.json`;
const UPLOAD_RECEIPT = `${ROOT}/manifests/r2-upload.json`;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...walk(path)); else out.push(path);
  }
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`R2 connection green · private bucket '${BUCKET}' is reachable`);
    return;
  }
  if (!existsSync(RECEIPT)) throw new Error("Databento download receipt is missing; acquisition is not complete");
  const receipt = JSON.parse(readFileSync(RECEIPT, "utf8")) as { files?: unknown[]; failures?: unknown[] };
  if (receipt.files?.length !== 1133 || (receipt.failures?.length ?? 0) !== 0) {
    throw new Error(`Acquisition is not green: ${receipt.files?.length ?? 0}/1133 files, ${receipt.failures?.length ?? 0} failures`);
  }
  const files = walk(`${ROOT}/raw`).concat([
    RECEIPT,
    `${ROOT}/manifests/quotes/target-2022-01-03_2026-07-10-w10-dte2.json`,
  ]).filter(existsSync).sort();
  const completed: Array<{ path: string; key: string; bytes: number; sha256: string }> = [];
  let uploaded = 0;
  let skipped = 0;
  for (const path of files) {
    const bytes = statSync(path).size;
    const hash = sha256(path);
    const key = `${PREFIX}/${relative(ROOT, path)}`;
    let matches = false;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      matches = Number(head.ContentLength) === bytes && head.Metadata?.sha256 === hash;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) throw error;
    }
    if (matches) {
      skipped++;
    } else {
      await new Upload({
        client: s3,
        params: { Bucket: BUCKET, Key: key, Body: readFileSync(path), Metadata: { sha256: hash } },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
      const verified = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      if (Number(verified.ContentLength) !== bytes || verified.Metadata?.sha256 !== hash) {
        throw new Error(`R2 verification failed for ${key}`);
      }
      uploaded++;
    }
    completed.push({ path, key, bytes, sha256: hash });
    if (completed.length % 50 === 0) console.log(`${completed.length}/${files.length} · ${uploaded} uploaded · ${skipped} verified skips`);
  }
  writeFileSync(UPLOAD_RECEIPT, JSON.stringify({
    completedAt: new Date().toISOString(), bucket: BUCKET, prefix: PREFIX,
    totals: { files: completed.length, bytes: completed.reduce((sum, file) => sum + file.bytes, 0), uploaded, skipped },
    files: completed,
  }));
  console.log(`R2 green · ${completed.length} files · ${uploaded} uploaded · ${skipped} verified skips`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
