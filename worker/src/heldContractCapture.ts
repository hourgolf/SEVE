// Phase 1K-G observation-only runtime. The manager tick hands this adapter a
// completed provider observation synchronously; all R2/Supabase work happens
// later on the capture timer and can lose evidence only.

import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { info, warn } from "./log.js";
import { BOOT_ID } from "./runId.js";
import * as captureStore from "./heldContractCaptureStore.js";
import {
  BoundedHeldContractCaptureQueue,
  buildHeldContractSegmentDescriptor,
  normalizeHeldContractCaptureSample,
  partitionHeldContractCapture,
  type HeldContractCaptureInput,
  type HeldContractSegmentDescriptor,
} from "./heldContractCaptureModel.js";

const FLUSH_HIGH_WATER = 0.75;
const gzipAsync = promisify(gzip);

function manifestFor(descriptor: HeldContractSegmentDescriptor, compressedSha256: string, compressedBytes: number, completedAt: string): Record<string, unknown> {
  const { rawNdjson: _rawNdjson, ...receipt } = descriptor;
  return { ...receipt, compressedSha256, compressedBytes, completedAt };
}

export class HeldContractCaptureRuntime {
  private readonly queue = new BoundedHeldContractCaptureQueue(
    config.heldContractCaptureMaxSamples,
    config.heldContractCaptureMaxBytes,
  );
  private readonly s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
  });
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private highWaterScheduled = false;
  private lastDropLogMs = 0;

  private constructor() {}

  static async create(input: { paperMode: boolean }): Promise<HeldContractCaptureRuntime | null> {
    if (!config.heldContractCaptureEnabled) return null;
    if (!config.managerShadowBookEnabled) { warn("held-contract-capture: disabled — manager shadow book must be enabled"); return null; }
    if (!input.paperMode) { warn("held-contract-capture: disabled — paper mode required"); return null; }
    if (config.optFeed !== "opra") { warn("held-contract-capture: disabled — OPRA feed required"); return null; }
    if (!config.hasServiceRole) { warn("held-contract-capture: disabled — service role required for private receipts"); return null; }
    if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2Bucket) {
      warn("held-contract-capture: disabled — incomplete R2 credential set");
      return null;
    }
    if (!Number.isInteger(config.heldContractCaptureMaxSamples) || config.heldContractCaptureMaxSamples < 1
        || !Number.isInteger(config.heldContractCaptureMaxBytes) || config.heldContractCaptureMaxBytes < 1
        || !Number.isFinite(config.heldContractCaptureFlushMs) || config.heldContractCaptureFlushMs < 5_000) {
      warn("held-contract-capture: disabled — invalid queue/flush bounds");
      return null;
    }
    const schemaReady = await Promise.race([
      captureStore.heldContractCaptureSchemaReady(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!schemaReady) {
      warn("held-contract-capture: disabled — private receipt schema unavailable");
      return null;
    }
    return new HeldContractCaptureRuntime();
  }

  /** Synchronous and exception-contained by design. It performs no provider,
   * R2, Supabase, broker, or order I/O. */
  capture(input: HeldContractCaptureInput): void {
    try {
      const sample = normalizeHeldContractCaptureSample(input);
      if (!sample) return;
      const result = this.queue.enqueue(sample);
      if (!result.accepted && result.reason !== "duplicate") {
        const now = Date.now();
        if (now - this.lastDropLogMs >= 60_000) {
          this.lastDropLogMs = now;
          warn(`held-contract-capture: evidence shed (${result.reason}); execution and manager state unaffected`);
        }
      }
      if (result.utilization >= FLUSH_HIGH_WATER && !this.highWaterScheduled) {
        this.highWaterScheduled = true;
        setImmediate(() => {
          this.highWaterScheduled = false;
          void this.flush("high-water");
        });
      }
    } catch {
      // A malformed research observation cannot escape into the manager tick.
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush("timer"); }, config.heldContractCaptureFlushMs);
    info(`held-contract-capture: DARK enabled · targeted OPRA snapshots · queue=${config.heldContractCaptureMaxSamples} samples/${Math.round(config.heldContractCaptureMaxBytes / 1_048_576)}MiB · flush=${config.heldContractCaptureFlushMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.race([this.flush("shutdown"), new Promise<void>((resolve) => setTimeout(resolve, 1_500))]);
  }

  private async writePartition(descriptor: HeldContractSegmentDescriptor): Promise<boolean> {
    const compressed = await gzipAsync(descriptor.rawNdjson, { level: 6 });
    const compressedSha256 = createHash("sha256").update(compressed).digest("hex");
    // Segment identity and manifest bytes stay retry-stable. The last included
    // fetch is the deterministic segment completion clock; upload attempts are
    // operational telemetry, not evidence identity.
    const completedAt = descriptor.lastFetchAt;
    const manifest = manifestFor(descriptor, compressedSha256, compressed.byteLength, completedAt);
    const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");

    await this.s3.send(new PutObjectCommand({
      Bucket: config.r2Bucket, Key: descriptor.objectKey, Body: compressed,
      ContentType: "application/x-ndjson", ContentEncoding: "gzip",
      Metadata: {
        content_sha256: descriptor.contentSha256,
        compressed_sha256: compressedSha256,
        schema: String(descriptor.schemaVersion),
        capture: descriptor.captureVersion,
      },
    }));
    const objectHead = await this.s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: descriptor.objectKey }));
    if (objectHead.ContentLength !== compressed.byteLength
        || objectHead.Metadata?.content_sha256 !== descriptor.contentSha256
        || objectHead.Metadata?.compressed_sha256 !== compressedSha256) {
      throw new Error(`R2 verification mismatch for ${descriptor.objectKey}`);
    }

    await this.s3.send(new PutObjectCommand({
      Bucket: config.r2Bucket, Key: descriptor.manifestKey, Body: manifestBody, ContentType: "application/json",
    }));
    const manifestHead = await this.s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: descriptor.manifestKey }));
    if (manifestHead.ContentLength !== manifestBody.byteLength) {
      throw new Error(`R2 manifest verification mismatch for ${descriptor.manifestKey}`);
    }

    const receipted = await captureStore.insertHeldContractCaptureReceipt({
      id: descriptor.id, schema_version: descriptor.schemaVersion, capture_version: descriptor.captureVersion,
      object_key: descriptor.objectKey, manifest_key: descriptor.manifestKey,
      content_sha256: descriptor.contentSha256, compressed_sha256: compressedSha256,
      compressed_bytes: compressed.byteLength, position_id: descriptor.positionId,
      strategist_id: descriptor.strategistId, account_id: descriptor.accountId,
      source_boot_id: descriptor.sourceBootId, source_version: descriptor.sourceVersion,
      source_feed: descriptor.sourceFeed, channel_slug: descriptor.channelSlug,
      underlying: descriptor.underlying, occ_symbol: descriptor.occSymbol,
      session_date_et: descriptor.sessionDateEt, hour_et: descriptor.hourEt,
      sample_count: descriptor.sampleCount, successful_quote_count: descriptor.successfulQuoteCount,
      request_failure_count: descriptor.requestFailureCount, missing_quote_count: descriptor.missingQuoteCount,
      invalid_quote_count: descriptor.invalidQuoteCount, eligible_count: descriptor.eligibleCount,
      stale_snapshot_count: descriptor.staleSnapshotCount, stale_quote_event_count: descriptor.staleQuoteEventCount,
      first_fetch_at: descriptor.firstFetchAt, last_fetch_at: descriptor.lastFetchAt,
      provider_min_at: descriptor.providerMinAt, provider_max_at: descriptor.providerMaxAt,
      gap_count: descriptor.gapCount, max_observation_gap_ms: descriptor.maxObservationGapMs,
      provider_age_p50_ms: descriptor.providerAgeP50Ms, provider_age_p95_ms: descriptor.providerAgeP95Ms,
      provider_age_max_ms: descriptor.providerAgeMaxMs, dropped_samples: descriptor.droppedSamples,
      rejected_oversize: descriptor.rejectedOversize, completed_at: completedAt,
    });
    if (!receipted) {
      await captureStore.insertHeldContractCaptureHealth({
        id: randomUUID(), source_boot_id: BOOT_ID, observed_at: completedAt,
        severity: "warning", code: "receipt_write_failed", position_id: descriptor.positionId,
        occ_symbol: descriptor.occSymbol, affected_samples: descriptor.sampleCount,
        facts: { objectKey: descriptor.objectKey, manifestKey: descriptor.manifestKey, rawEvidenceVerified: true },
      });
    }
    return receipted;
  }

  private async flush(reason: "timer" | "high-water" | "shutdown"): Promise<void> {
    if (this.flushing || !this.queue.hasPending()) return;
    this.flushing = true;
    const drain = this.queue.drain();
    try {
      const dropFacts = Object.entries(drain.droppedByPartition);
      const totalDropped = dropFacts.reduce((sum, [, value]) => sum + value.dropped, 0);
      if (totalDropped) {
        await captureStore.insertHeldContractCaptureHealth({
          id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
          severity: "warning", code: "queue_drop", position_id: null, occ_symbol: null,
          affected_samples: totalDropped,
          facts: { reason, partitions: dropFacts.length, rejectedOversize: dropFacts.reduce((sum, [, value]) => sum + value.rejectedOversize, 0) },
        });
      }
      const partitions = partitionHeldContractCapture(drain);
      let completed = 0;
      for (const partition of partitions) {
        const descriptor = buildHeldContractSegmentDescriptor(partition, config.heldContractCaptureR2Prefix);
        if (!descriptor) continue;
        try {
          await this.writePartition(descriptor);
          completed++;
        } catch (error) {
          await captureStore.insertHeldContractCaptureHealth({
            id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
            severity: "high", code: "r2_flush_failed", position_id: descriptor.positionId,
            occ_symbol: descriptor.occSymbol, affected_samples: descriptor.sampleCount + descriptor.droppedSamples,
            facts: {
              reason, objectKey: descriptor.objectKey,
              message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            },
          });
          warn(`held-contract-capture: segment failed; ${descriptor.sampleCount} research samples lost, execution unaffected — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      info(`held-contract-capture: ${reason} flush · ${drain.samples.length} samples · ${completed}/${partitions.length} immutable segment(s)${totalDropped ? ` · dropped=${totalDropped}` : ""}`);
    } catch (error) {
      warn(`held-contract-capture: flush bookkeeping failed; execution unaffected — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.flushing = false;
      if (this.queue.utilization() >= FLUSH_HIGH_WATER) void this.flush("high-water");
    }
  }
}
