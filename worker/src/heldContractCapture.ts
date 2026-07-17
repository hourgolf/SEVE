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
  HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS,
  HELD_CAPTURE_NORMAL_FLUSH_WALL_CLOCK_MS,
  HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS,
  isResearchAdapterTimeout,
  withResearchAdapterDeadline,
  type HeldCaptureAdapterStage,
} from "./researchAdapterDeadline.js";
import {
  BoundedHeldContractCaptureQueue,
  HeldContractCaptureBatcher,
  buildHeldContractSegmentDescriptor,
  normalizeHeldContractCaptureSample,
  type HeldContractCaptureInput,
  type HeldContractCaptureFlushReason,
  type HeldContractSegmentDescriptor,
} from "./heldContractCaptureModel.js";

const FLUSH_HIGH_WATER = 0.75;
const SHUTDOWN_HEALTH_RESERVE_MS = 5_000;
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
  private readonly batcher = new HeldContractCaptureBatcher(
    config.heldContractCaptureBatchTargetSamples,
    config.heldContractCaptureBatchMaxAgeMs,
    config.heldContractCaptureStateMaxSamples,
    config.heldContractCaptureStateMaxBytes,
    config.heldContractCaptureRetryMaxAttempts,
    config.heldContractCaptureRetryBaseDelayMs,
    config.heldContractCaptureRetryMaxDelayMs,
  );
  private readonly s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
  });
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private normalFlushPending = false;
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
        || !Number.isFinite(config.heldContractCaptureFlushMs) || config.heldContractCaptureFlushMs < 5_000
        || !Number.isInteger(config.heldContractCaptureBatchTargetSamples) || config.heldContractCaptureBatchTargetSamples < 1
        || !Number.isInteger(config.heldContractCaptureBatchMaxAgeMs)
        || config.heldContractCaptureBatchMaxAgeMs < config.heldContractCaptureFlushMs
        || !Number.isInteger(config.heldContractCaptureStateMaxSamples) || config.heldContractCaptureStateMaxSamples < 1
        || !Number.isInteger(config.heldContractCaptureStateMaxBytes) || config.heldContractCaptureStateMaxBytes < 1
        || !Number.isInteger(config.heldContractCaptureRetryMaxAttempts) || config.heldContractCaptureRetryMaxAttempts < 1
        || !Number.isInteger(config.heldContractCaptureRetryBaseDelayMs) || config.heldContractCaptureRetryBaseDelayMs < 1
        || !Number.isInteger(config.heldContractCaptureRetryMaxDelayMs)
        || config.heldContractCaptureRetryMaxDelayMs < config.heldContractCaptureRetryBaseDelayMs) {
      warn("held-contract-capture: disabled — invalid queue/flush bounds");
      return null;
    }
    let schemaReady = false;
    try { schemaReady = await captureStore.heldContractCaptureSchemaReady(Date.now() + 2_000); }
    catch (error) {
      warn(`held-contract-capture: disabled — censor=adapter_timeout stage=${isResearchAdapterTimeout(error) ? error.stage : "supabase_schema_probe"}`);
    }
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
    info(`held-contract-capture: DARK enabled · targeted OPRA snapshots · queue=${config.heldContractCaptureMaxSamples} samples/${Math.round(config.heldContractCaptureMaxBytes / 1_048_576)}MiB · retained=${config.heldContractCaptureStateMaxSamples} samples/${Math.round(config.heldContractCaptureStateMaxBytes / 1_048_576)}MiB · drain=${config.heldContractCaptureFlushMs}ms · batch=${config.heldContractCaptureBatchTargetSamples} samples/${config.heldContractCaptureBatchMaxAgeMs}ms · retry=${config.heldContractCaptureRetryMaxAttempts} · adapterDeadline=${HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS}ms · shutdownCeiling=${HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS}ms`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const shutdownDeadlineAtMs = Date.now() + HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS;
    const workDeadlineAtMs = shutdownDeadlineAtMs - SHUTDOWN_HEALTH_RESERVE_MS;
    for (let attempt = 0; attempt < config.heldContractCaptureRetryMaxAttempts
      && Date.now() < workDeadlineAtMs
      && (this.queue.hasPending() || this.batcher.sampleCount() > 0); attempt++) {
      await this.flush("shutdown", workDeadlineAtMs);
    }
    const queued = this.queue.drain();
    const abandoned = this.batcher.abandonAll();
    const queueDrops = Object.values(queued.droppedByPartition).reduce((sum, row) => sum + row.dropped, 0);
    const abandonedSamples = queued.samples.length + queueDrops + abandoned.reduce((sum, row) => sum + row.samples, 0);
    const abandonedBytes = queued.estimatedBytes + abandoned.reduce((sum, row) => sum + row.estimatedBytes, 0);
    if (abandonedSamples) {
      warn(`held-contract-capture: censor=shutdown_abandoned samples=${abandonedSamples} bytes=${abandonedBytes}; execution shutdown continues`);
      await this.emitHealth({
        id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
        severity: "high", code: "queue_drop", position_id: null, occ_symbol: null,
        affected_samples: abandonedSamples,
        facts: { censorCode: "shutdown_abandoned", estimatedBytes: abandonedBytes, wallClockCeilingMs: HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS },
      }, shutdownDeadlineAtMs);
    } else info(`held-contract-capture: shutdown drained · shed=${this.batcher.shedTotals().samples} research samples`);
  }

  private async r2<T>(stage: HeldCaptureAdapterStage, deadlineAtMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return withResearchAdapterDeadline({
      stage, requestTimeoutMs: HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS, overallDeadlineAtMs: deadlineAtMs, operation,
    });
  }

  private async emitHealth(row: captureStore.HeldContractCaptureHealthRow, deadlineAtMs: number): Promise<void> {
    try { await captureStore.insertHeldContractCaptureHealth(row, deadlineAtMs); }
    catch (error) {
      warn(`held-contract-capture: censor=adapter_timeout stage=${isResearchAdapterTimeout(error) ? error.stage : "supabase_health_write"} original=${String(row.facts.censorCode ?? row.code)}`);
    }
  }

  private async emitRetryExhausted(descriptor: HeldContractSegmentDescriptor, deadlineAtMs: number, stage: string): Promise<void> {
    warn(`held-contract-capture: censor=retry_exhausted stage=${stage} samples=${descriptor.sampleCount + descriptor.droppedSamples}`);
    await this.emitHealth({
      id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
      severity: "high", code: stage.startsWith("supabase") ? "receipt_write_failed" : "r2_flush_failed",
      position_id: descriptor.positionId, occ_symbol: descriptor.occSymbol,
      affected_samples: descriptor.sampleCount + descriptor.droppedSamples,
      facts: { censorCode: "retry_exhausted", stage, objectKey: descriptor.objectKey, retryMaxAttempts: config.heldContractCaptureRetryMaxAttempts },
    }, deadlineAtMs);
  }

  private async writePartition(descriptor: HeldContractSegmentDescriptor, deadlineAtMs: number): Promise<boolean> {
    const compressed = await gzipAsync(descriptor.rawNdjson, { level: 6 });
    const compressedSha256 = createHash("sha256").update(compressed).digest("hex");
    // Segment identity and manifest bytes stay retry-stable. The last included
    // fetch is the deterministic segment completion clock; upload attempts are
    // operational telemetry, not evidence identity.
    const completedAt = descriptor.lastFetchAt;
    const manifest = manifestFor(descriptor, compressedSha256, compressed.byteLength, completedAt);
    const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");

    await this.r2("r2_object_write", deadlineAtMs, (abortSignal) => this.s3.send(new PutObjectCommand({
      Bucket: config.r2Bucket, Key: descriptor.objectKey, Body: compressed,
      ContentType: "application/x-ndjson", ContentEncoding: "gzip",
      Metadata: {
        content_sha256: descriptor.contentSha256,
        compressed_sha256: compressedSha256,
        schema: String(descriptor.schemaVersion),
        capture: descriptor.captureVersion,
      },
    }), { abortSignal }));
    const objectHead = await this.r2("r2_object_head", deadlineAtMs, (abortSignal) => this.s3.send(
      new HeadObjectCommand({ Bucket: config.r2Bucket, Key: descriptor.objectKey }), { abortSignal },
    ));
    if (objectHead.ContentLength !== compressed.byteLength
        || objectHead.Metadata?.content_sha256 !== descriptor.contentSha256
        || objectHead.Metadata?.compressed_sha256 !== compressedSha256) {
      throw new Error(`R2 verification mismatch for ${descriptor.objectKey}`);
    }

    await this.r2("r2_manifest_write", deadlineAtMs, (abortSignal) => this.s3.send(new PutObjectCommand({
      Bucket: config.r2Bucket, Key: descriptor.manifestKey, Body: manifestBody, ContentType: "application/json",
    }), { abortSignal }));
    const manifestHead = await this.r2("r2_manifest_head", deadlineAtMs, (abortSignal) => this.s3.send(
      new HeadObjectCommand({ Bucket: config.r2Bucket, Key: descriptor.manifestKey }), { abortSignal },
    ));
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
    }, deadlineAtMs);
    if (!receipted) {
      await this.emitHealth({
        id: randomUUID(), source_boot_id: BOOT_ID, observed_at: completedAt,
        severity: "warning", code: "receipt_write_failed", position_id: descriptor.positionId,
        occ_symbol: descriptor.occSymbol, affected_samples: descriptor.sampleCount,
        facts: { censorCode: "receipt_write_failed", objectKey: descriptor.objectKey, manifestKey: descriptor.manifestKey, rawEvidenceVerified: true },
      }, deadlineAtMs);
    }
    return receipted;
  }

  private flush(reason: HeldContractCaptureFlushReason, deadlineAtMs?: number): Promise<void> {
    if (reason !== "shutdown" && this.normalFlushPending) return this.flushChain;
    if (reason !== "shutdown") this.normalFlushPending = true;
    const scheduled = this.flushChain.then(() => this.flushOnce(
      reason, deadlineAtMs ?? Date.now() + HELD_CAPTURE_NORMAL_FLUSH_WALL_CLOCK_MS,
    )).finally(() => { if (reason !== "shutdown") this.normalFlushPending = false; });
    this.flushChain = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async flushOnce(reason: HeldContractCaptureFlushReason, deadlineAtMs: number): Promise<void> {
    if (!this.queue.hasPending() && this.batcher.sampleCount() === 0) return;
    const drain = this.queue.hasPending()
      ? this.queue.drain()
      : { samples: [], estimatedBytes: 0, droppedByPartition: {} };
    try {
      const accepted = this.batcher.accept(drain);
      const dropFacts = Object.entries(drain.droppedByPartition);
      const totalDropped = dropFacts.reduce((sum, [, value]) => sum + value.dropped, 0);
      if (totalDropped) {
        await this.emitHealth({
          id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
          severity: "warning", code: "queue_drop", position_id: null, occ_symbol: null,
          affected_samples: totalDropped,
          facts: { reason, partitions: dropFacts.length, rejectedOversize: dropFacts.reduce((sum, [, value]) => sum + value.rejectedOversize, 0) },
        }, deadlineAtMs);
      }
      if (accepted.shed.length) {
        const shedSamples = accepted.shed.reduce((sum, row) => sum + row.samples, 0);
        const shedBytes = accepted.shed.reduce((sum, row) => sum + row.estimatedBytes, 0);
        await this.emitHealth({
          id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
          severity: "high", code: "queue_drop", position_id: null, occ_symbol: null,
          affected_samples: shedSamples,
          facts: { reason: "retained_state_capacity", estimatedBytes: shedBytes, stateSamples: this.batcher.sampleCount(), stateBytes: this.batcher.estimatedBytes() },
        }, deadlineAtMs);
      }
      const nowMs = Date.now();
      const batches = this.batcher.sealReady(reason, nowMs);
      let completed = 0;
      for (const batch of batches) {
        if (Date.now() >= deadlineAtMs) break;
        const descriptor = buildHeldContractSegmentDescriptor(batch.partition, config.heldContractCaptureR2Prefix);
        if (!descriptor) { this.batcher.acknowledge(batch.token); continue; }
        try {
          const receipted = await this.writePartition(descriptor, deadlineAtMs);
          if (receipted) {
            this.batcher.acknowledge(batch.token);
            completed++;
          } else {
            const evicted = this.batcher.recordFailure(batch.token, Date.now());
            if (evicted) await this.emitRetryExhausted(descriptor, deadlineAtMs, "supabase_receipt_write");
            warn(`held-contract-capture: receipt ${evicted ? "retry budget exhausted; evidence censored" : "retry retained with backoff"} · ${descriptor.sampleCount} samples · ${descriptor.objectKey}`);
          }
        } catch (error) {
          const evicted = this.batcher.recordFailure(batch.token, Date.now());
          const timeout = isResearchAdapterTimeout(error);
          const stage = timeout ? error.stage : "r2_adapter";
          await this.emitHealth({
            id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
            severity: "high", code: stage.startsWith("supabase") ? "receipt_write_failed" : "r2_flush_failed", position_id: descriptor.positionId,
            occ_symbol: descriptor.occSymbol, affected_samples: descriptor.sampleCount + descriptor.droppedSamples,
            facts: {
              reason, objectKey: descriptor.objectKey, censorCode: timeout ? "adapter_timeout" : "adapter_failed", stage,
              message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            },
          }, deadlineAtMs);
          if (evicted) await this.emitRetryExhausted(descriptor, deadlineAtMs, stage);
          warn(`held-contract-capture: segment ${evicted ? "retry budget exhausted; evidence censored" : "retry retained with backoff"}; execution unaffected — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      info(`held-contract-capture: ${reason} flush · ${drain.samples.length} drained · ${completed}/${batches.length} immutable segment(s) · open=${this.batcher.openPartitionCount()} · retry=${this.batcher.sealedBatchCount()} · state=${this.batcher.sampleCount()} samples/${this.batcher.estimatedBytes()} bytes${totalDropped || accepted.shed.length ? ` · dropped=${totalDropped + accepted.shed.reduce((sum, row) => sum + row.samples, 0)}` : ""}`);
    } catch (error) {
      warn(`held-contract-capture: flush bookkeeping failed; execution unaffected — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.queue.utilization() >= FLUSH_HIGH_WATER) void this.flush("high-water");
    }
  }
}
