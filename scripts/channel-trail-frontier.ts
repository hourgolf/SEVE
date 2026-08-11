// Read-only nightly channel trail frontier. It converts the canonical logical
// trade ledger plus frozen executable-bid paths into local deterministic
// artifacts. Missing local archives may be filled by SELECT-only live-window
// option_quotes reads; the command has no production write path.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pageAll } from "../engine/pageAll";
import { etDateOf, type LogicalTrade, type ProfitabilityLedger } from "../lib/profitability/profitabilityLedger";
import { etSessionCloseUtc, etWallMinuteUtc } from "../lib/research/afterCloseResearch";
import {
  buildChannelTrailFrontier,
  type ChannelTrailFrontierBook,
  type TrailOpportunity,
  type TrailQuote,
} from "../lib/research/channelTrailFrontier";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "../lib/research/decisionAtlasAdapter";
import type { QuoteArchiveReceiptRow } from "../worker/src/quoteArchiveReceiptStore";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};
const ledgerFile = resolve(arg("ledger-file", "data/decision-atlas/latest/profitability/ledger.json")!);
const atlasFile = resolve(arg("atlas-file", "data/decision-atlas/latest/atlas/atlas.json")!);
const snapshotFile = resolve(arg("snapshot-file", resolve(dirname(atlasFile), "snapshot.json"))!);
const quotesDir = resolve(arg("quotes-dir", "data/quotes-archive")!);
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/trails")!);
const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile && existsSync(resolve(envFile))) process.loadEnvFile(resolve(envFile));
else if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

interface LedgerArtifact { ledger: ProfitabilityLedger }
interface ArchiveQuoteRow { occ_symbol: string; bid: number | string | null; captured_at: string }
interface RemoteQuoteRow { occ_symbol: string; bid: number | string | null; captured_at: string }
interface TrailSeed {
  logicalOpportunityId: string;
  channel: string;
  session: string;
  configurationEra: string;
  evidenceLayer: TrailOpportunity["evidenceLayer"];
  entryAt: string;
  entryPrice: number;
  quantity: number;
  nativeReturnPct: number;
  nativeExitAt: string | null;
  occSymbol: string;
}

const numeric = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.length ? value : null;

const r2Configured = (): boolean => Boolean(
  process.env.R2_ACCOUNT_ID
  && process.env.R2_ACCESS_KEY_ID
  && process.env.R2_SECRET_ACCESS_KEY
  && process.env.R2_BUCKET,
);

const r2 = r2Configured() ? new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
}) : null;

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
};
const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex")}`;
const safeName = (value: string): string => value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");

function exactConfigurationEra(trade: LogicalTrade): string {
  return trade.configuration.key || `${trade.configuration.kind}:unknown`;
}

function flattenAtMs(session: string): number {
  return Math.min(Date.parse(etWallMinuteUtc(session, 15 * 60 + 25)), Date.parse(etSessionCloseUtc(session)));
}

function localSessionQuotes(session: string): Map<string, TrailQuote[]> | null {
  const file = resolve(quotesDir, `${session}.json.gz`);
  if (!existsSync(file)) return null;
  const rows = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as ArchiveQuoteRow[];
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!row.occ_symbol || !(bid > 0) || !Number.isFinite(Date.parse(row.captured_at))) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

async function quoteArchiveReceipts(sessions: readonly string[]): Promise<Map<string, QuoteArchiveReceiptRow>> {
  if (!r2 || !process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) return new Map();
  const sb = createServerSupabaseClient("channel-trail-frontier-r2-receipts");
  const rows: QuoteArchiveReceiptRow[] = [];
  for (let index = 0; index < sessions.length; index += 40) {
    const { data, error } = await sb.from("quote_archive_receipts").select("*")
      .eq("archive_version", "r2-option-quotes-v1")
      .in("session_date_et", [...sessions.slice(index, index + 40)]);
    if (error) throw new Error(`quote archive receipt SELECT failed: ${error.message}`);
    rows.push(...(data ?? []) as QuoteArchiveReceiptRow[]);
  }
  return new Map(rows.map((row) => [row.session_date_et, row]));
}

async function r2SessionQuotes(receipt: QuoteArchiveReceiptRow): Promise<Map<string, TrailQuote[]>> {
  if (!r2) return new Map();
  const [object, manifest] = await Promise.all([
    r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: receipt.object_key })),
    r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: receipt.manifest_key })),
  ]);
  if (!object.Body || !manifest.Body) throw new Error(`R2 quote archive body missing for ${receipt.session_date_et}`);
  const [compressed, manifestBody] = await Promise.all([
    object.Body.transformToByteArray(),
    manifest.Body.transformToByteArray(),
  ]);
  if (compressed.byteLength !== receipt.compressed_bytes
      || createHash("sha256").update(compressed).digest("hex") !== receipt.compressed_sha256
      || createHash("sha256").update(manifestBody).digest("hex") !== receipt.manifest_sha256) {
    throw new Error(`R2 quote archive receipt mismatch for ${receipt.session_date_et}`);
  }
  const raw = gunzipSync(compressed);
  if (createHash("sha256").update(raw).digest("hex") !== receipt.content_sha256) {
    throw new Error(`R2 quote archive content mismatch for ${receipt.session_date_et}`);
  }
  const declared = JSON.parse(Buffer.from(manifestBody).toString("utf8")) as {
    sessionDateEt?: string; objectKey?: string; rowCount?: number; compressedSha256?: string;
  };
  if (declared.sessionDateEt !== receipt.session_date_et || declared.objectKey !== receipt.object_key
      || declared.rowCount !== receipt.row_count || declared.compressedSha256 !== receipt.compressed_sha256) {
    throw new Error(`R2 quote archive manifest mismatch for ${receipt.session_date_et}`);
  }
  const rows = JSON.parse(raw.toString("utf8")) as ArchiveQuoteRow[];
  if (rows.length !== receipt.row_count) throw new Error(`R2 quote archive row-count mismatch for ${receipt.session_date_et}`);
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!row.occ_symbol || !(bid > 0) || !Number.isFinite(Date.parse(row.captured_at))) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

async function remoteSessionQuotes(session: string, occSymbols: readonly string[]): Promise<Map<string, TrailQuote[]>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) return new Map();
  const sb = createServerSupabaseClient("channel-trail-frontier");
  const rows: RemoteQuoteRow[] = [];
  for (let index = 0; index < occSymbols.length; index += 40) {
    const batch = occSymbols.slice(index, index + 40);
    rows.push(...await pageAll<RemoteQuoteRow>((from) => sb.from("option_quotes")
      .select("occ_symbol,bid,captured_at")
      .in("occ_symbol", [...batch])
      .gte("captured_at", etWallMinuteUtc(session, 9 * 60 + 30))
      .lte("captured_at", new Date(flattenAtMs(session)).toISOString())
      .order("captured_at").order("id"), {
      pageSize: 1_000, max: 150_000, attempts: 3, retryDelaysMs: [250, 750], timeoutMs: 20_000,
    }));
  }
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!(bid > 0)) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

function renderMarkdown(book: ChannelTrailFrontierBook): string {
  const lines = [
    `# Channel Trail Frontier — through ${book.throughSession}`,
    "",
    "Read-only paired executable-bid research. Entry, size, route, roster, and production managers remain unchanged.",
    "",
    "| Channel | Era | Decision | Leading trail | Typical lift | Beat rate | Evidence |",
    "|---|---|---|---|---:|---:|---:|",
  ];
  for (const channel of Object.values(book.channels).sort((left, right) => left.channel.localeCompare(right.channel))) {
    const selected = [
      channel.eras.find((row) => row.configurationEra === channel.selectedConfigurationEra) ?? null,
      channel.virtualEras.find((row) => row.configurationEra === channel.selectedVirtualConfigurationEra) ?? null,
    ];
    for (const era of selected) {
      if (!era) continue;
      const candidate = era.candidates.find((row) => row.candidateId === era.recommendedCandidateId)
        ?? [...era.candidates].sort((left, right) => (right.typicalBenefitPct ?? -Infinity) - (left.typicalBenefitPct ?? -Infinity))[0];
      const pct = (value: number | null): string => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
      lines.push(`| ${channel.channel} (${era.evidenceLayer.replaceAll("_", " ")}) | ${era.configurationEra} | ${era.recommendation.replaceAll("_", " ")} | ${candidate?.label ?? "—"} | ${pct(candidate?.typicalBenefitPct ?? null)} | ${candidate?.improvementFrequency == null ? "—" : `${Math.round(candidate.improvementFrequency * 100)}%`} | ${candidate?.pairedOpportunities ?? 0} paths / ${candidate?.sessions ?? 0}s |`);
    }
  }
  lines.push("", "Executed and exact-current virtual paths are displayed in separate rows and are never pooled. A trail is proposal-ready only when its paired benefit, chronological validation, leave-session-out validation, and nearby parameter plateau agree. Capacity and displacement still require a separate pass.", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  for (const file of [ledgerFile, atlasFile, snapshotFile]) if (!existsSync(file)) throw new Error(`required frozen artifact not found: ${file}`);
  const ledgerText = readFileSync(ledgerFile, "utf8");
  const atlasText = readFileSync(atlasFile, "utf8");
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const ledger = (JSON.parse(ledgerText) as LedgerArtifact).ledger;
  const atlas = JSON.parse(atlasText) as DecisionAtlas;
  const snapshot = JSON.parse(snapshotText) as DecisionAtlasSourceSnapshot;
  const trades = ledger.logicalTrades.filter((trade) => trade.status === "closed" && trade.closedAt
    && trade.quantity > 0 && trade.entryDebitUsd != null && trade.entryDebitUsd > 0
    && trade.realizedReturnPct != null && trade.occSymbol && trade.openedAt
    && trade.openedAt <= `${atlas.throughSession}T23:59:59.999Z`);
  const seeds: TrailSeed[] = [];
  for (const trade of trades) {
    const session = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(trade.openedAt));
    seeds.push({
      logicalOpportunityId: trade.id,
      channel: trade.channelSlug,
      session,
      configurationEra: exactConfigurationEra(trade),
      evidenceLayer: "executed",
      entryAt: trade.openedAt,
      entryPrice: (trade.entryDebitUsd as number) / (trade.quantity * 100),
      quantity: trade.quantity,
      nativeReturnPct: trade.realizedReturnPct as number,
      nativeExitAt: trade.closedAt,
      occSymbol: trade.occSymbol,
    });
  }
  const signalById = new Map(snapshot.signals.map((row) => [row.id, row]));
  const activeSpecBySlug = new Map(snapshot.activeChannelSpecs.map((row) => [row.slug, row]));
  const currentVirtualConfigurationEras: Record<string, string> = {};
  const latestVirtualAtByChannel = new Map<string, string>();
  let virtualMissingSignal = 0;
  let virtualMissingConfigurationStamp = 0;
  for (const virtual of snapshot.virtualTrades) {
    const signal = signalById.get(virtual.signal_id);
    const entryPrice = numeric(virtual.entry_px);
    const pnl = numeric(virtual.pnl_per_contract);
    if (!signal) { virtualMissingSignal += 1; continue; }
    if (!virtual.occ || !(entryPrice != null && entryPrice > 0) || pnl == null || !virtual.exit_at
      || etDateOf(virtual.signal_at) > atlas.throughSession) continue;
    const rationale = object(signal.rationale);
    const observedPolicyEpoch = text(rationale?.observed_policy_configuration_epoch_id)
      ?? text(rationale?.configuration_epoch_id) ?? signal.configuration_epoch_id;
    if (!observedPolicyEpoch) { virtualMissingConfigurationStamp += 1; continue; }
    const activeSpec = activeSpecBySlug.get(virtual.slug);
    const activeDatabaseId = activeSpec
      ? snapshot.activeChannelSpecDatabaseIdsByVersionKey?.[activeSpec.id] ?? null : null;
    const configurationEra = activeDatabaseId && signal.configuration_epoch_id === snapshot.currentConfigurationEpochId
      ? `channel-spec:${activeDatabaseId}` : `prospective-policy:${observedPolicyEpoch}`;
    const quantity = activeSpec?.quantity ?? Math.max(1, Math.floor(numeric(rationale?.qty) ?? 1));
    seeds.push({
      logicalOpportunityId: `signal:${virtual.signal_id}`,
      channel: virtual.slug,
      session: etDateOf(virtual.signal_at),
      configurationEra,
      evidenceLayer: "virtual",
      entryAt: virtual.signal_at,
      entryPrice,
      quantity,
      nativeReturnPct: pnl / entryPrice,
      nativeExitAt: virtual.exit_at,
      occSymbol: virtual.occ,
    });
    const latestAt = latestVirtualAtByChannel.get(virtual.slug);
    if (!latestAt || virtual.signal_at > latestAt) {
      latestVirtualAtByChannel.set(virtual.slug, virtual.signal_at);
      currentVirtualConfigurationEras[virtual.slug] = configurationEra;
    }
  }
  const bySession = new Map<string, TrailSeed[]>();
  for (const seed of seeds) bySession.set(seed.session, [...(bySession.get(seed.session) ?? []), seed]);
  const receipts = await quoteArchiveReceipts([...bySession.keys()]);
  const opportunities: TrailOpportunity[] = [];
  let archiveSessions = 0;
  let r2Sessions = 0;
  let remoteSessions = 0;
  let missingSessions = 0;
  for (const [session, sessionSeeds] of [...bySession].sort(([left], [right]) => left.localeCompare(right))) {
    let quoteBook = localSessionQuotes(session);
    let source: TrailOpportunity["source"] = "frozen_option_archive";
    if (quoteBook) archiveSessions += 1;
    else if (receipts.has(session)) {
      quoteBook = await r2SessionQuotes(receipts.get(session)!);
      source = "r2_quote_archive";
      r2Sessions += 1;
    }
    else {
      quoteBook = await remoteSessionQuotes(session, [...new Set(sessionSeeds.map((seed) => seed.occSymbol))]);
      source = "live_option_quotes";
      if (quoteBook.size) remoteSessions += 1;
      else missingSessions += 1;
    }
    const cutoff = flattenAtMs(session);
    for (const seed of sessionSeeds) {
      const quotes = (quoteBook.get(seed.occSymbol) ?? []).filter((quote) => {
        const at = Date.parse(quote.at);
        return at >= Date.parse(seed.entryAt) && at <= cutoff;
      });
      opportunities.push({
        logicalOpportunityId: seed.logicalOpportunityId,
        channel: seed.channel,
        session: seed.session,
        configurationEra: seed.configurationEra,
        evidenceLayer: seed.evidenceLayer,
        entryAt: seed.entryAt,
        entryPrice: seed.entryPrice,
        quantity: seed.quantity,
        nativeReturnPct: seed.nativeReturnPct,
        nativeExitAt: seed.nativeExitAt,
        quotes,
        source,
      });
    }
  }
  const currentConfigurationEras = Object.fromEntries(Object.values(atlas.channels)
    .map((dossier) => [dossier.channel, dossier.decisionCohort.configurationEra]));
  const book = buildChannelTrailFrontier({
    generatedAt: atlas.generatedAt,
    throughSession: atlas.throughSession,
    opportunities,
    currentConfigurationEras,
    currentVirtualConfigurationEras,
  });
  const json = `${JSON.stringify(book, null, 2)}\n`;
  const markdown = `${renderMarkdown(book)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt: book.generatedAt,
    throughSession: book.throughSession,
    frontierVersion: book.frontierVersion,
    channels: Object.keys(book.channels).length,
    logicalOpportunities: book.sourceOpportunities,
    executedLogicalOpportunities: book.executedSourceOpportunities,
    virtualLogicalOpportunities: book.virtualSourceOpportunities,
    virtualCensors: { missingSignal: virtualMissingSignal, missingConfigurationStamp: virtualMissingConfigurationStamp },
    pathSources: { localArchiveSessions: archiveSessions, verifiedR2Sessions: r2Sessions, remoteSelectSessions: remoteSessions, missingSessions },
    inputs: { ledgerSha256: sha256(ledgerText), atlasSha256: sha256(atlasText), snapshotSha256: sha256(snapshotText) },
    outputs: { frontierSha256: sha256(json), markdownSha256: sha256(markdown) },
    productionReads: [
      ...(receipts.size ? ["quote_archive_receipts:SELECT", "r2_quote_archive:GET"] : []),
      ...(remoteSessions ? ["option_quotes:SELECT"] : []),
    ],
    productionWrites: 0,
    allowedMethods: ["SELECT", "GET"],
    orderAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(resolve(outputDir, "channels"), { recursive: true });
  writeFileSync(resolve(outputDir, "frontier.json"), json);
  writeFileSync(resolve(outputDir, "frontier.md"), markdown);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const channel of Object.values(book.channels)) {
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel.channel)}.json`), `${JSON.stringify(channel, null, 2)}\n`);
  }
  console.log(`channel-trail-frontier: PASS · ${receipt.channels} channels · ${receipt.logicalOpportunities} logical opportunities`);
  console.log(`  local archive ${archiveSessions}s · verified R2 ${r2Sessions}s · remote SELECT ${remoteSessions}s · missing ${missingSessions}s`);
  console.log("  production writes: 0 · authority: none");
}

main().catch((error) => {
  console.error(`channel-trail-frontier: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
