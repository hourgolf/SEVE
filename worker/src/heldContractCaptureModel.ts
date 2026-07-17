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

export type HeldContractRequestOutcome = "success" | "provider_error";
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

  if (input.requestOutcome === "provider_error") {
    quality = "request_failed";
    failureCode ??= "provider_error";
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
