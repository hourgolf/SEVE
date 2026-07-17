// Phase 1K-G pure held-contract OPRA capture model. This module owns no
// provider request, timer, storage client, database client, broker, order, or
// position mutation. Runtime adapters may only feed it completed observations
// and persist its immutable segment descriptors off the execution path.

import { createHash } from "node:crypto";
import { deterministicEvidenceUuid } from "../../lib/evidence/identity";

export const HELD_CONTRACT_CAPTURE_SCHEMA_VERSION = 1 as const;
export const HELD_CONTRACT_CAPTURE_VERSION = "held-contract-opra-snapshot-v1" as const;
export const HELD_CONTRACT_MAX_OBSERVATION_GAP_MS = 15_000;
export const HELD_CONTRACT_QUOTE_EVENT_MAX_AGE_MS = 15_000;
export const HELD_CONTRACT_SNAPSHOT_MAX_AGE_MS = 15_000;

export type HeldContractRequestOutcome = "success" | "provider_error" | "not_requested";
export type HeldContractSampleQuality =
  | "eligible"
  | "snapshot_stale"
  | "quote_event_stale"
  | "missing_quote"
  | "invalid_quote"
  | "crossed_quote"
  | "future_quote"
  | "request_failed";

export interface HeldContractCaptureInput {
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  sourceBootId: string;
  sourceVersion: string;
  feed: "opra";
  requestOutcome: HeldContractRequestOutcome;
  failureCode?: string | null;
  fetchStartedAtMs: number;
  fetchCompletedAtMs: number;
  observedAtMs: number;
  providerQuoteAtMs?: number | null;
  bid?: number | null;
  ask?: number | null;
  bidSize?: number | null;
  askSize?: number | null;
}

export interface HeldContractCaptureTarget {
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
}

export interface HeldContractFetchQuote {
  occSymbol: string;
  bid: number;
  ask: number;
  bidSize: number | null;
  askSize: number | null;
  quoteAtMs: number;
  feed: "opra" | "indicative";
}

export interface HeldContractFetchObservation {
  requestedSymbols: readonly string[];
  requestOutcome: HeldContractRequestOutcome;
  failureCode?: string | null;
  fetchStartedAtMs: number;
  fetchCompletedAtMs: number;
  observedAtMs: number;
  quotes: ReadonlyMap<string, HeldContractFetchQuote>;
  sourceBootId: string;
  sourceVersion: string;
}

export interface HeldContractCaptureSample {
  schemaVersion: typeof HELD_CONTRACT_CAPTURE_SCHEMA_VERSION;
  captureVersion: typeof HELD_CONTRACT_CAPTURE_VERSION;
  id: string;
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  sourceBootId: string;
  sourceVersion: string;
  feed: "opra";
  requestOutcome: HeldContractRequestOutcome;
  quality: HeldContractSampleQuality;
  failureCode: string | null;
  fetchStartedAtMs: number;
  fetchCompletedAtMs: number;
  fetchDurationMs: number;
  observedAtMs: number;
  snapshotAgeMs: number;
  providerQuoteAtMs: number | null;
  providerQuoteEventAgeMs: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
}

export interface HeldContractCaptureThresholds {
  snapshotMaxAgeMs: number;
  quoteEventMaxAgeMs: number;
  maxObservationGapMs: number;
}

export interface HeldContractCaptureDrain {
  samples: readonly HeldContractCaptureSample[];
  estimatedBytes: number;
  droppedByPartition: Readonly<Record<string, { dropped: number; rejectedOversize: number }>>;
}

export interface HeldContractCapturePartition {
  dateEt: string;
  hourEt: number;
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  sourceBootId: string;
  sourceVersion: string;
  samples: readonly HeldContractCaptureSample[];
  droppedSamples: number;
  rejectedOversize: number;
}

export interface HeldContractCaptureBatch {
  token: string;
  partition: HeldContractCapturePartition;
  estimatedBytes: number;
  attempts: number;
  nextAttemptAtMs: number;
}

export interface HeldContractBatcherShed {
  reason: "state_samples" | "state_bytes" | "retry_budget" | "shutdown_abandoned";
  samples: number;
  estimatedBytes: number;
  positionId: string | null;
  occSymbol: string | null;
  token: string | null;
}

export interface HeldContractBatcherAcceptResult {
  acceptedSamples: number;
  shed: readonly HeldContractBatcherShed[];
}

export type HeldContractCaptureFlushReason = "timer" | "high-water" | "shutdown";

export interface HeldContractSegmentDescriptor {
  id: string;
  schemaVersion: typeof HELD_CONTRACT_CAPTURE_SCHEMA_VERSION;
  captureVersion: typeof HELD_CONTRACT_CAPTURE_VERSION;
  sourceFeed: "opra";
  sourceBootId: string;
  sourceVersion: string;
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  sessionDateEt: string;
  hourEt: number;
  objectKey: string;
  manifestKey: string;
  contentSha256: string;
  rawBytes: number;
  sampleCount: number;
  successfulQuoteCount: number;
  requestFailureCount: number;
  missingQuoteCount: number;
  invalidQuoteCount: number;
  eligibleCount: number;
  staleSnapshotCount: number;
  staleQuoteEventCount: number;
  firstFetchAt: string;
  lastFetchAt: string;
  providerMinAt: string | null;
  providerMaxAt: string | null;
  gapCount: number;
  maxObservationGapMs: number | null;
  providerAgeP50Ms: number | null;
  providerAgeP95Ms: number | null;
  providerAgeMaxMs: number | null;
  droppedSamples: number;
  rejectedOversize: number;
  rawNdjson: Buffer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OCC = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegativeInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const DEFAULT_THRESHOLDS: HeldContractCaptureThresholds = {
  snapshotMaxAgeMs: HELD_CONTRACT_SNAPSHOT_MAX_AGE_MS,
  quoteEventMaxAgeMs: HELD_CONTRACT_QUOTE_EVENT_MAX_AGE_MS,
  maxObservationGapMs: HELD_CONTRACT_MAX_OBSERVATION_GAP_MS,
};

function validThresholds(value: HeldContractCaptureThresholds): boolean {
  return Number.isInteger(value.snapshotMaxAgeMs) && value.snapshotMaxAgeMs > 0
    && Number.isInteger(value.quoteEventMaxAgeMs) && value.quoteEventMaxAgeMs > 0
    && Number.isInteger(value.maxObservationGapMs) && value.maxObservationGapMs > 0;
}

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

function contractKey(input: Pick<HeldContractCaptureSample, "positionId" | "occSymbol">): string {
  return `${input.positionId}|${input.occSymbol}`;
}

function capturePartitionKey(sample: HeldContractCaptureSample): string {
  const { dateEt, hourEt } = etPartition(sample.fetchCompletedAtMs);
  return [dateEt, hourEt, contractKey(sample), sample.sourceBootId, sample.sourceVersion].join("|");
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hour12: false,
});

function etPartition(ms: number): { dateEt: string; hourEt: number } {
  let year = "", month = "", day = "", hour = 0;
  for (const part of ET_PARTS.formatToParts(new Date(ms))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
  }
  return { dateEt: `${year}-${month}-${day}`, hourEt: hour };
}

export function normalizeHeldContractCaptureSample(
  input: HeldContractCaptureInput,
  thresholds: HeldContractCaptureThresholds = DEFAULT_THRESHOLDS,
): HeldContractCaptureSample | null {
  const occSymbol = input.occSymbol.trim().toUpperCase();
  const underlying = input.underlying.trim().toUpperCase();
  if (!UUID.test(input.positionId) || !UUID.test(input.strategistId) || !UUID.test(input.accountId)
      || !UUID.test(input.sourceBootId) || !OCC.test(occSymbol) || !SYMBOL.test(underlying)
      || !text(input.channelSlug) || !text(input.sourceVersion) || input.feed !== "opra"
      || !validThresholds(thresholds)
      || !finite(input.fetchStartedAtMs) || !finite(input.fetchCompletedAtMs) || !finite(input.observedAtMs)
      || input.fetchCompletedAtMs < input.fetchStartedAtMs || input.observedAtMs < input.fetchCompletedAtMs) return null;

  const snapshotAgeMs = Math.round(input.observedAtMs - input.fetchCompletedAtMs);
  let quality: HeldContractSampleQuality;
  let providerQuoteAtMs: number | null = null;
  let providerQuoteEventAgeMs: number | null = null;
  let bid: number | null = null;
  let ask: number | null = null;
  let bidSize: number | null = null;
  let askSize: number | null = null;
  let failureCode = text(input.failureCode) ? input.failureCode!.trim().slice(0, 120) : null;

  if (input.requestOutcome !== "success") {
    quality = "request_failed";
    failureCode ??= input.requestOutcome === "provider_error" ? "provider_error" : "not_requested";
  } else if (!finite(input.providerQuoteAtMs) || input.providerQuoteAtMs <= 0
      || input.bid == null || input.ask == null) {
    quality = "missing_quote";
    failureCode ??= "missing_latest_quote";
  } else if (!finite(input.bid) || !finite(input.ask) || input.bid <= 0 || input.ask <= 0) {
    providerQuoteAtMs = Math.round(input.providerQuoteAtMs);
    providerQuoteEventAgeMs = input.providerQuoteAtMs <= input.observedAtMs
      ? Math.round(input.observedAtMs - input.providerQuoteAtMs)
      : null;
    quality = "invalid_quote";
    failureCode ??= "nonpositive_nbbo";
  } else if (input.ask < input.bid) {
    providerQuoteAtMs = Math.round(input.providerQuoteAtMs);
    providerQuoteEventAgeMs = input.providerQuoteAtMs <= input.observedAtMs
      ? Math.round(input.observedAtMs - input.providerQuoteAtMs)
      : null;
    quality = "crossed_quote";
    failureCode ??= "crossed_nbbo";
  } else if (input.providerQuoteAtMs > input.observedAtMs) {
    providerQuoteAtMs = Math.round(input.providerQuoteAtMs);
    quality = "future_quote";
    failureCode ??= "provider_time_after_observation";
  } else if ((input.bidSize != null && !nonnegativeInteger(input.bidSize))
      || (input.askSize != null && !nonnegativeInteger(input.askSize))) {
    providerQuoteAtMs = Math.round(input.providerQuoteAtMs);
    providerQuoteEventAgeMs = Math.round(input.observedAtMs - input.providerQuoteAtMs);
    quality = "invalid_quote";
    failureCode ??= "invalid_nbbo_size";
  } else {
    providerQuoteAtMs = Math.round(input.providerQuoteAtMs);
    providerQuoteEventAgeMs = Math.round(input.observedAtMs - input.providerQuoteAtMs);
    bid = input.bid;
    ask = input.ask;
    bidSize = input.bidSize == null ? null : input.bidSize;
    askSize = input.askSize == null ? null : input.askSize;
    if (snapshotAgeMs > thresholds.snapshotMaxAgeMs) quality = "snapshot_stale";
    else if (providerQuoteEventAgeMs > thresholds.quoteEventMaxAgeMs) quality = "quote_event_stale";
    else quality = "eligible";
  }

  const identity = {
    positionId: input.positionId, occSymbol, sourceBootId: input.sourceBootId,
    fetchStartedAtMs: Math.round(input.fetchStartedAtMs), fetchCompletedAtMs: Math.round(input.fetchCompletedAtMs),
    providerQuoteAtMs, requestOutcome: input.requestOutcome,
  };
  return {
    schemaVersion: HELD_CONTRACT_CAPTURE_SCHEMA_VERSION,
    captureVersion: HELD_CONTRACT_CAPTURE_VERSION,
    id: deterministicEvidenceUuid("seve-held-contract-capture-v1", identity),
    positionId: input.positionId, strategistId: input.strategistId, accountId: input.accountId,
    channelSlug: input.channelSlug.trim(), occSymbol, underlying,
    sourceBootId: input.sourceBootId, sourceVersion: input.sourceVersion.trim(), feed: "opra",
    requestOutcome: input.requestOutcome, quality, failureCode,
    fetchStartedAtMs: Math.round(input.fetchStartedAtMs),
    fetchCompletedAtMs: Math.round(input.fetchCompletedAtMs),
    fetchDurationMs: Math.round(input.fetchCompletedAtMs - input.fetchStartedAtMs),
    observedAtMs: Math.round(input.observedAtMs), snapshotAgeMs,
    providerQuoteAtMs, providerQuoteEventAgeMs, bid, ask, bidSize, askSize,
  };
}

/** Fan one provider request out to position-scoped evidence. Multiple manager
 * arms for the same position/OCC collapse to one sample, while two positions
 * sharing an OCC remain independent. */
export function heldContractCaptureInputsForFetch(
  targets: readonly HeldContractCaptureTarget[],
  fetch: HeldContractFetchObservation,
): HeldContractCaptureInput[] {
  const requested = new Set(fetch.requestedSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const unique = new Map<string, HeldContractCaptureTarget>();
  for (const target of targets) {
    const occSymbol = target.occSymbol.trim().toUpperCase();
    if (!requested.has(occSymbol)) continue;
    unique.set(`${target.positionId}|${occSymbol}`, { ...target, occSymbol });
  }
  return [...unique.values()].sort((a, b) => `${a.positionId}|${a.occSymbol}`.localeCompare(`${b.positionId}|${b.occSymbol}`)).map((target) => {
    const quote = fetch.quotes.get(target.occSymbol);
    return {
      ...target,
      sourceBootId: fetch.sourceBootId,
      sourceVersion: fetch.sourceVersion,
      feed: "opra" as const,
      requestOutcome: fetch.requestOutcome,
      failureCode: fetch.failureCode ?? null,
      fetchStartedAtMs: fetch.fetchStartedAtMs,
      fetchCompletedAtMs: fetch.fetchCompletedAtMs,
      observedAtMs: fetch.observedAtMs,
      providerQuoteAtMs: quote?.feed === "opra" ? quote.quoteAtMs : null,
      bid: quote?.feed === "opra" ? quote.bid : null,
      ask: quote?.feed === "opra" ? quote.ask : null,
      bidSize: quote?.feed === "opra" ? quote.bidSize : null,
      askSize: quote?.feed === "opra" ? quote.askSize : null,
    };
  });
}

/** A synchronous bounded queue. Capacity pressure sheds research evidence and
 * records the affected position/OCC; it never waits for storage or execution. */
export class BoundedHeldContractCaptureQueue {
  private samples: HeldContractCaptureSample[] = [];
  private sampleIds = new Set<string>();
  private estimatedBytes = 0;
  private drops = new Map<string, { dropped: number; rejectedOversize: number }>();

  constructor(readonly maxSamples: number, readonly maxBytes: number) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error("maxSamples must be a positive integer");
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer");
  }

  enqueue(sample: HeldContractCaptureSample): { accepted: boolean; utilization: number; reason?: "duplicate" | "oversize" | "capacity" } {
    if (this.sampleIds.has(sample.id)) {
      return { accepted: false, utilization: this.utilization(), reason: "duplicate" };
    }
    const bytes = Buffer.byteLength(stable(sample), "utf8") + 1;
    const key = capturePartitionKey(sample);
    if (bytes > this.maxBytes) {
      const current = this.drops.get(key) ?? { dropped: 0, rejectedOversize: 0 };
      this.drops.set(key, { dropped: current.dropped + 1, rejectedOversize: current.rejectedOversize + 1 });
      return { accepted: false, utilization: this.utilization(), reason: "oversize" };
    }
    if (this.samples.length >= this.maxSamples || this.estimatedBytes + bytes > this.maxBytes) {
      const current = this.drops.get(key) ?? { dropped: 0, rejectedOversize: 0 };
      this.drops.set(key, { ...current, dropped: current.dropped + 1 });
      return { accepted: false, utilization: this.utilization(), reason: "capacity" };
    }
    this.samples.push(sample);
    this.sampleIds.add(sample.id);
    this.estimatedBytes += bytes;
    return { accepted: true, utilization: this.utilization() };
  }

  size(): number { return this.samples.length; }
  droppedCount(): number { return [...this.drops.values()].reduce((sum, value) => sum + value.dropped, 0); }
  hasPending(): boolean { return this.samples.length > 0 || this.drops.size > 0; }
  utilization(): number { return Math.max(this.samples.length / this.maxSamples, this.estimatedBytes / this.maxBytes); }

  drain(): HeldContractCaptureDrain {
    const droppedByPartition = Object.fromEntries([...this.drops.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const drained = { samples: this.samples, estimatedBytes: this.estimatedBytes, droppedByPartition };
    this.samples = [];
    this.sampleIds = new Set();
    this.estimatedBytes = 0;
    this.drops = new Map();
    return drained;
  }
}

/** Provider/fetch time owns the partition. Position identity remains explicit
 * even when multiple positions share one OCC snapshot. */
export function partitionHeldContractCapture(drain: HeldContractCaptureDrain): HeldContractCapturePartition[] {
  const groups = new Map<string, Omit<HeldContractCapturePartition, "samples" | "droppedSamples" | "rejectedOversize"> & { samples: HeldContractCaptureSample[] }>();
  for (const sample of drain.samples) {
    const { dateEt, hourEt } = etPartition(sample.fetchCompletedAtMs);
    const key = [dateEt, hourEt, sample.positionId, sample.occSymbol, sample.sourceBootId, sample.sourceVersion].join("|");
    const group = groups.get(key) ?? {
      dateEt, hourEt, positionId: sample.positionId, strategistId: sample.strategistId,
      accountId: sample.accountId, channelSlug: sample.channelSlug, occSymbol: sample.occSymbol,
      underlying: sample.underlying, sourceBootId: sample.sourceBootId, sourceVersion: sample.sourceVersion,
      samples: [],
    };
    group.samples.push(sample);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const dropped = drain.droppedByPartition[[group.dateEt, group.hourEt, `${group.positionId}|${group.occSymbol}`, group.sourceBootId, group.sourceVersion].join("|")]
      ?? { dropped: 0, rejectedOversize: 0 };
    return {
      ...group,
      samples: [...group.samples].sort((a, b) => a.fetchCompletedAtMs - b.fetchCompletedAtMs || a.id.localeCompare(b.id)),
      droppedSamples: dropped.dropped,
      rejectedOversize: dropped.rejectedOversize,
    };
  });
}

function partitionIdentity(partition: Pick<HeldContractCapturePartition,
  "dateEt" | "hourEt" | "positionId" | "occSymbol" | "sourceBootId" | "sourceVersion">): string {
  return [partition.dateEt, partition.hourEt, partition.positionId, partition.occSymbol,
    partition.sourceBootId, partition.sourceVersion].join("|");
}

function batchToken(partition: HeldContractCapturePartition): string {
  return createHash("sha256").update(stable({
    partition: partitionIdentity(partition),
    sampleIds: partition.samples.map((sample) => sample.id),
    droppedSamples: partition.droppedSamples,
    rejectedOversize: partition.rejectedOversize,
  })).digest("hex");
}

function estimatedSampleBytes(sample: HeldContractCaptureSample): number {
  return Buffer.byteLength(stable(sample), "utf8") + 1;
}

function estimatedPartitionBytes(partition: HeldContractCapturePartition): number {
  return partition.samples.reduce((sum, sample) => sum + estimatedSampleBytes(sample), 0);
}

/** Coalesces the existing position/OCC/hour partitions across short queue
 * drains. Ready batches are sealed before I/O, so an R2 or receipt retry keeps
 * byte-identical content while later samples enter a new open batch. */
export class HeldContractCaptureBatcher {
  private open = new Map<string, HeldContractCapturePartition>();
  private sealed = new Map<string, HeldContractCaptureBatch>();
  private retainedSamples = 0;
  private retainedBytes = 0;
  private totalShedSamples = 0;
  private totalShedBytes = 0;

  constructor(
    readonly targetSamples: number,
    readonly maxAgeMs: number,
    readonly maxStateSamples = 10_000,
    readonly maxStateBytes = 8 * 1024 * 1024,
    readonly retryMaxAttempts = 5,
    readonly retryBaseDelayMs = 30_000,
    readonly retryMaxDelayMs = 300_000,
  ) {
    if (!Number.isInteger(targetSamples) || targetSamples < 1) throw new Error("targetSamples must be a positive integer");
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error("maxAgeMs must be a positive integer");
    if (!Number.isInteger(maxStateSamples) || maxStateSamples < 1) throw new Error("maxStateSamples must be a positive integer");
    if (!Number.isInteger(maxStateBytes) || maxStateBytes < 1) throw new Error("maxStateBytes must be a positive integer");
    if (!Number.isInteger(retryMaxAttempts) || retryMaxAttempts < 1) throw new Error("retryMaxAttempts must be a positive integer");
    if (!Number.isInteger(retryBaseDelayMs) || retryBaseDelayMs < 1) throw new Error("retryBaseDelayMs must be a positive integer");
    if (!Number.isInteger(retryMaxDelayMs) || retryMaxDelayMs < retryBaseDelayMs) throw new Error("retryMaxDelayMs must be at least retryBaseDelayMs");
  }

  accept(drain: HeldContractCaptureDrain): HeldContractBatcherAcceptResult {
    const partitions = partitionHeldContractCapture(drain);
    const partitionKeys = new Set(partitions.map(partitionIdentity));
    const shed: HeldContractBatcherShed[] = [];
    let acceptedSamples = 0;
    for (const incoming of partitions) {
      const key = partitionIdentity(incoming);
      const current = this.open.get(key);
      const known = new Set(current?.samples.map((sample) => sample.id) ?? []);
      const accepted: HeldContractCaptureSample[] = [];
      let stateShed = 0;
      for (const sample of incoming.samples) {
        if (known.has(sample.id)) continue;
        const bytes = estimatedSampleBytes(sample);
        const reason = this.retainedSamples >= this.maxStateSamples
          ? "state_samples"
          : this.retainedBytes + bytes > this.maxStateBytes ? "state_bytes" : null;
        if (reason) {
          this.totalShedSamples++;
          this.totalShedBytes += bytes;
          stateShed++;
          shed.push({ reason, samples: 1, estimatedBytes: bytes, positionId: incoming.positionId, occSymbol: incoming.occSymbol, token: null });
          continue;
        }
        known.add(sample.id);
        accepted.push(sample);
        this.retainedSamples++;
        this.retainedBytes += bytes;
        acceptedSamples++;
      }
      if (!current && !accepted.length) continue;
      const samples = [...(current?.samples ?? []), ...accepted]
        .sort((a, b) => a.fetchCompletedAtMs - b.fetchCompletedAtMs || a.id.localeCompare(b.id));
      this.open.set(key, {
        ...incoming,
        ...current,
        samples,
        droppedSamples: (current?.droppedSamples ?? 0) + incoming.droppedSamples + stateShed,
        rejectedOversize: (current?.rejectedOversize ?? 0) + incoming.rejectedOversize,
      });
    }
    for (const [key, dropped] of Object.entries(drain.droppedByPartition)) {
      if (partitionKeys.has(key)) continue;
      const current = this.open.get(key);
      if (!current) continue;
      this.open.set(key, {
        ...current,
        droppedSamples: current.droppedSamples + dropped.dropped,
        rejectedOversize: current.rejectedOversize + dropped.rejectedOversize,
      });
    }
    return { acceptedSamples, shed };
  }

  sealReady(reason: HeldContractCaptureFlushReason, nowMs: number): HeldContractCaptureBatch[] {
    if (!finite(nowMs)) throw new Error("nowMs must be finite");
    const currentPartition = etPartition(nowMs);
    for (const [key, partition] of this.open) {
      const firstAt = partition.samples[0]?.fetchCompletedAtMs ?? nowMs;
      const crossedBoundary = partition.dateEt !== currentPartition.dateEt || partition.hourEt !== currentPartition.hourEt;
      const ready = reason !== "timer" || crossedBoundary
        || partition.samples.length >= this.targetSamples || nowMs - firstAt >= this.maxAgeMs;
      if (!ready) continue;
      const token = batchToken(partition);
      this.sealed.set(token, {
        token,
        partition,
        estimatedBytes: estimatedPartitionBytes(partition),
        attempts: 0,
        nextAttemptAtMs: 0,
      });
      this.open.delete(key);
    }
    return this.pending(nowMs, reason === "shutdown");
  }

  pending(nowMs = Number.POSITIVE_INFINITY, force = false): HeldContractCaptureBatch[] {
    return [...this.sealed.values()]
      .filter((batch) => force || batch.nextAttemptAtMs <= nowMs)
      .sort((a, b) => a.token.localeCompare(b.token));
  }

  acknowledge(token: string): boolean {
    const batch = this.sealed.get(token);
    if (!batch) return false;
    this.retainedSamples -= batch.partition.samples.length;
    this.retainedBytes -= batch.estimatedBytes;
    return this.sealed.delete(token);
  }

  recordFailure(token: string, nowMs: number): HeldContractBatcherShed | null {
    const batch = this.sealed.get(token);
    if (!batch || !finite(nowMs)) return null;
    batch.attempts++;
    if (batch.attempts >= this.retryMaxAttempts) {
      this.sealed.delete(token);
      this.retainedSamples -= batch.partition.samples.length;
      this.retainedBytes -= batch.estimatedBytes;
      this.totalShedSamples += batch.partition.samples.length;
      this.totalShedBytes += batch.estimatedBytes;
      return {
        reason: "retry_budget",
        samples: batch.partition.samples.length,
        estimatedBytes: batch.estimatedBytes,
        positionId: batch.partition.positionId,
        occSymbol: batch.partition.occSymbol,
        token,
      };
    }
    const delay = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** (batch.attempts - 1));
    batch.nextAttemptAtMs = nowMs + delay;
    return null;
  }

  abandonAll(): HeldContractBatcherShed[] {
    const shed: HeldContractBatcherShed[] = [];
    for (const partition of this.open.values()) {
      shed.push({
        reason: "shutdown_abandoned",
        samples: partition.samples.length,
        estimatedBytes: estimatedPartitionBytes(partition),
        positionId: partition.positionId,
        occSymbol: partition.occSymbol,
        token: null,
      });
    }
    for (const batch of this.sealed.values()) {
      shed.push({
        reason: "shutdown_abandoned",
        samples: batch.partition.samples.length,
        estimatedBytes: batch.estimatedBytes,
        positionId: batch.partition.positionId,
        occSymbol: batch.partition.occSymbol,
        token: batch.token,
      });
    }
    const samples = shed.reduce((sum, row) => sum + row.samples, 0);
    const bytes = shed.reduce((sum, row) => sum + row.estimatedBytes, 0);
    this.totalShedSamples += samples;
    this.totalShedBytes += bytes;
    this.retainedSamples = 0;
    this.retainedBytes = 0;
    this.open.clear();
    this.sealed.clear();
    return shed;
  }

  openPartitionCount(): number { return this.open.size; }
  sealedBatchCount(): number { return this.sealed.size; }
  sampleCount(): number {
    return this.retainedSamples;
  }
  estimatedBytes(): number { return this.retainedBytes; }
  utilization(): number { return Math.max(this.retainedSamples / this.maxStateSamples, this.retainedBytes / this.maxStateBytes); }
  shedTotals(): { samples: number; estimatedBytes: number } {
    return { samples: this.totalShedSamples, estimatedBytes: this.totalShedBytes };
  }
}

export function buildHeldContractSegmentDescriptor(
  partition: HeldContractCapturePartition,
  prefix = "held-contracts",
  maxObservationGapMs = HELD_CONTRACT_MAX_OBSERVATION_GAP_MS,
): HeldContractSegmentDescriptor | null {
  if (!partition.samples.length || !Number.isInteger(maxObservationGapMs) || maxObservationGapMs < 1) return null;
  const samples = [...partition.samples].sort((a, b) => a.fetchCompletedAtMs - b.fetchCompletedAtMs || a.id.localeCompare(b.id));
  const rawNdjson = Buffer.from(`${samples.map((sample) => stable(sample)).join("\n")}\n`, "utf8");
  const contentSha256 = createHash("sha256").update(rawNdjson).digest("hex");
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "") || "held-contracts";
  const base = `${cleanPrefix}/v${HELD_CONTRACT_CAPTURE_SCHEMA_VERSION}/date=${partition.dateEt}/position=${partition.positionId}/occ=${partition.occSymbol}/${contentSha256}`;
  const quoteSamples = samples.filter((sample) => sample.bid != null && sample.ask != null && sample.providerQuoteAtMs != null);
  const observedTimes = quoteSamples.map((sample) => sample.fetchCompletedAtMs);
  const gaps = observedTimes.slice(1).map((at, index) => at - observedTimes[index]);
  const providerAges = quoteSamples.map((sample) => sample.providerQuoteEventAgeMs).filter(finite);
  const invalidQualities: HeldContractSampleQuality[] = ["invalid_quote", "crossed_quote", "future_quote"];
  const id = deterministicEvidenceUuid("seve-held-contract-segment-v1", {
    contentSha256, positionId: partition.positionId, occSymbol: partition.occSymbol,
  });
  return {
    id, schemaVersion: HELD_CONTRACT_CAPTURE_SCHEMA_VERSION, captureVersion: HELD_CONTRACT_CAPTURE_VERSION,
    sourceFeed: "opra", sourceBootId: partition.sourceBootId, sourceVersion: partition.sourceVersion,
    positionId: partition.positionId, strategistId: partition.strategistId, accountId: partition.accountId,
    channelSlug: partition.channelSlug, occSymbol: partition.occSymbol, underlying: partition.underlying,
    sessionDateEt: partition.dateEt, hourEt: partition.hourEt,
    objectKey: `${base}.jsonl.gz`, manifestKey: `${base}.manifest.json`,
    contentSha256, rawBytes: rawNdjson.byteLength, sampleCount: samples.length,
    successfulQuoteCount: quoteSamples.length,
    requestFailureCount: samples.filter((sample) => sample.quality === "request_failed").length,
    missingQuoteCount: samples.filter((sample) => sample.quality === "missing_quote").length,
    invalidQuoteCount: samples.filter((sample) => invalidQualities.includes(sample.quality)).length,
    eligibleCount: samples.filter((sample) => sample.quality === "eligible").length,
    staleSnapshotCount: samples.filter((sample) => sample.quality === "snapshot_stale").length,
    staleQuoteEventCount: samples.filter((sample) => sample.quality === "quote_event_stale").length,
    firstFetchAt: new Date(samples[0].fetchStartedAtMs).toISOString(),
    lastFetchAt: new Date(samples[samples.length - 1].fetchCompletedAtMs).toISOString(),
    providerMinAt: quoteSamples.length ? new Date(Math.min(...quoteSamples.map((sample) => sample.providerQuoteAtMs!))).toISOString() : null,
    providerMaxAt: quoteSamples.length ? new Date(Math.max(...quoteSamples.map((sample) => sample.providerQuoteAtMs!))).toISOString() : null,
    gapCount: gaps.filter((gap) => gap > maxObservationGapMs).length,
    maxObservationGapMs: gaps.length ? Math.max(...gaps) : null,
    providerAgeP50Ms: percentile(providerAges, 0.5), providerAgeP95Ms: percentile(providerAges, 0.95),
    providerAgeMaxMs: providerAges.length ? Math.max(...providerAges) : null,
    droppedSamples: partition.droppedSamples, rejectedOversize: partition.rejectedOversize, rawNdjson,
  };
}
