// Complete-session option-quote archive writer. Observation-only: exact rows go
// to immutable content-addressed R2 objects; Supabase receives one compact
// verification receipt. This module has no broker/order/execution imports.

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { buildQuoteArchiveArtifact, quoteArchiveHeadMatches } from "./quoteArchiveModel.js";
import { insertQuoteArchiveReceipt } from "./quoteArchiveReceiptStore.js";

export async function writeQuoteArchiveToR2(input: {
  sessionDateEt: string;
  rows: readonly Record<string, unknown>[];
  completedAt?: string;
}): Promise<{ rowCount: number; objectKey: string; compressedSha256: string }> {
  if (!config.quoteArchiveR2Enabled) throw new Error("R2 quote archive is disabled");
  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2Bucket) {
    throw new Error("R2 quote archive credentials are incomplete");
  }
  const artifact = buildQuoteArchiveArtifact({
    sessionDateEt: input.sessionDateEt,
    rows: input.rows,
    prefix: config.quoteArchiveR2Prefix,
    completedAt: input.completedAt ?? new Date().toISOString(),
  });
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
  });
  const objectMetadata = {
    sha256: artifact.manifest.compressedSha256,
    contentsha256: artifact.manifest.contentSha256,
    rows: String(artifact.manifest.rowCount),
    schema: String(artifact.manifest.schemaVersion),
  };
  await s3.send(new PutObjectCommand({
    Bucket: config.r2Bucket,
    Key: artifact.manifest.objectKey,
    Body: artifact.compressed,
    ContentType: "application/json",
    ContentEncoding: "gzip",
    Metadata: objectMetadata,
  }));
  const objectHead = await s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: artifact.manifest.objectKey }));
  if (!quoteArchiveHeadMatches({
    contentLength: objectHead.ContentLength,
    metadata: objectHead.Metadata,
    expectedBytes: artifact.compressed.byteLength,
    expectedSha256: artifact.manifest.compressedSha256,
  }) || objectHead.Metadata?.contentsha256 !== artifact.manifest.contentSha256
      || objectHead.Metadata?.rows !== String(artifact.manifest.rowCount)) {
    throw new Error(`R2 quote object verification failed for ${input.sessionDateEt}`);
  }

  await s3.send(new PutObjectCommand({
    Bucket: config.r2Bucket,
    Key: artifact.manifest.manifestKey,
    Body: artifact.manifestBody,
    ContentType: "application/json",
    Metadata: { sha256: artifact.manifestSha256, schema: String(artifact.manifest.schemaVersion) },
  }));
  const manifestHead = await s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: artifact.manifest.manifestKey }));
  if (!quoteArchiveHeadMatches({
    contentLength: manifestHead.ContentLength,
    metadata: manifestHead.Metadata,
    expectedBytes: artifact.manifestBody.byteLength,
    expectedSha256: artifact.manifestSha256,
  })) throw new Error(`R2 quote manifest verification failed for ${input.sessionDateEt}`);

  const receipted = await insertQuoteArchiveReceipt({
    session_date_et: artifact.manifest.sessionDateEt,
    schema_version: artifact.manifest.schemaVersion,
    archive_version: artifact.manifest.archiveVersion,
    object_key: artifact.manifest.objectKey,
    manifest_key: artifact.manifest.manifestKey,
    row_count: artifact.manifest.rowCount,
    underlyings: artifact.manifest.underlyings,
    rows_by_underlying: artifact.manifest.rowsByUnderlying,
    first_captured_at: artifact.manifest.firstCapturedAt,
    last_captured_at: artifact.manifest.lastCapturedAt,
    content_sha256: artifact.manifest.contentSha256,
    compressed_sha256: artifact.manifest.compressedSha256,
    manifest_sha256: artifact.manifestSha256,
    compressed_bytes: artifact.manifest.compressedBytes,
    source: artifact.manifest.source,
    completed_at: artifact.manifest.completedAt,
    verified_at: new Date().toISOString(),
  });
  if (!receipted) throw new Error(`R2 quote archive receipt failed for ${input.sessionDateEt}`);
  return {
    rowCount: artifact.manifest.rowCount,
    objectKey: artifact.manifest.objectKey,
    compressedSha256: artifact.manifest.compressedSha256,
  };
}
