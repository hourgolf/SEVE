// Phase 1H-B runtime adapter. Observation-only by construction: it receives a
// copy of SIP messages, writes immutable compressed R2 objects, and emits small
// verification receipts. It has no broker, order, position, or execution import.

import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { info, warn } from "./log.js";
import { BOOT_ID } from "./runId.js";
import * as captureStore from "./intraminuteCaptureStore.js";
import {
  BoundedIntraminuteCaptureQueue,
  INTRAMINUTE_CAPTURE_SCHEMA_VERSION,
  intraminuteCaptureWindow,
  partitionIntraminuteCapture,
  type IntraminuteCaptureEvent,
} from "./intraminuteCaptureModel.js";
import {
  INTRAMINUTE_OBSERVER_VERSION,
  intraminuteCaptureGap,
  normalizeSipQuote,
  normalizeSipTrade,
} from "./intraminuteObserverModel.js";
import type { StockStreamObserver } from "./stream.js";

const FLUSH_HIGH_WATER = 0.75;

function cleanPrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "") || "intraminute";
}

export class IntraminuteCaptureRuntime {
  private readonly queue = new BoundedIntraminuteCaptureQueue(
    config.intraminuteCaptureMaxEvents,
    config.intraminuteCaptureMaxBytes,
  );
  private readonly s3 = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
  });
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private sequence = 0;
  private lastDropLogMs = 0;

  private constructor(private readonly symbols: readonly string[]) {}

  static async create(input: { symbols: readonly string[]; paperMode: boolean }): Promise<IntraminuteCaptureRuntime | null> {
    if (!config.intraminuteCaptureEnabled) return null;
    if (!input.paperMode) { warn("intraminute-capture: disabled — paper mode required"); return null; }
    if (config.stockFeed !== "sip") { warn("intraminute-capture: disabled — SIP feed required"); return null; }
    if (!config.hasServiceRole) { warn("intraminute-capture: disabled — service role required for private receipts"); return null; }
    if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2Bucket) {
      warn("intraminute-capture: disabled — incomplete R2 credential set");
      return null;
    }
    if (!Number.isInteger(config.intraminuteCaptureMaxEvents) || config.intraminuteCaptureMaxEvents < 1
        || !Number.isInteger(config.intraminuteCaptureMaxBytes) || config.intraminuteCaptureMaxBytes < 1
        || !Number.isFinite(config.intraminuteCaptureFlushMs) || config.intraminuteCaptureFlushMs < 5_000) {
      warn("intraminute-capture: disabled — invalid queue/flush bounds");
      return null;
    }
    const schemaReady = await Promise.race([
      captureStore.intraminuteCaptureSchemaReady(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!schemaReady) {
      warn("intraminute-capture: disabled — private receipt schema unavailable");
      return null;
    }
    return new IntraminuteCaptureRuntime(input.symbols);
  }

  observer(): StockStreamObserver {
    return {
      onEvent: (raw, receivedAtMs) => this.captureRaw(raw, receivedAtMs),
      onGap: (startedAtMs, endedAtMs) => {
        if (!intraminuteCaptureWindow(endedAtMs)) return;
        for (const symbol of this.symbols) {
          const gap = intraminuteCaptureGap({ symbol, reason: "socket_reconnect", startedAtMs, endedAtMs });
          if (!gap) continue;
          this.enqueue({
            schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION,
            kind: "gap", symbol: gap.symbol, providerAtMs: gap.startedAtMs,
            receivedAtMs: gap.endedAtMs, payload: gap,
          });
        }
      },
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush("timer"); }, config.intraminuteCaptureFlushMs);
    info(`intraminute-capture: DARK enabled · SIP trades+quotes · queue=${config.intraminuteCaptureMaxEvents} events/${Math.round(config.intraminuteCaptureMaxBytes / 1_048_576)}MiB · flush=${config.intraminuteCaptureFlushMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.race([this.flush("shutdown"), new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  }

  private captureRaw(raw: unknown, receivedAtMs: number): void {
    try {
      const trade = normalizeSipTrade(raw, receivedAtMs);
      if (trade && this.symbols.includes(trade.symbol)) {
        if (!intraminuteCaptureWindow(trade.providerAtMs)) return;
        this.enqueue({ schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION, kind: "trade", symbol: trade.symbol, providerAtMs: trade.providerAtMs, receivedAtMs, payload: trade });
        return;
      }
      const quote = normalizeSipQuote(raw, receivedAtMs);
      if (quote && this.symbols.includes(quote.symbol)) {
        if (!intraminuteCaptureWindow(quote.providerAtMs)) return;
        this.enqueue({ schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION, kind: "quote", symbol: quote.symbol, providerAtMs: quote.providerAtMs, receivedAtMs, payload: quote });
      }
    } catch {
      // Capture parsing is fail-open and may never escape into the stream loop.
    }
  }

  private enqueue(event: IntraminuteCaptureEvent): void {
    const result = this.queue.enqueue(event);
    if (!result.accepted) {
      const now = Date.now();
      if (now - this.lastDropLogMs > 60_000) {
        this.lastDropLogMs = now;
        warn(`intraminute-capture: evidence shed (${result.reason}); execution unaffected`);
      }
      return;
    }
    if (result.utilization >= FLUSH_HIGH_WATER) void this.flush("high-water");
  }

  private async flush(reason: "timer" | "high-water" | "shutdown"): Promise<void> {
    if (this.flushing || this.queue.size() === 0) return;
    this.flushing = true;
    const drain = this.queue.drain();
    try {
      const partitions = partitionIntraminuteCapture(drain.events);
      let completed = 0;
      for (let i = 0; i < partitions.length; i++) {
        const partition = partitions[i];
        const seq = String(++this.sequence).padStart(8, "0");
        const hour = String(partition.hourEt).padStart(2, "0");
        const base = `${cleanPrefix(config.r2Prefix)}/v${INTRAMINUTE_CAPTURE_SCHEMA_VERSION}/date=${partition.dateEt}/symbol=${partition.symbol}/hour=${hour}/${BOOT_ID}-${seq}`;
        const objectKey = `${base}.jsonl.gz`;
        const manifestKey = `${base}.manifest.json`;
        const raw = Buffer.from(`${partition.events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
        const compressed = gzipSync(raw, { level: 6 });
        const checksum = createHash("sha256").update(compressed).digest("hex");
        const providerTimes = partition.events.map((event) => event.providerAtMs);
        const counts = {
          trade: partition.events.filter((event) => event.kind === "trade").length,
          quote: partition.events.filter((event) => event.kind === "quote").length,
          gap: partition.events.filter((event) => event.kind === "gap").length,
        };
        const completedAt = new Date().toISOString();
        const manifest = {
          schemaVersion: INTRAMINUTE_CAPTURE_SCHEMA_VERSION,
          observerVersion: INTRAMINUTE_OBSERVER_VERSION,
          sourceFeed: "sip",
          sourceBootId: BOOT_ID,
          objectKey, manifestKey,
          symbol: partition.symbol, sessionDateEt: partition.dateEt, hourEt: partition.hourEt,
          rowCount: partition.events.length, counts,
          providerMinAt: new Date(Math.min(...providerTimes)).toISOString(),
          providerMaxAt: new Date(Math.max(...providerTimes)).toISOString(),
          checksumSha256: checksum,
          compressedBytes: compressed.byteLength,
          droppedEvents: i === 0 ? drain.droppedEvents : 0,
          rejectedOversize: i === 0 ? drain.rejectedOversize : 0,
          completedAt,
        };
        await this.s3.send(new PutObjectCommand({
          Bucket: config.r2Bucket, Key: objectKey, Body: compressed,
          ContentType: "application/x-ndjson", ContentEncoding: "gzip",
          Metadata: { sha256: checksum, schema: String(INTRAMINUTE_CAPTURE_SCHEMA_VERSION), observer: INTRAMINUTE_OBSERVER_VERSION },
        }));
        const objectHead = await this.s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: objectKey }));
        if (objectHead.ContentLength !== compressed.byteLength || objectHead.Metadata?.sha256 !== checksum) {
          throw new Error(`R2 verification mismatch for ${objectKey}`);
        }
        const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");
        await this.s3.send(new PutObjectCommand({
          Bucket: config.r2Bucket, Key: manifestKey,
          Body: manifestBody, ContentType: "application/json",
        }));
        const manifestHead = await this.s3.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: manifestKey }));
        if (manifestHead.ContentLength !== manifestBody.byteLength) {
          throw new Error(`R2 manifest verification mismatch for ${manifestKey}`);
        }
        const receipted = await captureStore.insertIntraminuteCaptureReceipt({
          object_key: objectKey, manifest_key: manifestKey, schema_version: INTRAMINUTE_CAPTURE_SCHEMA_VERSION,
          observer_version: INTRAMINUTE_OBSERVER_VERSION, source_boot_id: BOOT_ID,
          source_feed: "sip", symbol: partition.symbol, session_date_et: partition.dateEt,
          hour_et: partition.hourEt, row_count: partition.events.length,
          trade_count: counts.trade, quote_count: counts.quote, gap_count: counts.gap,
          provider_min_at: manifest.providerMinAt, provider_max_at: manifest.providerMaxAt,
          checksum_sha256: checksum, compressed_bytes: compressed.byteLength,
          dropped_events: manifest.droppedEvents, rejected_oversize: manifest.rejectedOversize,
          completed_at: completedAt,
        });
        if (!receipted) await captureStore.insertIntraminuteCaptureHealth({
          id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
          severity: "warning", code: "receipt_write_failed", affected_events: 0,
          facts: { objectKey, manifestKey, rawEvidenceVerified: true },
        });
        completed++;
      }
      info(`intraminute-capture: ${reason} flush · ${drain.events.length} events · ${completed} immutable object(s)${drain.droppedEvents ? ` · dropped=${drain.droppedEvents}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await captureStore.insertIntraminuteCaptureHealth({
        id: randomUUID(), source_boot_id: BOOT_ID, observed_at: new Date().toISOString(),
        severity: "high", code: "r2_flush_failed",
        affected_events: drain.events.length + drain.droppedEvents,
        facts: { reason, retainedEvents: drain.events.length, queueDroppedEvents: drain.droppedEvents,
          message },
      });
      warn(`intraminute-capture: flush failed; ${drain.events.length} research events discarded, execution unaffected — ${message}`);
    } finally {
      this.flushing = false;
      if (this.queue.utilization() >= FLUSH_HIGH_WATER) void this.flush("high-water");
    }
  }
}
