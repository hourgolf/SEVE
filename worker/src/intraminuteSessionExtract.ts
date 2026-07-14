// Download and verify only the immutable R2 SIP objects that overlap actual
// native-entry source minutes, then emit a compact local replay fixture. This is
// research-only: it cannot place orders or write Supabase/R2.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { formingSnapshots, mergeReplayWindows, percentile, receiptOverlapsWindows, type ReplayWindow } from "./intraminuteReplayModel.js";
import type { IntraminuteCaptureEvent } from "./intraminuteCaptureModel.js";
import type { SipQuoteEvent, SipTradeEvent } from "./intraminuteObserverModel.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const DATE = arg("date", ET_DATE.format(new Date()));
const OUT_DIR = arg("outdir", `data/intraminute-replay/${DATE}`);
const CONCURRENCY = Number(arg("concurrency", "8"));
if (!DATE_RE.test(DATE)) throw new Error(`invalid --date ${DATE}`);
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 32) throw new Error("--concurrency must be 1..32");

function etWallToUtcMs(dateEt: string, hh: number, mm: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noon);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const offsetMin = 12 * 60 - (h * 60 + m);
  return Date.parse(`${dateEt}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) + offsetMin * 60_000;
}

interface Receipt {
  object_key: string;
  schema_version: number;
  observer_version: string;
  symbol: string;
  row_count: number;
  provider_min_at: string;
  provider_max_at: string;
  checksum_sha256: string;
  compressed_bytes: number;
}

interface PositionRow {
  id: string;
  strategist_id: string;
  occ_symbol: string;
  underlying: string;
  qty: number;
  avg_entry_price: number;
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number | null;
  close_reason: string | null;
  strategists: { slug?: string } | Array<{ slug?: string }> | null;
}

interface OpenOutcome {
  position_id: string;
  opportunity_id: string | null;
}

interface EntryObservation {
  event_kind: "decision" | "broker_result";
  event_at: string;
  source_bar_at: string;
  strategist_id: string;
  channel_slug: string;
  opportunity_id: string | null;
  underlying: string;
  occ_symbol: string | null;
  requested_qty: number | null;
  filled_qty: number | null;
  fill_price: number | null;
  quote_age_ms: number | null;
  bid: number | null;
  ask: number | null;
}

interface MinuteBucket {
  symbol: string;
  minuteStartMs: number;
  trades: SipTradeEvent[];
  quotes: SipQuoteEvent[];
  gaps: IntraminuteCaptureEvent[];
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const slugOf = (value: PositionRow["strategists"]): string => {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.slug ?? "?";
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const accountId = process.env.R2_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket = process.env.R2_BUCKET ?? "";
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase backend credentials missing");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error("R2 credentials missing");

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const rthOpen = etWallToUtcMs(DATE, 9, 30);
  const rthClose = etWallToUtcMs(DATE, 16, 0);
  const startIso = new Date(rthOpen).toISOString();
  const endIso = new Date(rthClose + 30 * 60_000).toISOString();

  const [{ data: positionsRaw, error: positionsError }, { data: outcomesRaw, error: outcomesError }] = await Promise.all([
    sb.from("positions").select("id,strategist_id,occ_symbol,underlying,qty,avg_entry_price,opened_at,closed_at,realized_pnl,close_reason,strategists(slug)")
      .gte("opened_at", startIso).lt("opened_at", endIso).order("opened_at"),
    sb.from("position_outcome_events").select("position_id,opportunity_id")
      .eq("event_kind", "position_opened").gte("event_at", startIso).lt("event_at", endIso),
  ]);
  if (positionsError) throw new Error(`positions read failed: ${positionsError.message}`);
  if (outcomesError) throw new Error(`outcomes read failed: ${outcomesError.message}`);
  const observationsRaw: EntryObservation[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await sb.from("execution_observations")
      .select("event_kind,event_at,source_bar_at,strategist_id,channel_slug,opportunity_id,underlying,occ_symbol,requested_qty,filled_qty,fill_price,quote_age_ms,bid,ask")
      .eq("action", "enter").gte("event_at", startIso).lt("event_at", endIso)
      .order("event_at").order("id").range(from, from + 999);
    if (error) throw new Error(`execution observations read failed: ${error.message}`);
    const batch = (data ?? []) as unknown as EntryObservation[];
    observationsRaw.push(...batch);
    if (batch.length < 1_000) break;
  }
  const positions = (positionsRaw ?? []) as unknown as PositionRow[];
  const outcomes = (outcomesRaw ?? []) as unknown as OpenOutcome[];
  const observations = observationsRaw;

  const positionById = new Map(positions.map((p) => [p.id, p]));
  const positionByOpportunity = new Map(outcomes.filter((o) => o.opportunity_id).map((o) => [o.opportunity_id!, positionById.get(o.position_id)]));
  const observationsByOpportunity = new Map<string, EntryObservation[]>();
  for (const observation of observations) {
    if (!observation.opportunity_id) continue;
    const group = observationsByOpportunity.get(observation.opportunity_id) ?? [];
    group.push(observation);
    observationsByOpportunity.set(observation.opportunity_id, group);
  }

  const entries = [...observationsByOpportunity.entries()].map(([opportunityId, group]) => {
    const decision = group.find((o) => o.event_kind === "decision") ?? null;
    const fill = group.find((o) => o.event_kind === "broker_result") ?? null;
    const position = positionByOpportunity.get(opportunityId) ?? null;
    const source = decision ?? fill;
    return source && position
      ? { opportunityId, decision, fill, position, sourceBarAtMs: Date.parse(source.source_bar_at), symbol: source.underlying.toUpperCase() }
      : null;
  }).filter((entry): entry is NonNullable<typeof entry> => entry != null && Number.isFinite(entry.sourceBarAtMs));

  const replayWindows = mergeReplayWindows(entries.map((entry): ReplayWindow => ({
    symbol: entry.symbol,
    startMs: entry.sourceBarAtMs,
    endMs: entry.sourceBarAtMs + 60_000,
  })));
  const wantedMinuteKeys = new Set(entries.map((entry) => `${entry.symbol}|${entry.sourceBarAtMs}`));

  const receipts: Receipt[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await sb.from("intraminute_capture_receipts")
      .select("object_key,schema_version,observer_version,symbol,row_count,provider_min_at,provider_max_at,checksum_sha256,compressed_bytes")
      .eq("session_date_et", DATE).order("provider_min_at").order("object_key").range(from, from + 999);
    if (error) throw new Error(`capture receipt read failed: ${error.message}`);
    const batch = (data ?? []) as unknown as Receipt[];
    receipts.push(...batch);
    if (batch.length < 1_000) break;
  }
  const selected = receipts.filter((receipt) => receiptOverlapsWindows({
    symbol: receipt.symbol,
    providerMinMs: Date.parse(receipt.provider_min_at),
    providerMaxMs: Date.parse(receipt.provider_max_at),
  }, replayWindows));

  mkdirSync(join(OUT_DIR, "objects"), { recursive: true });
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const minuteBuckets = new Map<string, MinuteBucket>();
  let downloadedObjects = 0, downloadedBytes = 0, verifiedRows = 0;

  await mapLimit(selected, CONCURRENCY, async (receipt) => {
    const path = join(OUT_DIR, "objects", `${receipt.checksum_sha256}.jsonl.gz`);
    let compressed: Buffer;
    if (existsSync(path)) compressed = readFileSync(path);
    else {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: receipt.object_key }));
      if (!response.Body) throw new Error(`R2 returned no body for ${receipt.object_key}`);
      compressed = Buffer.from(await response.Body.transformToByteArray());
      writeFileSync(path, compressed);
      downloadedObjects++;
      downloadedBytes += compressed.byteLength;
    }
    if (compressed.byteLength !== Number(receipt.compressed_bytes)) throw new Error(`byte mismatch ${receipt.object_key}`);
    if (sha256(compressed) !== receipt.checksum_sha256) throw new Error(`checksum mismatch ${receipt.object_key}`);
    const lines = gunzipSync(compressed).toString("utf8").split("\n").filter(Boolean);
    if (lines.length !== Number(receipt.row_count)) throw new Error(`row mismatch ${receipt.object_key}`);
    verifiedRows += lines.length;
    for (const line of lines) {
      const event = JSON.parse(line) as IntraminuteCaptureEvent;
      const minuteStartMs = Math.floor(event.providerAtMs / 60_000) * 60_000;
      const key = `${event.symbol}|${minuteStartMs}`;
      if (!wantedMinuteKeys.has(key)) continue;
      const current = minuteBuckets.get(key) ?? { symbol: event.symbol, minuteStartMs, trades: [], quotes: [], gaps: [] };
      if (event.kind === "trade") current.trades.push(event.payload);
      else if (event.kind === "quote") current.quotes.push(event.payload);
      else current.gaps.push(event);
      minuteBuckets.set(key, current);
    }
  });

  const minutes = [...minuteBuckets.values()].sort((a, b) => a.minuteStartMs - b.minuteStartMs || a.symbol.localeCompare(b.symbol)).map((minute) => {
    const lags = [...minute.trades, ...minute.quotes].map((event) => event.receiveLagMs);
    return {
      key: `${minute.symbol}|${minute.minuteStartMs}`,
      symbol: minute.symbol,
      minuteStartAt: new Date(minute.minuteStartMs).toISOString(),
      trades: minute.trades.length,
      quotes: minute.quotes.length,
      gaps: minute.gaps.length,
      receiveLagMs: { p50: percentile(lags, 0.5), p95: percentile(lags, 0.95), max: percentile(lags, 1) },
      forming5s: formingSnapshots(minute.symbol, minute.trades, minute.quotes, minute.minuteStartMs),
    };
  });

  const report = {
    schemaVersion: 2,
    dateEt: DATE,
    generatedAt: new Date().toISOString(),
    source: {
      feed: "sip",
      schemaVersions: [...new Set(selected.map((receipt) => receipt.schema_version))].sort((a, b) => a - b),
      observerVersions: [...new Set(selected.map((receipt) => receipt.observer_version))].sort(),
      rawStore: "r2",
      compactStore: "supabase",
    },
    coverage: {
      sessionPositions: positions.length,
      openingOutcomes: outcomes.length,
      nativeEntryGroups: entries.length,
      sourceMinutesRequested: wantedMinuteKeys.size,
      sourceMinutesRecovered: minutes.length,
      sessionReceipts: receipts.length,
      selectedReceipts: selected.length,
      verifiedRows,
      downloadedObjects,
      downloadedBytes,
    },
    entries: entries.map((entry) => ({
      opportunityId: entry.opportunityId,
      positionId: entry.position?.id ?? null,
      channel: entry.position ? slugOf(entry.position.strategists) : entry.fill?.channel_slug ?? entry.decision?.channel_slug ?? "?",
      symbol: entry.symbol,
      occSymbol: entry.position?.occ_symbol ?? entry.fill?.occ_symbol ?? null,
      quantity: entry.position?.qty ?? entry.fill?.filled_qty ?? entry.fill?.requested_qty ?? null,
      sourceBarAt: new Date(entry.sourceBarAtMs).toISOString(),
      sourceMinuteKey: `${entry.symbol}|${entry.sourceBarAtMs}`,
      decisionAt: entry.decision?.event_at ?? null,
      brokerResultAt: entry.fill?.event_at ?? null,
      fillPrice: entry.fill?.fill_price ?? entry.position?.avg_entry_price ?? null,
      candidateQuote: entry.decision ? { bid: entry.decision.bid, ask: entry.decision.ask, ageMs: entry.decision.quote_age_ms } : null,
      closedAt: entry.position?.closed_at ?? null,
      realizedPnl: entry.position?.realized_pnl ?? null,
      closeReason: entry.position?.close_reason ?? null,
    })),
    minutes,
  };
  const outputPath = join(OUT_DIR, "entry-source-minutes.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`intraminute-session-extract: ${DATE}`);
  console.log(`  positions ${positions.length} · entries ${entries.length} · source minutes ${minutes.length}/${wantedMinuteKeys.size}`);
  console.log(`  receipts ${selected.length}/${receipts.length} · verified rows ${verifiedRows.toLocaleString()}`);
  console.log(`  downloaded ${(downloadedBytes / 1_048_576).toFixed(1)} MiB in ${downloadedObjects} object(s)`);
  console.log(`  wrote ${outputPath}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
